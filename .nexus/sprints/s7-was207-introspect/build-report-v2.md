# Build Report v2 — WAS-207 Introspect Bug Fixes

**Commit:** `eeeddaa1f`
**Branch:** main
**Date:** 2026-03-14
**Status:** ✅ DONE — tsc --noEmit PASS, no git push

---

## BUG-01 — truncated solo en timeout ✅

**File:** `src/app/api/v1/agents/[slug]/introspect/route.ts`

**Fix applied in Route A (agent key) and Route B (x402):**

Before:
```typescript
truncated: upstream.timedOut || upstream.status === 'error',
truncatedReason: upstream.timedOut ? 'timeout' : upstream.status === 'error' ? 'upstream_error' : undefined,
```

After:
```typescript
truncated: upstream.timedOut === true,
truncatedReason: upstream.timedOut === true ? 'timeout' : undefined,
```

Additionally, when upstream returns error (non-timeout), `upstreamData` is passed as `{}` so `assembleCOB` produces empty `state_snapshots: [], call_trace: [], memory_diffs: []` with `truncated: false`.

---

## BUG-02 — Race condition en budget deduction ✅

**File:** `src/app/api/v1/agents/[slug]/introspect/route.ts` (Route A only — x402 path has no budget)

**Fix:** `check_and_deduct_budget` RPC is now awaited BEFORE calling upstream. If deduction fails (budget insufficient or DB error), returns 402 immediately. Removed the old fire-and-forget `void Promise.resolve(...)` pattern.

Before:
```typescript
const upstream = await callUpstreamIntrospect(model, body)
// ... buildCOB ...
// Deduct budget (best-effort, atomic)
void Promise.resolve(supabase.rpc('check_and_deduct_budget', {...})).catch(...)
```

After:
```typescript
const deductResult = await supabase.rpc('check_and_deduct_budget', { p_key_id: keyRow.id, p_amount: price })
if (deductResult.error || deductResult.data === false) {
  return NextResponse.json({ error: 'insufficient_budget' }, { status: 402 })
}
const upstream = await callUpstreamIntrospect(model, body)
```

---

## Constraints Verified
- ✅ Solo se corrigieron BUG-01 y BUG-02
- ✅ NO git push
- ✅ Firma de `logCall` no modificada
- ✅ `tsc --noEmit` pasa sin errores
