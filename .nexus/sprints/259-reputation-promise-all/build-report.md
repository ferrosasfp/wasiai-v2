# Build Report — WAS-259: Reputation Promise.all

**Branch:** `improvement/259-reputation-promise-all`  
**Commit:** e77456808  
**Date:** 2026-03-20  
**Status:** ✅ DONE

## Acceptance Criteria

| AC | Description | Result |
|----|-------------|--------|
| AC1 | Ola 1 runs agent + windowSetting via Promise.all | ✅ |
| AC2 | Ola 2 runs metricsRaw + lastCall + recentCalls + callsBreakdown + calcTrend via Promise.all | ✅ |
| AC3 | Gate: agent not found after Ola 1 → 404 | ✅ |
| AC4 | All downstream logic identical | ✅ |
| AC5 | TypeScript build passes (`npx tsc --noEmit`) | ✅ (no output = no errors) |

## Changes

**File:** `src/app/api/v1/agents/[slug]/reputation/route.ts`

- `createServiceClient()` moved before Ola 1
- Ola 1: `Promise.all([agent query, windowSetting query])`
- 404 gate between waves (unchanged logic)
- `availableWindowDays` / `availableWindowMs` computed from windowSetting before Ola 2
- Ola 2: `Promise.all([metricsRaw, lastCall, recentCalls, callsBreakdown, calcTrend])`
- `metrics` type cast moved after Ola 2 destructure
- All downstream logic (scores, paidRatio, isAvailable, response shape) identical

## Build Gate

```
npx tsc --noEmit → (no output) ✅
```
