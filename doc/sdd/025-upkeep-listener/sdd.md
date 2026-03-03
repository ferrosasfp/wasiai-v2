# SDD-025 — Upkeep Listener (WAS-82)

**Versión:** 1.0  
**Fecha:** 2026-03-02  
**Autor:** Architect (NexusAgil / San)  
**Estado:** SPEC_APPROVED  
**HU relacionada:** WAS-82 — Trigger settlement cuando Chainlink ejecuta performUpkeep

---

## 1. Contexto y Problema

Chainlink Automation ejecuta `performUpkeep()` en el contrato WasiAIMarketplace.sol cuando las condiciones de liquidación se cumplen (dinero acumulado supera umbral, tiempo mínimo transcurrido). Sin embargo, el settlement real (distribución de fondos off-chain en Supabase + marcado de `settled_at`) vive en el cron `settle-key-batches`.

**Problema:** Cuando `settlement_mode = 'chainlink'`, el cron existente hace skip (línea 45-48 de settle-key-batches/route.ts). Nadie dispara el settlement off-chain después del `performUpkeep`. Los fondos se mueven on-chain pero Supabase queda desactualizado.

**Objetivo:** Detectar que Chainlink ejecutó `performUpkeep` y disparar `settleKeyBatchOnChain()` para cada key pendiente.

---

## 2. Context Map

| Archivo | Líneas relevantes | Rol |
|---------|-------------------|-----|
| `src/app/api/cron/settle-key-batches/route.ts` | L1-299 | Settlement existente — contiene toda la lógica de liquidación por key. L45-48: skip si `chainlink` mode. L220: `settleKeyBatchOnChain()` call. |
| `src/lib/contracts/marketplaceClient.ts` | L14-17: imports viem. L26-52: singleton `getOperatorClient()`. L218-250: `settleKeyBatchOnChain()`. L47-52: `getOperatorClient()` con `public` client. | Cliente on-chain, patrón a seguir para `getLogs` y `readContract`. |
| `src/lib/contracts/WasiAIMarketplace.ts` | L206-214: ABI `checkUpkeep` (view, returns `upkeepNeeded: bool`). L230-236: ABI evento `UpkeepPerformed(timestamp indexed, performer indexed)`. | ABI fuente de verdad. |
| `vercel.json` | L1-7: crons array con un entry existente `settle-key-batches`. | Config de Vercel Crons — se agrega entry nuevo. |

---

## 3. Decisión de Arquitectura

### Opción elegida: Vercel Cron polling con `checkUpkeep()`

**Mecanismo:**
1. Vercel Cron ejecuta `GET /api/cron/upkeep-listener` cada 5 minutos
2. El handler llama `checkUpkeep()` on-chain (view function, sin gas, sin costo)
3. Si `upkeepNeeded = true` → ejecuta el mismo pipeline de settlement que `settle-key-batches`
4. Si `upkeepNeeded = false` → retorna `{ ok: true, settled: 0, reason: 'upkeep_not_needed' }`

**Por qué `checkUpkeep()` en vez de `getLogs(UpkeepPerformed)`:**
- `checkUpkeep()` es la fuente canónica de verdad del contrato — si Chainlink lo usa para decidir, nosotros también
- `getLogs` requiere trackear el último bloque procesado (estado persistente) → necesita tabla en Supabase o variable global (frágil en serverless)
- `checkUpkeep()` es stateless: si hay liquidaciones pendientes, `upkeepNeeded = true`; si no, `false`
- Idempotente: llamar dos veces no tiene efecto doble (las keys ya liquidadas no tienen `unsettled calls`)

### Alternativas descartadas

| Alternativa | Por qué no |
|-------------|------------|
| `watchContractEvent` (viem) | Requiere proceso persistente (Node.js long-running). Viola constraint Zero infrastructure cost. |
| Railway / Fly.io listener | Costo mensual nuevo. PROHIBIDO por constraint. |
| `getLogs` polling con block tracking | Requiere estado persistente (último bloque). Más complejo sin ventaja real vs `checkUpkeep`. |
| Chainlink Functions callback | Requiere suscripción adicional a Chainlink. Costo nuevo. |

### Trade-offs de la opción elegida

| Pro | Con |
|-----|-----|
| $0 costo adicional | Latencia máxima 5 min (Vercel Cron, no garantiza exactitud) |
| Stateless, idempotente | Hobby plan: 2 crons totales (ya tenemos 1, quedarían 2 de 2) |
| Reutiliza lógica existente | Si Chainlink ejecuta múltiples veces en <5min, solo el último dispara settlement |
| Sin nuevo infraestructura | — |

---

## 4. Diseño del Endpoint

### `GET /api/cron/upkeep-listener`

**Archivo a crear:** `src/app/api/cron/upkeep-listener/route.ts`

**Flujo:**

```
1. Verificar CRON_SECRET (mismo patrón que settle-key-batches:L24-34)
2. readContract → checkUpkeep('0x') → { upkeepNeeded, performData }
3. Si !upkeepNeeded → return { ok: true, settled: 0, reason: 'upkeep_not_needed' }
4. Si upkeepNeeded → ejecutar pipeline de settlement (inline o via fetch interno)
5. Retornar resultado del settlement
```

