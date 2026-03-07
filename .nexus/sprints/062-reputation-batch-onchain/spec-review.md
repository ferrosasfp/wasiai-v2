# Spec Review — HU-062: Reputation Batch On-Chain

**Reviewer:** NexusAgil Spec Reviewer (automated)
**Date:** 2026-03-06
**SDD Version:** Draft

---

## Check Results

### 1. Contract space & `onlyOperator` modifier
**PASS**

- `WasiAIMarketplace.sol` is ~450 lines. Plenty of room for new struct, mapping, and functions.
- `onlyOperator` modifier exists (line ~130) via `_checkOperator()` — checks `operators[msg.sender] || msg.sender == owner()`.
- `lastOperatorActivity = block.timestamp` pattern used consistently — SDD follows it. ✅
- `agents[slug].creator != address(0)` is the existing pattern for "agent exists" — SDD uses it correctly. ✅

### 2. Rating table & route consistency
**PASS**

- Rate route: `POST /api/v1/models/[slug]/rate` — uses `agent_ratings` table with `rating` values `1` (up) / `-1` (down).
- Table columns confirmed: `agent_id`, `rating` (1/-1), `updated_at` (from upsert pattern).
- `agents` table has `reputation_score`, `reputation_count` columns. ✅
- SDD correctly references `agent_ratings` and the 1/-1 rating scheme.

### 3. Existing cron pattern consistency
**FAIL — Minor**

- `reconcile-onchain` uses **`GET`** handler. SDD specifies **`POST`** for `reputation-batch`.
- Vercel cron invokes routes via GET by default (unless configured otherwise with Vercel's `method` field, which is not standard).
- **Blocker?** No — Vercel Cron actually sends GET requests. The SDD must change from `POST` to `GET` to match the existing pattern and Vercel's cron behavior.
- Auth pattern matches: `Bearer ${CRON_SECRET}` via authorization header. ✅
- Imports and structure (viem, createServiceClient, logger) are consistent. ✅

### 4. Vercel cron config
**PASS**

- `vercel.json` currently has 2 crons: `settle-key-batches` at `0 2 * * *`, `reconcile-onchain` at `0 3 * * *`.
- SDD adds `reputation-batch` at `0 4 * * *` — logical ordering, no conflicts. ✅

### 5. Forge test directory structure
**PASS**

- `contracts/test/WasiAIMarketplace.t.sol` exists alongside other test files.
- SDD correctly appends tests to the existing file.
- Note: SDD should verify variable naming (`operator`, `creator`, `marketplace`) matches existing setUp() — it acknowledges this. ✅

### 6. `cron_metadata` table
**FAIL — Expected, non-blocking**

- Table does **not** exist. No references to `cron_metadata` in codebase or Supabase migrations.
- SDD includes migration SQL in Wave 4. ✅
- Need to confirm: is there a `supabase/migrations/` directory or are migrations managed differently?

### 7. uint16 ×100 scale vs Supabase ratings
**PASS**

- Supabase stores `rating` as `1` (up) or `-1` (down) — binary thumbs system.
- SDD converts: `avgRating = round((upVotes / totalVotes) × 500)` → 0–500 range.
- uint16 max = 65535, so 0–500 fits easily.
- Contract enforces `avgRatings[i] <= 500`. ✅
- Scale is internally consistent and well-documented.

### 8. Missing edge cases
**FAIL — Non-blocking, recommendations**

| Edge Case | Status | Notes |
|-----------|--------|-------|
| Operator gas insufficient | ⚠️ NOT HANDLED | No pre-flight gas balance check. If operator wallet is dry, tx silently fails. Should log a warning and skip or alert. |
| Failed tx retry | ⚠️ NOT HANDLED | If `writeContract` or `waitForTransactionReceipt` throws, the cron returns 500 but `cron_metadata` is NOT updated — so next run will retry the same batch. This is correct behavior (idempotent overwrite), but no exponential backoff or alert mechanism. |
| Partial batch failure | ✅ N/A | Contract is atomic — entire batch succeeds or reverts. No partial state. |
| Very large batch (>500 agents) | ⚠️ NOT HANDLED | Contract caps at 500, but cron route doesn't chunk. If >500 agents have new ratings, the tx will revert. Should split into multiple batches. |
| Race condition: ratings during batch | ✅ ACCEPTABLE | Ratings arriving between query and tx submission are caught in the next batch (timestamp-based cutoff). |
| `createServiceClient` async | ⚠️ MINOR | Rate route uses `await createServiceClient()` but SDD calls it without `await`. Check if the function is sync or async — reconcile-onchain also calls it without await, so likely fine. |

---

## Blockers

| # | Severity | Issue | Resolution |
|---|----------|-------|------------|
| B1 | **Medium** | SDD uses `POST` handler but Vercel Cron sends `GET` requests. Existing `reconcile-onchain` uses `GET`. | Change `export async function POST` → `export async function GET` in Wave 3. |
| B2 | **Low** | No batch chunking for >500 agents. | Add chunking loop in cron route or document as known limitation (unlikely with current agent count). |

## Non-blocking Recommendations

1. **Gas pre-check:** Before submitting, query operator wallet ETH (AVAX) balance. Log warning if below threshold.
2. **Alerting:** On tx failure, consider posting to a monitoring channel (Slack/Discord webhook).
3. **Migration path:** Clarify whether to use `supabase migration new` or manual SQL for `cron_metadata`.
4. **ABI sync:** Wave 1.4 mentions manual ABI copy. Consider a build script (`forge build && jq '.abi' ... > ...`) to avoid drift.

---

## Verdict

### ⚠️ APPROVED WITH CONDITIONS

The SDD is well-structured, thorough, and consistent with the existing codebase. Two issues must be fixed before implementation:

1. **B1 (must fix):** Change cron route from `POST` to `GET` to match Vercel Cron behavior and existing patterns.
2. **B2 (should fix):** Add batch chunking or document the 500-agent limit as acceptable.

Once B1 is resolved, implementation can proceed wave-by-wave.
