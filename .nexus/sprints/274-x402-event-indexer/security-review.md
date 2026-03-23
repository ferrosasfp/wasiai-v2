## Security Review — SDD #274 Event Indexer

> **Archivos auditados:**
> - `src/lib/indexer/eventIndexer.ts` (262 líneas)
> - `src/app/api/cron/index-events/route.ts` (41 líneas)
>
> **Revisor:** Security Reviewer (subagente)
> **Fecha:** 2026-03-22

---

### Superficie de ataque

| Categoría | Endpoint / Función | Auth requerida | Status |
|-----------|-------------------|----------------|--------|
| API | `GET /api/cron/index-events` | Bearer CRON_SECRET | ✅ OK |
| DB | `app_settings` (lock + last_block) | Service client (RLS bypass) | ✅ Necesario |
| DB | `agent_calls` (SELECT + UPDATE) | Service client (RLS bypass) | ✅ Aceptable |
| Chain | `publicClient.getLogs()` | Read-only, no firma | ✅ OK |
| Chain | `publicClient.getBlockNumber()` | Read-only, no firma | ✅ OK |

---

### Findings

| # | Severidad | Categoría | Detalle | Archivo:línea | Explotabilidad |
|---|-----------|-----------|---------|---------------|----------------|
| 1 | LOW | Autenticación | CRON_SECRET comparado con `!==` (no timing-safe) | `route.ts:12` | Timing attack en HTTP es prácticamente inviable por network jitter. Consistente con patrón de reconcile-onchain existente. |
| 2 | LOW | Race Condition | Lock TOCTOU — `acquireLock` hace read-then-write no atómico | `eventIndexer.ts:56-65` | Dos invocaciones simultáneas podrían ambas ver el lock expirado y ambas proceder. En práctica cron no llama en paralelo, pero técnicamente posible. |
| 3 | INFO | Menor Privilegio | `agent_calls` SELECT usa service client; un anon/user client con RLS podría bastar para leer | `eventIndexer.ts:127` | No explotable — el service client no otorga más de lo que ya hace la query. Cleanup arquitectural. |
| 4 | INFO | Input Validation | `contractAddress` se castea con `as \`0x${string}\`` sin validación runtime del formato | `route.ts:37` | Valor viene de env var controlada por ops. Si está malformada, viem lanza error antes de cualquier efecto adverso. |

---

### Análisis detallado por pregunta clave

#### ¿El CRON_SECRET validation es correcto?

```ts
// route.ts:12
if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
```

Usa comparación de strings JS (`!==`), no `timingSafeEqual` de Node crypto.  
**En contexto HTTP:** timing attacks son inviables porque la variación de red (~1-100ms) eclipsa la diferencia de comparación string (~ns). El patrón es idéntico a `reconcile-onchain/route.ts` y `settle-key-batches/route.ts`. **Consistencia > perfección teórica** aquí.  
**Riesgo real:** Muy bajo. Finding LOW, no bloquea deploy.

#### ¿El service client se usa solo donde es necesario?

- **`app_settings`** — Requiere bypass de RLS por diseño (tabla de configuración del sistema). ✅ Justificado.
- **`agent_calls` SELECT** — RLS podría permitir esto con client anon si las policies lo permiten, pero usar service client no agrega superficie de ataque (solo lee IDs y un boolean). ✅ Aceptable, INFO level.
- **`agent_calls` UPDATE** — Probablemente requiere service client si RLS restringe writes a usuarios autenticados. ✅ Justificado.

No hay uso innecesario de service client.

#### ¿Los logs exponen datos sensibles?

Revisados todos los `logger.*` calls:

```ts
// Orphan log — expone: txHash, slug, amount (BigInt→string), keyId
logger.warn('[indexer] Orphan settlement — no agent_calls match', {
  txHash, slug: decoded.slug, amount: decoded.amount.toString(), keyId: decoded.keyId,
})
```

- `txHash` — hash público on-chain. ✅
- `slug` — identificador público del agente. ✅  
- `amount` — monto de settlement. Dato on-chain público. ✅
- `keyId` — `0x...` bytes32, dato on-chain público. ✅
- Ningún log expone private keys, CRON_SECRET, wallet seeds, emails, ni PII.

**Conclusión: Logs limpios.**

#### ¿El lock mechanism puede ser abused?

El lock usa `app_settings` como almacenamiento:
- Valor = `String(Date.now())` (timestamp en ms)
- TTL = 5 minutos
- Release = `setAppSetting(client, LOCK_KEY, '0')`

**Posible abuse:**
1. Un atacante que llame el endpoint dos veces en < 1ms (antes de que el primer write complete) podría obtener doble ejecución → TOCTOU. Req: acceso al CRON_SECRET + timing preciso. Consecuencia: procesamiento duplicado, no pérdida de datos (UPDATE idempotente con `on_chain_recorded = true`).
2. Lock permanente: si el proceso muere después de `acquireLock` pero antes de `releaseLock` en el finally block… el finally garantiza release excepto en process kill forzoso. El TTL de 5min cubre este caso como fallback.

**Mitigación existente:** El TTL de 5min y el `finally` hacen esto robusto en práctica. Finding LOW.

#### ¿Hay DoS vectors?

**Block range:**
- `fromBlock` viene de `getLastIndexedBlock` → app_settings → solo modificable con service client.
- `toBlock` = `getBlockNumber()` → siempre el head de la chain, no user-controlled.
- MAX_CHUNKS = 25, CHUNK_SIZE = 2048 → máximo 51,200 bloques por run → bounded.
- `CHUNK_DELAY_MS = 200ms` → máximo ~5s overhead por delays, más RPC calls.

**RPC abuse:**  
Si `NEXT_PUBLIC_RPC_MAINNET/TESTNET` no está configurado, viem usa RPC público por defecto. En producción con endpoint privado, no aplica.

**Respuesta del endpoint:**  
Retorna `{ ok, processed, matched, warnings, blocksScanned }` — sin datos sensibles, sin stack traces.

**Conclusión: Sin DoS vectors explotables.**

---

### Resumen

| Severidad | Cantidad |
|-----------|----------|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 2 |
| INFO | 2 |

---

### Veredicto

✅ **SEGURO** — Sin findings HIGH o CRITICAL. El código puede hacer deploy.

Los dos LOW son conocidos (timing-safe es best practice pero no explotable en HTTP, TOCTOU es teórico con consecuencias idempotentes) y consistentes con los patrones de seguridad ya establecidos en el codebase.

**Recomendación opcional (no bloquea):**  
Para hardening futuro, considerar reemplazar la comparación de CRON_SECRET por `timingSafeEqual` en un helper compartido aplicado a todos los cron endpoints consistentemente.