**Decisión de implementación del pipeline:**
- Opción A (recomendada): Duplicar pipeline simplificado inline (sin la lógica de `settlement_mode` skip)
- Opción B: `fetch('/api/cron/settle-key-batches')` interno — pero requiere pasar header auth y puede generar loops si settlement_mode cambia
- **Elegir Opción A**: Más robusto, el dev controla exactamente qué se ejecuta

**Variables de entorno requeridas (ya existentes):**
- `CRON_SECRET` — autenticación
- `OPERATOR_PRIVATE_KEY` — firma on-chain
- `MARKETPLACE_CONTRACT_ADDRESS` — dirección del contrato
- `NEXT_PUBLIC_RPC_TESTNET` / `NEXT_PUBLIC_RPC_MAINNET` — RPC

---

## 5. Archivos a Crear / Modificar

### Crear
```
src/app/api/cron/upkeep-listener/route.ts
```
- Handler GET con auth CRON_SECRET
- `readContract` → `checkUpkeep`
- Pipeline de settlement (importar funciones de marketplaceClient y lógica de supabase)

### Modificar
```
vercel.json
```
- Agregar entry en `crons[]`:
```json
{
  "path": "/api/cron/upkeep-listener",
  "schedule": "*/5 * * * *"
}
```

---

## 6. ACs Técnicos Verificables

| AC | Descripción | Verificación |
|----|-------------|--------------|
| AC-1 | El sistema detecta y procesa `upkeepNeeded=true` en ≤ 5 minutos desde que Chainlink ejecuta `performUpkeep` | `vercel.json` contiene `"*/5 * * * *"` para `/api/cron/upkeep-listener` |
| AC-2 | El endpoint retorna `{ ok: true, reason: 'upkeep_not_needed' }` cuando `checkUpkeep()` devuelve `false` | `src/app/api/cron/upkeep-listener/route.ts` contiene branch con `reason: 'upkeep_not_needed'` |
| AC-3 | El endpoint ejecuta settlement cuando `upkeepNeeded = true` y retorna `{ ok: true, settled: N }` | Test manual en Fuji con unsettled calls en DB |
| AC-4 | El endpoint rechaza requests sin `Bearer CRON_SECRET` con HTTP 401 | `route.ts:~L30` contiene check `authHeader !== \`Bearer \${cronSecret}\`` |
| AC-5 | `npm run build` pasa sin errores TypeScript | CI o build local |
| AC-6 | El endpoint no ejecuta settlement si `checkUpkeep()` lanza error RPC | Try/catch en la llamada a `readContract`, retorna 500 con mensaje |

---

## 7. Constraint Directives

### OBLIGATORIO
- `CRON_SECRET` verificado antes de cualquier lógica (patrón idéntico a settle-key-batches:L24-34)
- Usar `publicClient.readContract` para `checkUpkeep` (view function, sin wallet)
- Usar `getOperatorClient()` singleton de `marketplaceClient.ts` para operaciones con firma
- `logger.*` para todos los eventos relevantes (mismo patrón existente)
- Retornar siempre JSON con `{ ok: boolean }` como campo raíz
- `vercel.json` schedule en formato cron estándar (`*/5 * * * *`)

### PROHIBIDO
- `watchContractEvent` — requiere proceso persistente
- Nuevos servicios de infraestructura (Railway, Fly.io, etc.)
- Hardcodear direcciones de contrato o claves privadas
- Llamar a `performUpkeep()` desde el cron — Chainlink lo ejecuta; nosotros solo leemos el estado
- Modificar `settle-key-batches/route.ts` — no tocar el cron existente
- Bucles infinitos o re-fetch del mismo endpoint

---

## 8. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Vercel Hobby plan limita a 2 crons | Media | Medio | Ya tenemos 1 cron; límite es 2. Si en el futuro se necesitan más, upgrade a Pro o consolidar. |
| `checkUpkeep()` devuelve `true` pero las keys ya están liquidadas (falso positivo) | Baja | Bajo | Settlement es idempotente — si no hay `unsettled calls`, retorna `settled: 0` sin error. |
| RPC falla durante `readContract` | Media | Medio | Try/catch → return 500. Vercel reintenta el cron en el siguiente ciclo (5 min). |
| Chainlink ejecuta `performUpkeep` varias veces entre ciclos de 5 min | Baja | Bajo | `checkUpkeep()` devuelve el estado actual — si ya fue ejecutado, `upkeepNeeded = false`. Idempotente. |
| Doble ejecución concurrente del cron | Baja | Medio | Vercel garantiza una instancia por schedule, pero si hay overlap manual, el settlement es idempotente por `settled_at IS NULL`. |

---

## 9. DoD (Definition of Done)

- [ ] `src/app/api/cron/upkeep-listener/route.ts` creado con auth + checkUpkeep + settlement pipeline
- [ ] `vercel.json` actualizado con schedule `*/5 * * * *`
- [ ] `npm run build` pasa 0 errores
- [ ] Test manual en Fuji: hit endpoint con `Bearer CRON_SECRET` cuando hay unsettled calls → retorna `{ ok: true, settled: N }`
- [ ] Test manual: cuando no hay unsettled calls → retorna `{ ok: true, reason: 'upkeep_not_needed' }` o `settled: 0`
- [ ] `git push origin master && git push origin master:main`
