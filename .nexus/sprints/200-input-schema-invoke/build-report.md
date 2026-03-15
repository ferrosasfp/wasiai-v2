# Build Report — WAS-200

## Wave execution

| Wave | Status | Build | Detalle |
|------|--------|-------|---------|
| Wave 0 | ✅ PASS | — | Migración 054 confirmada (`supabase/migrations/054_input_schema.sql` existe, columna `input_schema JSONB` en `agents`). Supabase local no corre en este env, verificado via archivo de migración. |
| Wave 1 | ✅ PASS | ✅ `tsc --noEmit` sin errores | Añadido import `validateInput` + bloque pre-cobro en `invoke/route.ts`. Inserción: DESPUÉS de circuit breaker check, ANTES de `// ── 2. Route A`. Usa `request.clone().json()`. |
| Wave 2 (Commit) | ✅ DONE | — | Commit local completado. NO git push. |

## Commit

- Hash: `c1d5e55d7`
- Message: `feat(WAS-200): validateInput pre-cobro en invoke principal`
- Files changed: 1 (`src/app/api/v1/models/[slug]/invoke/route.ts`)

## Discrepancias encontradas

Ninguna. El SDD ya tenía las asunciones correctas:
- `input_schema` en GET `/agents/:slug` y GET `/agents` (full path) ya estaban implementados — Waves 2 & 3 originales correctamente eliminadas del SDD.
- `callUpstream` consume el body vía `request.json()` internamente — confirmado, `request.clone()` es la solución correcta.
- Punto de inserción (línea ~226, antes de `if (rawAgentKey)`) coincide exactamente con lo descrito.

## Notas para el Auditor

1. **Import añadido:** `import { validateInput } from '@/lib/schema-validator'` en línea 33 de `invoke/route.ts`.
2. **Bloque insertado:** 20 líneas, antes del comentario `// ── 2. Route A: Agent Key`. Comentado con `// WAS-200`.
3. **`request.clone().json()`:** Correctamente usado para no consumir el stream del request principal que `callUpstream` leerá después.
4. **`details: [validErr]`:** `validateInput` retorna `string | null`; wrapeado en array para cumplir AC2.
5. **Skip si null:** `if (model.input_schema)` — si es null/falsy, skip completo (AC3 satisfecho).
6. **PROHIBIDOS respetados:** No se modificó `schema-validator.ts`, no se añadió SSRF check, no se re-aplicó migración 054, no hay `git push`.
7. **AC5/AC6:** Ya implementados en prod — confirmado vía grep en los archivos GET. No tocados.
