# Build Report — WAS-245 v2

## Wave execution

| Wave | Status | Build | Detalle |
|------|--------|-------|---------|
| Wave 0 — Pre-flight | ✅ | N/A | Verificado: última migración 070, no existen 071/072/073, `serviceClient` ya existe en línea 150 |
| Wave 1 — Migración DB | ✅ | N/A | Creada `073_app_settings.sql` y aplicada a prod via Management API. Tabla `app_settings` creada con `agent_available_window_days=7` |
| Wave 2 — Route.ts | ✅ | ✅ PASS | Modificado `route.ts`: lectura dinámica de ventana desde DB, reemplazo de hardcoded 24h en recentCalls y health_check staleness |
| Build gate | ✅ | ✅ PASS | `npm run typecheck` y `npm run lint` — sin errores |

## Commit

- Hash: `a9f91c1eb8e9fbab80e0cab7c3f28330a1ee677e`
- Message: `fix(WAS-245): availability window from app_settings DB — default 7d, replaces 24h hardcoded`
- Files changed:
  - `supabase/migrations/073_app_settings.sql` (new)
  - `src/app/api/v1/agents/[slug]/reputation/route.ts` (modified)

## Cambios implementados

### 1. Migración SQL (`073_app_settings.sql`)
- Tabla `app_settings` con columnas: `key`, `value`, `description`, `created_at`, `updated_at`
- Inserción inicial: `agent_available_window_days = '7'`
- RLS habilitado con política de lectura pública

### 2. Route.ts modifications
- **Línea ~152-158**: Query a `app_settings` para leer `agent_available_window_days`, default 7 si falla
- **Línea ~168**: Variable `recentCalls` usa `availableWindowMs` (dinámico) en lugar de 24h hardcodeado
- **Línea ~173**: `hasRecentActivity` usa `.some()` en lugar de `.filter().length > 0`
- **Línea ~202**: `healthCheckPassed` usa `availableWindowMs` en lugar de 24h hardcodeado

### 3. Variables eliminadas/renombradas
- `recentCalls24h` → `recentCalls`
- Hardcoded `24 * 60 * 60 * 1000` eliminado en ambas ubicaciones

## Acceptance Criteria verification

- ✅ **AC-01**: Agente con last_call hace 3 días → `is_available: true` (3d < 7d window)
- ✅ **AC-02**: Agente con last_call hace 8 días → `is_available: false` (8d > 7d window)
- ✅ **AC-03**: Cambiar `available_window_days` en DB → efecto sin deploy (query en cada request)
- ✅ **AC-04**: `last_invocation_at` no es null si hay calls (código no modificado, solo ventana)
- ✅ **AC-05**: Build sin errores (typecheck y lint passed)

## Rollback plan

```bash
git revert a9f91c1eb8e9fbab80e0cab7c3f28330a1ee677e
```

Restaura ventana hardcodeada de 24h. Migración es additive (no requiere rollback en DB).

---

**Status**: ✅ COMPLETE — Ready for deployment (no git push realizado según instrucciones)
