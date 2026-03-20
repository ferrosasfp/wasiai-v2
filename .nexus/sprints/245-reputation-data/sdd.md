# SDD — WAS-245

## Wave 0 — Pre-flight
- Leer `src/app/api/v1/agents/[slug]/reputation/route.ts` (ya leído por SM)
- Confirmar import de `createServiceClient` disponible desde `@/lib/supabase/server`
- Confirmar que `agent_calls` tiene columna `status` y `called_at`

## Wave 1 — Fix last_invocation_at (RLS bypass)

**Archivo:** `src/app/api/v1/agents/[slug]/reputation/route.ts`

Añadir import de `createServiceClient`:
```diff
+ import { createClient, createServiceClient } from '@/lib/supabase/server'
```

Cambiar el query de `lastCall` para usar serviceClient:
```diff
- const { data: lastCall } = await supabase
+ const serviceClient = createServiceClient()
+ const { data: lastCall } = await serviceClient
    .from('agent_calls')
    .select('called_at')
    .eq('agent_id', agent.id)
    .order('called_at', { ascending: false })
    .limit(1)
    .single()
```

**Build gate:** `npm run typecheck && npm run lint`

## Wave 2 — Fix is_available (secondary signal)

En el mismo archivo, actualizar la lógica de `isAvailable`:

```diff
- const isAvailable = healthCheck?.passed === true &&
-   agent.last_checked_at !== null &&
-   agent.last_checked_at !== undefined &&
-   new Date(agent.last_checked_at as string).getTime() > Date.now() - 24 * 60 * 60 * 1000

+ // Primary signal: health_check cron result
+ const healthCheckPassed = healthCheck?.passed === true &&
+   agent.last_checked_at !== null &&
+   new Date(agent.last_checked_at as string).getTime() > Date.now() - 24 * 60 * 60 * 1000
+
+ // Secondary signal: recent successful calls (when health_check not yet populated)
+ const recentSuccessCount = callsBreakdown?.filter(
+   c => (c as { status?: string }).status === 'success'
+ ).length ?? 0
+ const hasRecentActivity = recentSuccessCount > 0
+
+ // Explicit failure overrides everything
+ const healthCheckFailed = healthCheck?.passed === false
+
+ const isAvailable = !healthCheckFailed && (healthCheckPassed || hasRecentActivity)
```

**NOTA:** `callsBreakdown` ya existe en el handler (query últimos 30 días). Pero NO tiene columna `status` en el select actual. Necesitamos añadirla:

```diff
- .select('payment_type, is_trial')
+ .select('payment_type, is_trial, status')
```

**Build gate:** `npm run typecheck && npm run lint`

## Rollback
`git revert <commit>` — 1 archivo, sin migración DB.

## Constraint Directives
- OBLIGATORIO: usar createServiceClient para query de agent_calls
- OBLIGATORIO: añadir `status` al select de callsBreakdown
- PROHIBIDO: exponer datos privados de agent_calls en el response
- PROHIBIDO: tocar otros archivos

## Commit
```
fix(WAS-245): reputation — serviceClient for last_invocation_at, secondary is_available signal
```
