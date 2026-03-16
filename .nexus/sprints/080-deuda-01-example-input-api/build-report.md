# Build Report — DEUDA-01

## Wave execution

| Wave | Status | Build | Detalle |
|------|--------|-------|---------|
| Wave 0 | ✅ PASS | — | Pre-flight OK. `metadata`/`example_input` ausentes en los 3 routes. `buildExampleFromSchema` y `EXAMPLE_FALLBACK` confirmados en `src/features/agents/utils/buildExampleFromSchema.ts`. Fix no pre-implementado. |
| Wave 1 | ✅ PASS | ✅ 0 errores | Creado `src/features/agents/utils/resolveExampleInput.ts` con jerarquía correcta (metadata → capabilities → schema → fallback). |
| Wave 2 | ✅ PASS | ✅ 0 errores | `src/app/api/v1/agents/[slug]/route.ts`: agregado `metadata` al SELECT y `example_input: resolveExampleInput(agent)` al body. |
| Wave 3 | ✅ PASS | ✅ 0 errores | `src/app/api/v1/agents/route.ts`: `example_input` agregado en los 3 map blocks (search, slim, full). `src/app/api/v1/agents/discover/route.ts`: `example_input` agregado via spread+map. |
| Wave 4 | ✅ PASS | ✅ 0 errores | Build final limpio. Commit realizado. |

## Commit

- **Hash:** `30aa15fcd`
- **Message:** `feat(DEUDA-01): expose resolved example_input in agents API endpoints`
- **Files changed:** 5
  - `src/features/agents/utils/resolveExampleInput.ts` (nuevo)
  - `src/app/api/v1/agents/[slug]/route.ts` (modificado)
  - `src/app/api/v1/agents/route.ts` (modificado)
  - `src/app/api/v1/agents/discover/route.ts` (modificado)
  - `.nexus/sprints/079-was-206-schema-obligatorio/build-report.md` (staged previamente)

## Notas

- El slim query en `/agents` no incluye `metadata`/`capabilities`/`input_schema` en el SELECT (por diseño de rendimiento), por lo que `resolveExampleInput` devuelve `EXAMPLE_FALLBACK` para esos items. Comportamiento correcto según la garantía del util.
- Discover usa RPC `discover_agents_v2`; el spread agrega `example_input` como campo aditivo sin modificar la estructura existente.
