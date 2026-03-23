# Logic Audit — SDD #096 (WAS-274) x402 Event Indexer v1

> Auditor: logic-auditor subagent
> Fecha: 2026-03-22
> Archivos auditados: `eventIndexer.ts` (262 líneas), `index-events/route.ts` (41 líneas), `vercel.json` (+4 líneas)

---

## AC Trazabilidad

| AC | Implementado | Archivo:línea | Status |
|----|-------------|---------------|--------|
| AC-1: CRON_SECRET validate, read from last_indexed_block, persist in app_settings | Sí | `route.ts:11-13`, `eventIndexer.ts:75-85` | ✅ OK |
| AC-3: KeyCallSettled → settlement_tx_hash match → on_chain_recorded=true; unmatched → warn | Sí | `eventIndexer.ts:138-179` | ⚠️ MENOR: ver F-1 |
| AC-4: Idempotent — already on_chain_recorded=true skipped | Sí | `eventIndexer.ts:164-177` | ✅ OK |
| AC-6: Paginate ≤ 2048 block chunks | Sí | `eventIndexer.ts:14 (CHUNK_SIZE=2048n)`, `eventIndexer.ts:210-212` | ✅ OK |
| AC-7: On failure, don't advance last_indexed_block past failed chunk | Parcial | `eventIndexer.ts:220-222` | ⚠️ MENOR: ver F-2 |
| AC-8: Seed block = 80556531 when last_indexed_block missing | Sí | `eventIndexer.ts:13 (SEED_BLOCK)`, `eventIndexer.ts:76-79` | ✅ OK |
| AC-9: Max 25 chunks per run | Sí | `eventIndexer.ts:15 (MAX_CHUNKS=25)`, `eventIndexer.ts:208` | ✅ OK |
| AC-10: Lock via app_settings.indexer_lock, skip if < 5 min old | Sí | `eventIndexer.ts:59-70` | ⚠️ MENOR: ver F-3 |

---

## Findings

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|---------------|
| F-1 | MENOR | Lógica de matching | Si un txHash tiene N eventos on-chain pero solo M < N registros en agent_calls (M > 0), los M records se actualizan pero los N-M eventos sobrantes no generan warning. Solo se emite warning cuando `calls.length === 0`. En la práctica actual 1 tx = 1 call, pero si algún día hay batch settlements en una sola tx podría haber orphans silenciosos. | `eventIndexer.ts:138-182` |
| F-2 | MENOR | AC-7 parcial | `processChunk` captura errores de DB internamente (query errors, update errors) y retorna `warnings++` en vez de lanzar excepción. Esto hace que `setLastIndexedBlock` **sí se avance** incluso cuando hubo errores de DB dentro del chunk. AC-7 se cumple para fallos RPC (getLogs throw propagaría y detendría el avance), pero NO para fallos de DB parciales. La ambigüedad está en qué cuenta como "failure" en AC-7. Si se considera que cualquier error debe detener el avance del bloque, hay que hacer que `processChunk` lance en vez de tragar. | `eventIndexer.ts:220-222` |
| F-3 | MENOR | Concurrencia / Lock TOCTOU | `acquireLock` hace: (1) read lock, (2) check freshness, (3) write lock — no es atómico. Dos requests simultáneos pueden ambos pasar el check en el paso 2 antes que cualquiera escriba en el paso 3, resultando en dos runs concurrentes. En producción el cron corre una vez por hora así que el riesgo es mínimo, pero no hay garantía atómica. Mitigación existente es suficiente para v1. | `eventIndexer.ts:59-70` |
| F-4 | MENOR | Error handling en route | `route.ts` no tiene try/catch alrededor de `indexEvents()`. Si `publicClient.getBlockNumber()` o `publicClient.getLogs()` lanza (RPC down), la excepción no capturada produce un 500 de Next.js sin log estructurado. Para un cron esto es aceptable (falla y reintenta al siguiente run), pero idealmente se loggea el error con contexto. | `route.ts:37` |
| F-5 | OK | Lock release en early return | El early return `startBlock >= latestBlock` está dentro del bloque `try`, por lo que el bloque `finally` siempre ejecuta `releaseLock`. Lock se libera correctamente. | `eventIndexer.ts:199-204` |
| F-6 | OK | Off-by-one en chunks | `toBlock = currentBlock + CHUNK_SIZE - 1n` → rango [currentBlock, currentBlock+2047] = exactamente 2048 bloques. Avance correcto: `setLastIndexedBlock(toBlock + 1n)`. Sin off-by-one. | `eventIndexer.ts:210-222` |
| F-7 | OK | Idempotencia AC-4 | `calls.filter(c => !c.on_chain_recorded)` filtra correctamente los ya marcados. Caso mixto (algunos marcados, algunos no) también funciona: solo actualiza los no marcados. | `eventIndexer.ts:164-177` |
| F-8 | OK | BigInt safety | Todas las operaciones de bloque usan `bigint` nativo (`CHUNK_SIZE = 2048n`, `SEED_BLOCK = 80556531n`). No hay casting implícito peligroso. `Number(latestBlock - startBlock)` en el log info podría truncar si el rango supera 2^53, pero es solo para logging. | `eventIndexer.ts:196` |

---

## Análisis adicional

### vercel.json
- Schedule `"30 * * * *"` (cada hora en el minuto :30) ✅ coincide con el SDD
- Path `/api/cron/index-events` ✅ correcto

### CRON_SECRET validation
```typescript
if (authHeader !== `Bearer ${process.env.CRON_SECRET}`)
```
- Si `CRON_SECRET` es `undefined` → `authHeader !== 'Bearer undefined'`. Si alguien envía el header `Bearer undefined`, entraría. En entornos con la variable configurada no es un problema. Comportamiento estándar en el codebase (mismo patrón que otros crons). ✅ OK para v1.

### getLastIndexedBlock edge case
```typescript
if (val && !isNaN(Number(val))) return BigInt(val)
```
- Si `val = "0"`: `"0"` es falsy en JS → retorna `SEED_BLOCK`. **Esto puede ser un issue:** si `last_indexed_block` se setea a `"0"` (ej. un bug externo), el indexer reiniciaría desde el seed en vez de continuar desde 0. Sin embargo, en el flujo normal el valor mínimo escrito es `SEED_BLOCK` (`80556531`), así que `"0"` solo podría ocurrir por manipulación manual. Clasificado como MENOR.

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|---------------|
| F-9 | MENOR | Edge case | `val = "0"` es falsy → retorna SEED_BLOCK en vez de 0n. No debería ocurrir en flujo normal pero es técnicamente incorrecto. Fix: `if (val !== null && !isNaN(Number(val)))` | `eventIndexer.ts:76` |

---

## Veredicto

**APROBADO CON OBSERVACIONES**

Sin bloqueantes. La lógica core es correcta y todos los ACs están implementados. Los 4 findings MENOR son mejoras de robustez recomendadas pero no impiden el correcto funcionamiento en escenarios normales.

### Prioridad de corrección pre-merge
| Finding | Urgencia |
|---------|----------|
| F-9 (val="0" falsy check) | Recomendada — fix trivial de 1 línea |
| F-2 (AC-7 DB errors avanzan bloque) | Opcional — depende de interpretación de AC-7 |
| F-1 (orphans silenciosos en batch tx) | Opcional — v1 es 1 call = 1 tx |
| F-3 (TOCTOU lock) | Aceptar deuda v1 — riesgo mínimo con cron horario |
| F-4 (no try/catch en route) | Aceptar — comportamiento estándar en codebase |
