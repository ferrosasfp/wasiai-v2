## Build Report — WAS-186

### Wave execution

| Wave | Status | Build | Detalle |
|------|--------|-------|---------|
| 0 | ✅ | — | Verificación: SELECT en invoke ~162 coincide con SDD. compose/route.ts tiene 2 ocurrencias `scope_violation`. errors.tsx tiene 1. Migración 053 asumida en prod (no re-aplicada). |
| 1 | ✅ | ✅ clean | Añadido `allowed_slugs, allowed_categories` al SELECT de agent_keys en invoke/route.ts |
| 2 | ✅ | ✅ clean | Import `isAgentInScope` + scope check añadido en Route A, ANTES del mutex/payment (AC2, AC3, AC4, AC5, AC7) |
| 3 | ✅ | ✅ clean | compose/route.ts: 2 ocurrencias `scope_violation` → `agent_not_in_scope`. errors.tsx: code actualizado. |
| 4 | ✅ | — | Commit local realizado |

### Commit

- Hash: `1adff0201`
- Message: `fix(WAS-186): scope check en invoke directo + unificar error code agent_not_in_scope`
- Files changed: 3

### Discrepancias encontradas

Ninguna. El código real coincidía exactamente con las asunciones del SDD.

### Notas para el Auditor

- El scope check se insertó DESPUÉS de `if (!keyRow)` return 401 y ANTES del mutex Redis — orden correcto per AC2.
- `isEmptyScope` cubre el caso AC3: array vacío `[]` = sin acceso (early return explícito, no sentinel string).
- `isAgentInScope` recibe `null` cuando no hay scope definido, preservando acceso total (AC4).
- Lógica OR para slugs+categories preservada via `isAgentInScope` (AC5).
- `src/lib/scope-check.ts` no fue modificado (constraint PROHIBIDO respetado).
- Migración 053 no re-aplicada (constraint PROHIBIDO respetado).
- No se hizo `git push` (constraint PROHIBIDO respetado).
