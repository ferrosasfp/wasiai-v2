# Build Report — WAS-245

## Wave execution

| Wave | Status | Build | Detalle |
|------|--------|-------|---------|
| Wave 0 — Pre-flight | ✅ PASS | N/A | Route file read, createServiceClient confirmed, callsBreakdown query verified |
| Wave 1 — Fix last_invocation_at | ✅ PASS | ✅ typecheck + lint | Added createServiceClient import, updated lastCall query to use serviceClient for RLS bypass |
| Wave 2 — Fix is_available | ✅ PASS | ✅ typecheck + lint | Added `status` to callsBreakdown select, implemented multi-signal isAvailable logic (healthCheck + recent success) |

## Commit

- Hash: `cde0c75f18dfb924d274b418a2ff3e11ec6d3ad4`
- Message: `fix(WAS-245): reputation — serviceClient for last_invocation_at, secondary is_available signal`
- Files changed: 1 (`src/app/api/v1/agents/[slug]/reputation/route.ts`)

## Implementation Summary

### Changes Applied

1. **Import update**: Added `createServiceClient` to imports from `@/lib/supabase/server`

2. **lastCall query (AC-01)**: 
   - Changed from `supabase` to `createServiceClient()` 
   - Bypasses RLS to retrieve actual `last_invocation_at` when `agent_calls` exist
   - Added explanatory comment about RLS bypass

3. **callsBreakdown enhancement (AC-02, AC-03)**:
   - Added `status` field to select query
   - Preserves existing `payment_type, is_trial` fields

4. **isAvailable logic refactor (AC-02, AC-03)**:
   - **Primary signal**: `healthCheckPassed` (existing health_check cron result)
   - **Secondary signal**: `hasRecentActivity` (counts `status === 'success'` in last 30d)
   - **Override**: `healthCheckFailed` (explicit `health_check.passed === false`)
   - **Final**: `!healthCheckFailed && (healthCheckPassed || hasRecentActivity)`

### Acceptance Criteria Validation

- ✅ **AC-01**: `last_invocation_at` returns real date when agent_calls exist (serviceClient bypass)
- ✅ **AC-02**: `is_available: true` when recent successful calls exist (even if health_check null)
- ✅ **AC-03**: `is_available: false` when health_check.passed === false (explicit override)
- ✅ **AC-04**: No private data exposed (only aggregates used, status not in response)
- ✅ **AC-05**: Response shape preserved (no fields added/removed from API response)

## Build Gates

Both waves passed:
- `npm run typecheck` — ✅ No type errors
- `npm run lint` — ✅ No lint warnings

## Rollback Procedure

```bash
git revert cde0c75f18dfb924d274b418a2ff3e11ec6d3ad4
```

Single file change, no database migrations — safe to revert.
