# Requirements Review — WAS-274: x402 Event Indexer

> Reviewer: Requirements Reviewer (subagent)
> Date: 2026-03-22
> Verdict: **BLOQUEADO — 5 gaps críticos requieren resolución antes de spec**

---

## Resumen ejecutivo

El Work Item está bien intencionado y cubre el happy path, pero tiene **ambigüedades de matching irresolubles**, **riesgo de doble-conteo de earnings**, y **columnas DB inexistentes** sin migración definida. No está listo para spec en su estado actual.

---

## 🔴 Gaps Críticos (Bloqueantes)

### C-1: Matching de `KeyCallSettled` → `agent_calls` es inviable tal como está definido

**AC-3 dice:** "mark the matching `agent_calls` row as `on_chain_recorded = true`"

**Problema:** No hay forma única de correlacionar un evento `KeyCallSettled` con una fila específica de `agent_calls`.

- `KeyCallSettled` tiene: `keyId`, `slug`, `amount`, `creatorShare`, `platformShare`
- `agent_calls` tiene: `key_id`, `agent_slug`, `amount_paid`, `settled_at` (por el settlement route)
- Puede haber múltiples llamadas con el mismo `key_id + slug + amount` — no hay campo único
- El settlement route ya setea `settled_at` al procesar, pero no guarda el `tx_hash` del settlement en `agent_calls`

**Lo que falta especificar:**
1. ¿Cuál es la estrategia de matching? ¿Por `settled_at IS NULL` + `key_id` + `slug` + FIFO?
2. ¿O se agrega `settlement_tx_hash` a `agent_calls` para matching exacto?
3. ¿Qué pasa con calls que ya tienen `settled_at != null`? ¿Se re-marcan?

---

### C-2: Doble-conteo de earnings para `AgentInvoked` (AC-5)

**AC-5 dice:** "SHALL increment `pending_earnings_usdc` por `creatorShare`"

**Problema:** El invoke route (`route.ts:~L330`) ya llama `increment_pending_earnings` en el happy path x402:

```typescript
// HU-067: Contabilidad off-chain de earnings — fire-and-forget
if (result.status === 'success' && model.creator_id) {
  after(async () => {
    await supabase.rpc('increment_pending_earnings', { p_user_id: model.creator_id, p_amount: creatorPrice })
  })
}
```

Si el indexer también incrementa earnings al detectar un `AgentInvoked` event (incluso como orphan detection), **cualquier x402 exitosa se contaría dos veces**.

**Lo que falta:**
- Definir condición explícita: AC-5 solo debe aplicar cuando `AC-2 crea una fila nueva` (call genuinamente perdida), no para cualquier evento
- ¿Cómo sabe el indexer si el invoke route ya incrementó earnings para esa call?

---

### C-3: Columnas inexistentes sin migración definida

El AC referencia columnas que **no existen** en el schema actual (verificado en `logCall()`):

| Columna | Tabla | Estado |
|---------|-------|--------|
| `on_chain_recorded` | `agent_calls` | ❌ No existe |
| `caller_wallet` | `agent_calls` | ❌ No verificado (logCall no la inserta) |
| `gas_avax` | `agent_calls` | ❌ No existe (AC-8 lo menciona como campo nuevo) |

**No hay ningún AC de migración DB.** El scope dice "In scope: app_settings entry for last_indexed_block" pero no menciona el ALTER TABLE para las columnas nuevas.

---

### C-4: `AgentInvoked` no tiene `tx_hash` en los datos del evento

**AC-2 dice:** "no matching `agent_calls` row exists with that `tx_hash`"

**Problema:** El ABI de `AgentInvoked` es:
```
slug (indexed), payer (address), amount, creatorShare, platformShare
```

No hay `tx_hash` en los datos del evento. El `tx_hash` se obtiene del **log de la transacción** (campo `transactionHash` del log), no del evento en sí. Esto es técnicamente manejable, pero el AC debe ser explícito: "the `tx_hash` of the transaction that emitted the event".

Además, actualmente hay **0 AgentInvoked events on-chain** porque `recordInvocationOnChain` fue removido (WAS-132). Esto significa que AC-2 es básicamente detección de casos históricamente imposibles o futuros. ¿Se reactiva `recordInvocation` on-chain? El scope dice "Out of scope: Changing existing x402 invoke flow" — entonces AC-2 detectará únicamente calls que fallaron entre el on-chain settlement y el `logCall`. Esto debe quedar explícito.

---

### C-5: RLS de `app_settings` solo permite SELECT — el cron no puede escribir

La migración 073 crea:
```sql
CREATE POLICY "app_settings_read" ON app_settings FOR SELECT USING (true);
```

No hay política de INSERT/UPDATE. El cron necesita escribir `last_indexed_block`. Soluciones posibles:
1. Usar service client (bypassa RLS) — ¿está permitido en Vercel Cron handlers?
2. Agregar policy de UPDATE para service role

