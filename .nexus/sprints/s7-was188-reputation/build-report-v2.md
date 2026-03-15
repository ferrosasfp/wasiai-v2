# Build Report v2 — WAS-188 BUG-02 Fix

**Date:** 2026-03-14  
**Commit:** `e6033cf74b7c773ffe269826783e6bd398c22c2b`  
**File:** `src/app/api/v1/agents/[slug]/reputation/route.ts`

## Bug Fixed: BUG-02 — Flat paidRatio treated x402 and key as equivalent

### Before
```typescript
const paidRatio = totalCalls30d > 0 ? (paidCount + keyCount) / totalCalls30d : 0
```
This treated x402 and key calls with equal weight, which didn't reflect the SDD intent.

### After
```typescript
const trialCount     = callsBreakdown?.filter(c => c.is_trial === true).length ?? 0
const weightedTotal    = paidCount * 3 + keyCount * 2 + trialCount * 1
const weightedPaidRatio = totalCalls30d > 0
  ? (paidCount * 3 + keyCount * 2) / Math.max(1, weightedTotal)
  : 0
const paidRatio = weightedPaidRatio
```

### Weights applied (per SDD)
| Type    | Weight |
|---------|--------|
| x402    | 3      |
| key     | 2      |
| trial   | 1      |

### Impact
- `signal_weights.paid_ratio` in the response now reflects `weightedPaidRatio`
- `votesBoost` threshold (`> 0.5`) unchanged — now evaluated against weighted ratio
- No other logic changed

## Constraints Verified
- ✅ Only `paidRatio`/`weightedPaidRatio` calculation changed
- ✅ No git push performed
- ✅ Uses `called_at` in all queries (no `created_at`)
