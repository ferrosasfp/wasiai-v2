# WAS-245 — Work Item

**Tipo:** BUG FIX | **Clasificación:** HU-MINOR

## Root Causes

1. **`last_invocation_at: null`** — El query de `agent_calls` usa `createClient()` (anon/user session). Con RLS activo, la anon session no puede leer `agent_calls` de otros usuarios → retorna null silenciosamente. Fix: usar `createServiceClient()` (bypass RLS).

2. **`is_available: false`** — `health_check` es null en todos los agentes porque el cron `reputation-batch` no ha poblado ese campo, o no está corriendo. Fix: añadir señal secundaria: si hay llamadas exitosas recientes (últimas 24h en `agent_calls`), marcar `is_available: true` aunque `health_check` sea null.

## ACs
- AC-01: `last_invocation_at` devuelve la fecha real de la última call cuando existen agent_calls
- AC-02: `is_available: true` cuando hay calls exitosas en las últimas 24h (aunque health_check sea null)
- AC-03: `is_available` sigue siendo `false` si health_check falla explícitamente (passed: false)
- AC-04: No se expone data privada de agent_calls (solo el timestamp)
- AC-05: Shape del response se preserva completamente

## Files
- `src/app/api/v1/agents/[slug]/reputation/route.ts` — MODIFY
