# QA Report — WAS-245 v2
**Feature:** Agent Availability Window (DB-Driven)  
**Commits:** `a9f91c1eb`, `d4273a3ff`  
**QA Date:** 2026-03-19 19:06 CST  
**Verifier:** Subagent QA  

---

## AC Verification

| AC | Status | Evidencia (route.ts) |
|----|--------|----------------------|
| **AC-01**<br>Agente con last_call hace 3 días → `is_available: true` | ✅ **PASS** | **L140:** `availableWindowMs = availableWindowDays * 24 * 60 * 60 * 1000`<br>**L150-153:** `hasRecentActivity` checks calls within configurable window<br>**L171:** `isAvailable = !healthCheckFailed && (healthCheckPassed \|\| hasRecentActivity)` |
| **AC-02**<br>Agente con last_call hace 8 días → `is_available: false` | ✅ **PASS** | Same logic as AC-01: 8d > 7d default → `hasRecentActivity = false` → `isAvailable = false` |
| **AC-03**<br>Cambiar `available_window_days` en DB → efecto sin deploy | ✅ **PASS** | **L135-139:** `SELECT value FROM app_settings WHERE key = 'agent_available_window_days'`<br>**L140:** `parseInt(windowSetting?.value ?? '7', 10) \|\| 7`<br>No hardcoded constants — window driven by DB value |
| **AC-04**<br>`last_invocation_at` no es null si hay calls | ✅ **PASS** | **L143-149:** Query `agent_calls` ordered by `called_at DESC LIMIT 1`<br>**L215:** Returns `last_invocation_at: lastCall?.called_at ?? null` |
| **AC-05**<br>Build sin errores | ✅ **PASS** | TypeScript: ✅ No errors<br>ESLint: ✅ 0 warnings |

---

## Build & Tests

| Check | Result | Notes |
|-------|--------|-------|
| **TypeScript** | ✅ PASS | `tsc --noEmit` — no type errors |
| **ESLint** | ✅ PASS | `--max-warnings 0` — clean |
| **Unit Tests** | ⚠️ **5 failed** | **Unrelated to WAS-245**<br>Failures in `trial.test.ts` (POST trial endpoint returning 400 instead of expected codes)<br>No trial code modified in WAS-245 commits<br>Pre-existing test failures |

---

## Smoke Tests (Production)

| Agent | is_available | last_invocation_at | Age |
|-------|--------------|-------------------|-----|
| wasi-onchain-analyzer | `False` | 2026-03-18T19:16:13 | ~30h |
| wasi-risk-report | `False` | 2026-03-18T05:30:10 | ~44h |
| wasi-liquidity-analyzer | `False` | 2026-03-18T05:30:12 | ~44h |
| wasi-chainlink-price | `True` | 2026-03-19T21:43:08 | ~3.5h |

### Analysis
🚨 **COMMITS NOT DEPLOYED TO PRODUCTION**

**Evidence:**
- 3 agents with last calls 30-44h ago show `is_available: false`
- If 7d window were active, all 4 agents would show `true` (all within 7 days)
- Current behavior matches **24h hardcoded window** (pre-WAS-245 logic)

**Expected after deployment:**
- All 4 agents → `is_available: true` (all have calls within 7 days)
- DB setting `agent_available_window_days = 7` should drive availability

---

## Code Quality

### Strengths ✅
1. **Clean separation of concerns:** DB config read isolated in L135-139
2. **Defensive programming:** `parseInt(..., 10) || 7` handles malformed values (commit `d4273a3ff`)
3. **Min constraint:** `Math.max(1, ...)` prevents 0-day window edge case
4. **Migration provided:** `073_app_settings.sql` creates necessary DB infrastructure

### Observations 📋
1. **Migration not verified:** QA did not verify migration runs cleanly (out of scope for code review)
2. **Test drift:** 5 failing tests in `trial.test.ts` — pre-existing, not introduced by WAS-245

---

## Veredicto

### ✅ **QA PASS** (Code Level)

**All acceptance criteria met in code:**
- ✅ 7-day window logic implemented correctly
- ✅ DB-driven configuration (no hardcoded constants)
- ✅ Builds clean (TypeScript + ESLint)
- ✅ Defensive NaN handling

**Deployment Status:**
- 🚨 **PENDING DEPLOY** — production still running pre-WAS-245 code (24h window)
- ⏳ **POST-DEPLOY VERIFICATION REQUIRED** — re-run smoke tests after deployment to confirm DB setting takes effect

**Blockers:**
- ❌ None for code merge
- ⚠️ Trial endpoint tests need fixing (separate issue, not WAS-245)

---

**Next Actions:**
1. ✅ Merge commits to main
2. 🚀 Deploy to production
3. ✅ Verify `app_settings.agent_available_window_days` exists in prod DB (migration ran)
4. 🧪 Re-run smoke tests post-deploy (expect all 4 agents → `available: true`)
5. 📊 Monitor error logs for parseInt NaN warnings

---

**QA Verifier:** Subagent  
**Report Generated:** 2026-03-19 19:07 CST
