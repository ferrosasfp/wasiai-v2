# Logic Audit — HU-062: Reputation Batch On-Chain

**Auditor:** NexusAgil Logic Auditor
**Commit:** `17db164`
**Date:** 2026-03-07

---

## Check Results

### 1. Commit & Diff Review — PASS
Commit `17db164` modifies 5 files (contract, tests, ABI, cron route, vercel.json). All changes align with SDD specification. No unrelated changes.

### 2. Contract Security — PASS
- **onlyOperator:** ✅ `submitReputationBatch` uses `onlyOperator` modifier. Only the designated operator can call it.
- **Empty slugs:** ✅ `require(len > 0, "WasiAI: empty batch")` guards against empty arrays.
- **Duplicate slugs:** ⚠️ INFO — Duplicate slugs in a single batch are NOT rejected; the last entry wins (overwrites). This is acceptable behavior since the cron is the sole caller and produces deduplicated data. Not a security issue.
- **Unregistered agents:** ✅ `require(agents[slugs[i]].creator != address(0), "WasiAI: agent not found")` rejects unknown slugs.
- **Array length mismatch:** ✅ Both `avgRatings.length` and `voteCounts.length` checked against `slugs.length`.
- **Rating bounds:** ✅ `require(avgRatings[i] <= 500)` enforced per element. uint16 naturally prevents negative values.
- **Batch size cap:** ✅ `require(len <= 500)` prevents gas limit issues.

### 3. Cron Route — PASS
- **HTTP method:** ✅ Uses `export async function GET` (not POST). Matches Vercel cron pattern.
- **Auth:** ✅ Checks `authorization` header against `Bearer ${CRON_SECRET}`. Returns 401 on mismatch.
- **Error handling:** ✅ DB errors return 500. Missing config returns `skipped`. Transaction failures caught and logged with 500 response.

### 4. Rating Aggregation — PASS
- **Formula:** `avgRating = Math.round((upVotes / total) * 500)` — correct.
- Thumbs up (+1) → 500, thumbs down (-1) → 0, mixed → proportional. Matches SDD scale table.
- Uses ALL ratings for the agent (cumulative), not just new ones since last batch — correct for cumulative score.

### 5. Chunking (>500 agents) — PASS
- Chunks at `CHUNK_SIZE = 500`, iterates with `aggregated.slice(i, i + CHUNK_SIZE)`.
- Each chunk submitted as a separate transaction with receipt awaited before next.
- Gas and agent count accumulated across chunks. Last hash used for response.

### 6. Skip on No New Ratings (AC-5) — PASS
- ✅ After querying `agent_ratings` with `gte('updated_at', lastBatchAt)`, checks `ratings.length === 0` and returns `{ skipped: true, reason: 'no new ratings' }`.

### 7. ABI Sync — PASS
- ABI in `WasiAIMarketplace.ts` matches contract signature exactly:
  - `submitReputationBatch(string[], uint16[], uint32[])` — ✅
  - `getReputation(string) → (uint16, uint32, uint64)` — ✅
  - `ReputationBatchSubmitted(uint256 indexed, uint256 indexed)` — ✅

### 8. Forge Tests — PASS
- **7 test cases** covering: single batch, multi-agent, overwrite, not-operator revert, rating-too-high revert, empty batch revert, agent-not-found revert, length mismatch revert.
- Correctly uses `vm.expectRevert()` instead of deprecated `testFail_` pattern (noted in build report).
- **Missing but non-blocking:** No test for batch size = 500 (boundary), and no test for duplicate slugs in same batch. These are edge cases the cron won't produce.

### 9. Reentrancy & Gas Griefing — PASS
- **Reentrancy:** No external calls in `submitReputationBatch`. Only writes to storage mapping. No ETH transfers. No callback vectors. Safe.
- **Gas griefing:** Batch capped at 500 entries. String-keyed mappings have higher gas cost than bytes32, but this is a known tradeoff for slug readability. At 500 agents ≈ ~5M gas, well within Avalanche block limits (8M target, 15M cap).
- **String storage:** Each `slugs[i]` read from calldata for the mapping key lookup. No unbounded string lengths from external users since only operator calls this. Operator-controlled input is trusted.

---

## Blockers

None.

## Advisory Notes (non-blocking)

| # | Severity | Note |
|---|----------|------|
| 1 | INFO | Duplicate slugs in a single batch silently overwrite. Acceptable since cron deduplicates. |
| 2 | INFO | No boundary test for batch size = 500. Low risk since contract enforces `<= 500`. |
| 3 | INFO | `cron_metadata` table must be created manually in Supabase before first run (SQL in build report). |

---

## Verdict: ✅ PASS

All 9 checks pass. No blockers. Implementation follows SDD faithfully with two improvements noted in the build report (test pattern modernization, scoping bug fix). Ready to merge.
