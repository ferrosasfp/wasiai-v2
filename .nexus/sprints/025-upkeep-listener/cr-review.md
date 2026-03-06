# Code Review — WAS-82 / NNN-025
**Fecha:** 2026-03-02  
**Reviewer:** Adversary + QA (NexusAgil)  
**Commits:** `0344d3e` (implementación) + `9429025` (fix lock)  
**AR previo:** APPROVED ✅  
**Resultado:** ✅ **APPROVED**

---

## Archivos revisados

| Archivo | Líneas |
|---------|--------|
| `src/lib/settlement/runSettlement.ts` | ~274 |
| `src/app/api/cron/upkeep-listener/route.ts` | ~77 |
| `src/app/api/cron/settle-key-batches/route.ts` | ~50 |
| `vercel.json` | +4 |

---

## Checks

### 1. Patrones ✅ CUMPLE

`upkeep-listener` sigue el mismo patrón que `settle-key-batches`:

- **Auth:** Idéntico — `CRON_SECRET` Bearer, misma secuencia (check ausencia → 500, check valor → 401)
- **Logger:** Mismo prefijo bracketed `[upkeep-listener]`, mismos niveles (error/warn/info)
- **Response shape:** Ambos retornan `{ ok, settled, keys, results }` en éxito; `{ error }` en fallo; `{ skipped, reason }` en skip
- **Diferencia intencional:** `upkeep-listener` no verifica `settlement_mode` — correcto, su gate es `upkeepNeeded` on-chain en lugar del modo DB

### 2. Naming ✅ CUMPLE

- `runSettlement` — nombre claro, verbo+sustantivo, describe exactamente su función pública
- `_runSettlementPipeline` — convención de underscore para función privada del módulo, diferencia clara de responsabilidad (lock vs pipeline)
- Ambos consistentes con el estilo del proyecto (`settleKeyBatchOnChain`, `createServiceClient`, `immediateSettlement`)

### 3. Complejidad ✅ CUMPLE

- `runSettlement` tiene responsabilidad única: **gestión del advisory lock**. Delega 100% al pipeline.
- `_runSettlementPipeline` tiene responsabilidad única: **ejecutar el settlement**. No toca el lock.
- El lock (compare-and-swap en `system_config`) no contiene lógica de negocio — solo guarda/libera estado.
- `_runSettlementPipeline` es ~200 líneas, denso pero cohesivo (un dominio, una operación). Aceptable para producción.

### 4. Duplicación ✅ CUMPLE

- `settle-key-batches/route.ts` quedó en ~50 líneas, completamente libre de lógica de settlement
- Toda la lógica compartida migró a `runSettlement.ts`
- No hay duplicación de queries, mapas ni lógica de batch entre los dos route handlers
- Extracción limpia — refactor exitoso

### 5. Imports ✅ CUMPLE

**`runSettlement.ts`**
- `SupabaseClient` — `@supabase/supabase-js` (dep existente)
- `settleKeyBatchOnChain` — `@/lib/contracts/marketplaceClient` (existente)
- `PENDING_WALLET_SENTINEL` — `@/lib/settlement/immediateSettlement` (existente)
- `logger` — `@/lib/logger` (existente)
- Sin imports sin usar ✅

**`upkeep-listener/route.ts`**
- `createPublicClient`, `http` — `viem` (dep existente)
- `avalanche`, `avalancheFuji` — `viem/chains` (existente)
- `WASIAI_MARKETPLACE_ABI` — `@/lib/contracts/WasiAIMarketplace` (existente)
- `createServiceClient`, `runSettlement`, `logger` — internos existentes
- Sin imports sin usar ✅

**`settle-key-batches/route.ts`**
- Todos internos existentes. Sin residuos de la extracción ✅

### 6. Límites de tamaño ✅ CUMPLE

| Archivo | Tamaño | Veredicto |
|---------|--------|-----------|
| `runSettlement.ts` | ~274 líneas | Aceptable — contiene el pipeline completo de un dominio |
| `upkeep-listener/route.ts` | ~77 líneas | ✅ Óptimo |
| `settle-key-batches/route.ts` | ~50 líneas | ✅ Óptimo |
| `vercel.json` | +4 líneas | ✅ Mínimo |

---

## Sugerencias (no bloqueantes)

> No requieren cambios para aprobar.

1. **`upkeep-listener` sin try/catch en `runSettlement()`:** Si el pipeline lanza, el cron devuelve un 500 no manejado. `settle-key-batches` tiene el mismo patrón. Aceptable por ahora; considerar envolver en try/catch en ambos para logging explícito en futura iteración.

2. **`_runSettlementPipeline` — prefijo underscore en TypeScript:** La convención de "privado" con underscore es válida, pero en TS podría usarse `function` interna al módulo sin export (ya lo hace). El underscore es redundante semánticamente pero no hace daño. Decisión de estilo libre.

---

## Conclusión

El refactor es limpio y bien ejecutado. `runSettlement.ts` es la única fuente de verdad para el pipeline. Los dos route handlers son thin wrappers con responsabilidades claras y distintas. El advisory lock está correctamente separado del negocio. No se detectaron issues bloqueantes.

**✅ APPROVED — Listo para F4 (Validación)**
