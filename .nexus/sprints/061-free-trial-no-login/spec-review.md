# Spec Review — SDD 061: Free trial sin login

**Reviewer:** NexusAgil Spec Reviewer (automated)  
**Date:** 2026-03-06  
**Verdict:** ✅ APPROVED (with advisory notes)

---

## Codebase Verification

| # | Check | Result | Notes |
|---|-------|--------|-------|
| 1 | Dependency on 058 (`rate-limit-ip.ts`) | ✅ PASS | SDD correctly declares dependency; file will exist after 058 |
| 2 | Trial API route exists | ✅ PASS | `src/app/api/v1/agents/[slug]/trial/route.ts` exists |
| 3 | `AgentTrialPlayground.tsx` exists | ✅ PASS | `src/features/agents/components/AgentTrialPlayground.tsx` exists |
| 4 | GET handler "Before" code matches | ✅ PASS | Lines 37-38 match: `if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })` |
| 5 | POST handler "Before" code matches | ✅ PASS | Auth block and IP rate limit patterns match actual code |
| 6 | `logTrialCall` has no `caller_id` | ✅ PASS | Confirmed: inserts only `agent_id`, `status`, `latency_ms`, `is_trial` — no user ref |
| 7 | `AgentTrialPlayground` props/structure | ✅ PASS | Has `isAuthenticated` prop, login gate at line 85, `handleTrial` function, `already_used` check |

## AC ↔ Wave Mapping

| AC | Wave | Status |
|----|------|--------|
| AC-1: Unauthenticated user can click Free Trial | Wave 2 (Change 2) | ✅ PASS |
| AC-2: Trial works without login, 3 calls/agent/IP/day | Wave 1 (Changes 3-4) | ✅ PASS |
| AC-3: Limit message shown | Wave 2 (Changes 1-3) | ✅ PASS |
| AC-4: Authenticated users normal behavior | Wave 1 (Change 4 else branch) | ✅ PASS |
| AC-5: Clean build | Wave 3 | ✅ PASS |

## Advisory Notes (non-blocking)

### 1. POST handler line numbers slightly off
SDD says auth at "lines 62–65", actual is close but may drift. "Before" code blocks are exact matches — use pattern matching.

### 2. `use_trial` RPC skip for anonymous
SDD correctly skips `use_trial` RPC for anonymous users (Wave 1, Change 5). Anonymous usage is tracked only by IP rate limit, not in `agent_trials` table. This means anonymous calls don't count toward an account's trial limit if they later sign up — acceptable tradeoff, and arguably a feature (encourages signup).

### 3. GET handler anonymous response hardcodes `limit: 3`
SDD Change 2 returns `trialsRemaining: 3, limit: 3` for anonymous. This is hardcoded and may desync from the per-agent `free_trial_limit`. Since anonymous tracking is IP-based (not per-agent trial tracking), this is cosmetic — the actual enforcement is in the POST handler's `checkIpLimit(..., 3)`. Minor inconsistency but non-blocking.

### 4. IP spoofing
Same note as 058 — `X-Forwarded-For` used for IP extraction. Acceptable behind Vercel.

### 5. AgentTrialPlayground ternary restructure
SDD Change 2 replaces the `!isAuthenticated` ternary with `anonLimitHit` ternary. The implementer must carefully remove the old `!isAuthenticated` branch (lines 85-88) and the corresponding closing `)}` to avoid syntax errors. The SDD describes this correctly but the merge is non-trivial.

## Blockers

None.

## Verdict

**✅ APPROVED** — All ACs covered, all referenced files and code patterns verified, dependency on 058 correctly declared. Proceed to implementation after 058 is complete.
