# SDD — WAS-245 v2: Ventana de disponibilidad configurable desde DB

## Context
`hasRecentActivity` usa ventana de 24h hardcodeada. Agentes con last_call hace 25-48h
(ej: wasi-onchain-analyzer, last=2026-03-18) quedan como `is_available=false` incorrectamente.
El usuario confirmó: ampliar a 7 días, y hacerlo configurable desde DB.

También: `health_check` staleness usa 24h hardcodeada en línea 199.

## Acceptance Criteria
- AC-01: Agente con last_call hace 3 días → `is_available: true`
- AC-02: Agente con last_call hace 8 días → `is_available: false`
- AC-03: Cambiar `available_window_days` en DB → efecto sin deploy
- AC-04: `last_invocation_at` no es null si hay calls en `agent_calls`
- AC-05: Build sin errores

## Wave 0 — Pre-flight
1. Leer `src/app/api/v1/agents/[slug]/reputation/route.ts` — localizar todas las ventanas hardcodeadas
2. Confirmar que `app_settings` tabla no existe (si existe, usar la existente)
3. Confirmar número de última migración

## Wave 1 — Migración: tabla app_settings
Crear `supabase/migrations/073_app_settings.sql`:
```sql
-- 073_app_settings.sql
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO app_settings (key, value, description) VALUES
  ('agent_available_window_days', '7', 'Days since last successful call to consider agent available')
ON CONFLICT (key) DO NOTHING;

-- RLS: lectura pública
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_settings_read" ON app_settings FOR SELECT USING (true);
```

Aplicar con Supabase management API.

## Wave 2 — Leer ventana desde DB en reputation route
En `src/app/api/v1/agents/[slug]/reputation/route.ts`:

1. Después de obtener `serviceClient`, leer el setting:
```typescript
const { data: windowSetting } = await serviceClient
  .from('app_settings')
  .select('value')
  .eq('key', 'agent_available_window_days')
  .single()
const availableWindowDays = parseInt(windowSetting?.value ?? '7', 10)
const availableWindowMs = availableWindowDays * 24 * 60 * 60 * 1000
```

2. Reemplazar el query de `recentCalls24h` (línea ~161) con la ventana dinámica:
```typescript
const { data: recentCalls } = await serviceClient
  .from('agent_calls')
  .select('status')
  .eq('agent_id', agent.id)
  .gte('called_at', new Date(Date.now() - availableWindowMs).toISOString())

const hasRecentActivity = (recentCalls ?? []).some(c => c.status === 'success')
```

3. Reemplazar el health_check staleness check (línea ~199) con la misma ventana:
```typescript
const healthCheckPassed =
  agent.health_check?.passed === true &&
  new Date(agent.last_checked_at as string).getTime() > Date.now() - availableWindowMs
```

4. Eliminar variable `recentCalls24h` y la referencia a `24 * 60 * 60 * 1000` hardcodeada.

**Build gate:** `npm run typecheck && npm run lint`

## Rollback
`git revert HEAD` — restaura ventana de 24h. La migración es additive.

## Critical Constraints
- `serviceClient` para leer app_settings (bypass RLS)
- Si DB query falla → default 7 días (no 24h ni 0)
- No modificar otros aspectos del reputation endpoint
- La variable `availableWindowDays` debe declararse antes de cualquier query que la use
