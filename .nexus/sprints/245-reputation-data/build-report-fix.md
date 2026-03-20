# Build Report — WAS-245 Fix F-01

## Wave Execution

| Wave | Status | Build | Detalle |
|------|--------|-------|---------|
| Wave 0 — Pre-flight | ✅ | — | Localizó `serviceClient` (L148), `callsBreakdown` (L157-162), código problemático (L185-189) |
| Wave 1 — Fix 24h query | ✅ | ✅ PASS | Añadido query separado `recentCalls24h` con window 24h. Removido cálculo viejo `recentSuccessCount`. Removido campo `status` de `callsBreakdown.select()` (ya no usado). |
| Build Gate | ✅ | ✅ PASS | `npm run typecheck` ✅ `npm run lint` ✅ |

## Commit

- **Hash:** `8cd98c03f`
- **Message:** `fix(WAS-245): hasRecentActivity uses 24h window — separate serviceClient query`

## Changes Summary

### Before
```typescript
// callsBreakdown query (30-day window)
const { data: callsBreakdown } = await supabase
  .from('agent_calls')
  .select('payment_type, is_trial, status')  // incluía status
  .eq('agent_id', agent.id)
  .gte('called_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())

// Cálculo incorrecto usando 30 días
const recentSuccessCount = callsBreakdown?.filter(
  (c: { status?: string }) => c.status === 'success'
).length ?? 0
const hasRecentActivity = recentSuccessCount > 0
```

### After
```typescript
// Nuevo query específico para 24h
const { data: recentCalls24h } = await serviceClient
  .from('agent_calls')
  .select('status')
  .eq('agent_id', agent.id)
  .gte('called_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

const hasRecentActivity = (recentCalls24h ?? []).filter(
  (c: { status?: string }) => c.status === 'success'
).length > 0

// callsBreakdown ya no necesita campo status
const { data: callsBreakdown } = await supabase
  .from('agent_calls')
  .select('payment_type, is_trial')  // status removido
  .eq('agent_id', agent.id)
  .gte('called_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
```

## Impact

- ✅ **F-01 resuelto:** `hasRecentActivity` ahora verifica correctamente las últimas 24h en lugar de 30 días
- ✅ **Query optimizado:** Removido campo `status` innecesario del query de 30 días (`callsBreakdown`)
- ✅ **Sin regresiones:** `callsBreakdown` sigue proveyendo datos para `paidRatio`, `keyCount`, `trialCount`
- ✅ **Build limpio:** typecheck ✅ lint ✅

## Timestamp
Generated: 2026-03-19 16:55 CST