Esto debe especificarse en el work item (y en la migración de dependencias).

---

## 🟡 Gaps Importantes (No bloqueantes pero deben resolverse en spec)

### I-1: Autenticación del endpoint cron no especificada

AC-1 no menciona validación de `CRON_SECRET` (header `Authorization: Bearer <secret>`). Vercel Cron requiere que el endpoint valide este header para evitar ejecución no autorizada. El work item debe especificarlo en el AC o en una sección de seguridad.

### I-2: Block de inicio (seed) no especificado

¿Cuál es el bloque inicial cuando `last_indexed_block` no existe en `app_settings`? Opciones:
- Block del deployment del contrato (hardcoded)
- `latest - N` como fallback

Sin esto, el primer run puede intentar indexar desde el bloque 0 o fallar.

### I-3: `vercel.json` cron config fuera de scope pero necesaria

El cron requiere entrada en `vercel.json`. No está mencionado en el scope. Si no existe, el endpoint existe pero nunca se ejecuta automáticamente.

### I-4: SNOWTRACE_API_KEY no mencionada como variable de entorno requerida

Si se usa Snowtrace API (recomendado por el límite de 2048 blocks del RPC), se necesita API key. No está en el scope ni en dependencias.

### I-5: AC-7 no define "último bloque exitosamente procesado" en caso de error parcial

Si el indexer procesa bloques 1000-3000 y falla al procesar el evento del bloque 2500, ¿`last_indexed_block` se setea a 2499 o a 1999? El AC dice "last successfully processed block" pero no define la granularidad (por bloque, por evento, por chunk de 2048).

### I-6: No hay AC de timeout / Vercel function limit

Un cron en Vercel tiene límite de 60s (o 300s en Pro). Si hay muchos bloques atrasados, el indexer puede exceder el límite. ¿Cuántos bloques máximo por run? ¿Hay un cap configurable?

---

## 🟢 Lo que está bien

- **AC-4 (Idempotencia):** Bien especificado. Usar `tx_hash` como deduplicación es correcto.
- **AC-6 (Paginación):** Correcto mencionar el límite de 2048 blocks del RPC y la alternativa Snowtrace.
- **AC-8 (Gas tracking):** Bien marcado como nice-to-have con `MAY`.
- **Contexto de producción:** El work item incluye estadísticas reales (156 KeyCallSettled, 5 x402) que son útiles para sizing.
- **app_settings como storage:** Correcto reusar la tabla existente (migración 073).

---

## Checklist de cobertura de paths

| Path | Cubierto | Notas |
|------|---------|-------|
| AgentInvoked nuevo (orphan) | ✅ AC-2 | Matching por tx_hash bien definido |
| AgentInvoked ya existe en DB | ✅ AC-4 | Idempotencia ok |
| KeyCallSettled matchea call existente | ⚠️ AC-3 | Matching strategy no definida |
| KeyCallSettled sin match (orphan) | ✅ AC-3 | Log warning ok |
| Error mid-run (bloque parcial) | ⚠️ AC-7 | Granularidad de rollback no definida |
| Snowtrace API down / rate limit | ❌ No cubierto | ¿Fallback a RPC? |
| Contrato reciente, 0 eventos | ❌ No cubierto | Primera ejecución sin eventos históricos |
| `last_indexed_block` no existe (primer run) | ❌ No cubierto | Seed value no definido |
| Cron ejecutado concurrentemente (overlapping runs) | ❌ No cubierto | ¿Mutex en app_settings? |

---

## Dependencias faltantes

1. **Migración DB** (BLOQUEANTE): ALTER TABLE `agent_calls` para agregar `on_chain_recorded BOOLEAN DEFAULT false`, `caller_wallet TEXT`, y opcionalmente `gas_avax NUMERIC`
2. **`vercel.json`** cron schedule entry
3. **Variable de entorno** `SNOWTRACE_API_KEY` en Vercel
4. **RLS policy** de UPDATE en `app_settings` para service role (o confirmación de que se usa service client)

---

## Recomendaciones para el autor del Work Item

1. **C-1:** Definir matching strategy para `KeyCallSettled`. Opción recomendada: agregar `settlement_tx_hash` a `agent_calls` en el settlement route, y matchear por ese campo.
2. **C-2:** Restringir AC-5 explícitamente a "calls creadas por el indexer como orphans" (`on_chain_recorded = true AND source = 'indexer'`).
3. **C-3:** Agregar AC de migración: "GIVEN the schema migration adds `on_chain_recorded`, `caller_wallet` columns to `agent_calls`".
4. **C-4:** Clarificar que `tx_hash` en AC-2 = `transactionHash` del log de la transacción (no del evento).
5. **C-5:** Agregar a dependencias: "app_settings UPDATE accessible via service role".
