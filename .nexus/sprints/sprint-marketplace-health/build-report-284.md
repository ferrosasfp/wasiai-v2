# Build Report — SDD WAS-284

## Wave execution

| Wave | Status | Build | Detalle |
|------|--------|-------|---------|
| Wave 0 | ✅ PASS | — | Re-validación OK — código ya implementado en commit previo |
| Wave 1 | ✅ DONE | ✅ PASS | `callUpstream` — `httpStatusHint` añadido al retorno |
| Wave 2 | ✅ DONE | ✅ PASS | `buildResponse` — acepta `httpStatusHint` + `options.upstreamFailed`; Route B call site actualizado |

## Commit
- Hash: `159c8b64c`
- Message: `fix(invoke): WAS-284 — upstream errors propagate correct HTTP status codes`
- Files changed: 1 (`src/app/api/v1/models/[slug]/invoke/route.ts`)

## Discrepancias encontradas
- Ninguna. El SDD coincide exactamente con la implementación presente en el código.

## Notas
- TSC build gate: PASS (sin errores de tipos)
- Route A call site (~420): sin cambios necesarios — `httpStatusHint` fluye automáticamente por el tipo
- Route B call site (~567): `upstreamFailed: result.status === 'error'` presente correctamente
- `upstream_failed: true` solo aparece en Route B cuando el upstream falla (AC6 ✅)

BUILD COMPLETE WAS-284: 159c8b64c
