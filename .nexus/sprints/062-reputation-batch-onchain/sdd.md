# SDD — HU-062: Reputation Batch On-Chain

**Work Item:** [work-item.md](./work-item.md)
**Status:** Draft
**Author:** NexusAgil SDD Writer
**Date:** 2026-03-06

---

## Overview

Daily cron aggregates off-chain agent ratings (Supabase `agent_ratings` table) and writes a single batch transaction to `WasiAIMarketplace.sol`. On-chain data stores `avgRating` (uint16, scaled ×100, e.g. 450 = 4.50★) and `voteCount` per agent slug.

Users continue voting off-chain (zero friction). The cron is the only writer to the contract.

---

## Architecture

```
agent_ratings (Supabase)
    │
    ▼  daily cron
GET /api/cron/reputation-batch
    │  1. query ratings since last batch
    │  2. aggregate per agent (avg, count)
    │  3. convert to uint16 scaled score
    ▼
WasiAIMarketplace.submitReputationBatch(slugs[], avgRatings[], voteCounts[])
    │  onlyOperator
    ▼
on-chain mapping: slug → ReputationRecord { avgRating, voteCount, lastUpdated }
```

---

## Wave 0 — Pre-flight

**Goal:** Verify existing state before writing code.

### Checklist

| Item | Expected | Verify |
|------|----------|--------|
| Contract file | `contracts/src/WasiAIMarketplace.sol` | ✅ exists |
| `agent_ratings` table | columns: `agent_id`, `voter_id`, `rating` (1/-1), `updated_at` | Check Supabase schema |
| `agents` table | has `slug`, `reputation_score`, `reputation_count` | ✅ confirmed in rate route |
| Cron pattern | `reconcile-onchain` uses Bearer CRON_SECRET, GET handler | ✅ confirmed |
| Forge tests | `contracts/test/WasiAIMarketplace.t.sol` | ✅ exists |
| Chain lib | `viem` ^2.45.2 | ✅ in package.json |
| Operator wallet | `OPERATOR_PRIVATE_KEY` env var | Check existing cron routes |

**Build gate:** None (read-only verification).

---

## Wave 1 — Contract: `submitReputationBatch`

**Files changed:**
- `contracts/src/WasiAIMarketplace.sol`

### 1.1 Add struct and state

After the `Agent` struct (~line 50), add:

```solidity
// ─── ERC-8004 Reputation Registry ─────────────────────────────────────────

struct ReputationRecord {
    uint16  avgRating;    // scaled ×100 (e.g. 450 = 4.50 stars, max 500)
    uint32  voteCount;    // total votes aggregated
    uint64  lastUpdated;  // block.timestamp of last batch
}

/// slug → on-chain reputation
mapping(string => ReputationRecord) public reputations;
```

### 1.2 Add event

In the Events section, add:

```solidity
event ReputationBatchSubmitted(
    uint256 indexed batchSize,
    uint256 indexed timestamp
);
```

### 1.3 Add function

After the `getStats()` view function, add:

```solidity
// ─── ERC-8004 Reputation Batch ────────────────────────────────────────────

/**
 * @notice Submit aggregated reputation scores for a batch of agents.
 * @dev    Called daily by cron operator. Overwrites previous values.
 *         avgRatings scaled ×100 (uint16): 0–500 (0.00–5.00 stars).
 *         For thumbs up/down systems: up=500, down=0, mixed=proportional.
 * @param slugs       Agent slug identifiers
 * @param avgRatings  Average rating per agent (uint16, ×100 scaled)
 * @param voteCounts  Total vote count per agent (cumulative)
 */
function submitReputationBatch(
    string[] calldata slugs,
    uint16[] calldata avgRatings,
    uint32[] calldata voteCounts
) external onlyOperator {
    lastOperatorActivity = block.timestamp;
    uint256 len = slugs.length;
    require(len > 0,                      "WasiAI: empty batch");
    require(len <= 500,                   "WasiAI: batch too large");
    require(len == avgRatings.length,     "WasiAI: length mismatch");
    require(len == voteCounts.length,     "WasiAI: length mismatch");

    for (uint256 i = 0; i < len; i++) {
        require(avgRatings[i] <= 500,     "WasiAI: rating out of range");
        require(
            agents[slugs[i]].creator != address(0),
            "WasiAI: agent not found"
        );

        reputations[slugs[i]] = ReputationRecord({
            avgRating:   avgRatings[i],
            voteCount:   voteCounts[i],
            lastUpdated: uint64(block.timestamp)
        });
    }

    emit ReputationBatchSubmitted(len, block.timestamp);
}

/**
 * @notice Read on-chain reputation for an agent.
 */
function getReputation(string calldata slug)
    external view
    returns (uint16 avgRating, uint32 voteCount, uint64 lastUpdated)
{
    ReputationRecord memory r = reputations[slug];
    return (r.avgRating, r.voteCount, r.lastUpdated);
}
```

### 1.4 Update ABI export

After contract changes, regenerate ABI:

```bash
cd contracts && forge build
```

Copy ABI to frontend:

```bash
# Extract ABI from forge output
cat out/WasiAIMarketplace.sol/WasiAIMarketplace.json | jq '.abi' > ../src/lib/contracts/WasiAIMarketplace.abi.json
```

Update `src/lib/contracts/WasiAIMarketplace.ts` — add the new function and event to the ABI array (or re-export from the JSON).

**Build gate:** `cd contracts && forge build` — must compile without errors.

---

## Wave 2 — Forge Tests

**Files changed:**
- `contracts/test/WasiAIMarketplace.t.sol` (append new test functions)

### 2.1 Test cases

Add the following tests to the existing test contract:

```solidity
// ─── Reputation Batch Tests ───────────────────────────────────────────────

function test_submitReputationBatch_single() public {
    // Setup: register an agent first
    vm.prank(operator);
    marketplace.registerAgent("test-agent", 20000, creator, 0);

    string[] memory slugs = new string[](1);
    slugs[0] = "test-agent";
    uint16[] memory ratings = new uint16[](1);
    ratings[0] = 450; // 4.50 stars
    uint32[] memory counts = new uint32[](1);
    counts[0] = 42;

    vm.prank(operator);
    marketplace.submitReputationBatch(slugs, ratings, counts);

    (uint16 avg, uint32 cnt, uint64 ts) = marketplace.getReputation("test-agent");
    assertEq(avg, 450);
    assertEq(cnt, 42);
    assertGt(ts, 0);
}

function test_submitReputationBatch_multi() public {
    vm.startPrank(operator);
    marketplace.registerAgent("agent-a", 20000, creator, 0);
    marketplace.registerAgent("agent-b", 30000, creator, 0);

    string[] memory slugs = new string[](2);
    slugs[0] = "agent-a";
    slugs[1] = "agent-b";
    uint16[] memory ratings = new uint16[](2);
    ratings[0] = 500;
    ratings[1] = 250;
    uint32[] memory counts = new uint32[](2);
    counts[0] = 100;
    counts[1] = 5;

    marketplace.submitReputationBatch(slugs, ratings, counts);
    vm.stopPrank();

    (uint16 avg1,,) = marketplace.getReputation("agent-a");
    (uint16 avg2,,) = marketplace.getReputation("agent-b");
    assertEq(avg1, 500);
    assertEq(avg2, 250);
}

function test_submitReputationBatch_overwrite() public {
    vm.startPrank(operator);
    marketplace.registerAgent("overwrite-test", 20000, creator, 0);

    string[] memory slugs = new string[](1);
    slugs[0] = "overwrite-test";
    uint16[] memory ratings = new uint16[](1);
    ratings[0] = 300;
    uint32[] memory counts = new uint32[](1);
    counts[0] = 10;

    marketplace.submitReputationBatch(slugs, ratings, counts);

    // Overwrite with new values
    ratings[0] = 480;
    counts[0] = 25;
    marketplace.submitReputationBatch(slugs, ratings, counts);
    vm.stopPrank();

    (uint16 avg, uint32 cnt,) = marketplace.getReputation("overwrite-test");
    assertEq(avg, 480);
    assertEq(cnt, 25);
}

function testFail_submitReputationBatch_notOperator() public {
    vm.prank(operator);
    marketplace.registerAgent("no-op-test", 20000, creator, 0);

    string[] memory slugs = new string[](1);
    slugs[0] = "no-op-test";
    uint16[] memory ratings = new uint16[](1);
    ratings[0] = 400;
    uint32[] memory counts = new uint32[](1);
    counts[0] = 1;

    vm.prank(address(0xBEEF)); // not operator
    marketplace.submitReputationBatch(slugs, ratings, counts);
}

function testFail_submitReputationBatch_ratingTooHigh() public {
    vm.startPrank(operator);
    marketplace.registerAgent("high-rating", 20000, creator, 0);

    string[] memory slugs = new string[](1);
    slugs[0] = "high-rating";
    uint16[] memory ratings = new uint16[](1);
    ratings[0] = 501; // exceeds 500
    uint32[] memory counts = new uint32[](1);
    counts[0] = 1;

    marketplace.submitReputationBatch(slugs, ratings, counts);
    vm.stopPrank();
}

function testFail_submitReputationBatch_emptyBatch() public {
    string[] memory slugs = new string[](0);
    uint16[] memory ratings = new uint16[](0);
    uint32[] memory counts = new uint32[](0);

    vm.prank(operator);
    marketplace.submitReputationBatch(slugs, ratings, counts);
}

function testFail_submitReputationBatch_agentNotFound() public {
    string[] memory slugs = new string[](1);
    slugs[0] = "nonexistent-agent";
    uint16[] memory ratings = new uint16[](1);
    ratings[0] = 400;
    uint32[] memory counts = new uint32[](1);
    counts[0] = 1;

    vm.prank(operator);
    marketplace.submitReputationBatch(slugs, ratings, counts);
}

function testFail_submitReputationBatch_lengthMismatch() public {
    string[] memory slugs = new string[](1);
    slugs[0] = "mismatch-test";
    uint16[] memory ratings = new uint16[](2);
    ratings[0] = 400;
    ratings[1] = 300;
    uint32[] memory counts = new uint32[](1);
    counts[0] = 1;

    vm.prank(operator);
    marketplace.submitReputationBatch(slugs, ratings, counts);
}
```

> **Note:** Adapt variable names (`operator`, `creator`, `marketplace`) to match the existing test contract's setUp() conventions. Read the existing test file to confirm naming.

**Build gate:** `cd contracts && forge test` — all tests pass (existing + new).

---

## Wave 3 — Cron API Route

**Files created:**
- `src/app/api/cron/reputation-batch/route.ts`

### 3.1 Route implementation

```typescript
/**
 * GET /api/cron/reputation-batch
 *
 * Daily cron: aggregates off-chain ratings and submits batch to
 * WasiAIMarketplace.submitReputationBatch().
 *
 * AC-2, AC-3, AC-5, AC-7
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createWalletClient, createPublicClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { avalanche, avalancheFuji } from 'viem/chains'
import { WASIAI_MARKETPLACE_ABI } from '@/lib/contracts/WasiAIMarketplace'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(req: Request) {
  // Verify cron secret (same pattern as reconcile-onchain)
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
  const chain = chainId === 43114 ? avalanche : avalancheFuji
  const rpcUrl = (chainId === 43114
    ? process.env.NEXT_PUBLIC_RPC_MAINNET
    : process.env.NEXT_PUBLIC_RPC_TESTNET
  )?.trim() || undefined

  const contractAddress = process.env.MARKETPLACE_CONTRACT_ADDRESS as `0x${string}` | undefined
  const operatorKey = process.env.OPERATOR_PRIVATE_KEY as `0x${string}` | undefined

  if (!contractAddress || !operatorKey) {
    logger.warn('[reputation-batch] Missing contract address or operator key')
    return NextResponse.json({ skipped: true, reason: 'missing config' })
  }

  // ── 1. Get last batch timestamp ───────────────────────────────────────────
  const { data: meta } = await supabase
    .from('cron_metadata')
    .select('value')
    .eq('key', 'last_reputation_batch_at')
    .single()

  const lastBatchAt = meta?.value ?? '1970-01-01T00:00:00Z'

  // ── 2. Query ratings since last batch ─────────────────────────────────────
  const { data: ratings, error: ratingsErr } = await supabase
    .from('agent_ratings')
    .select('agent_id, rating, updated_at')
    .gte('updated_at', lastBatchAt)

  if (ratingsErr) {
    logger.error('[reputation-batch] Failed to fetch ratings', { error: ratingsErr.message })
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  if (!ratings || ratings.length === 0) {
    // AC-5: no new ratings → skip
    logger.info('[reputation-batch] No new ratings since last batch, skipping')
    return NextResponse.json({ skipped: true, reason: 'no new ratings' })
  }

  // ── 3. Get ALL ratings per affected agent (for cumulative aggregation) ────
  const affectedAgentIds = [...new Set(ratings.map(r => r.agent_id))]

  // Fetch agent slugs
  const { data: agentsData } = await supabase
    .from('agents')
    .select('id, slug')
    .in('id', affectedAgentIds)

  if (!agentsData || agentsData.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'no matching agents' })
  }

  const agentMap = new Map(agentsData.map(a => [a.id, a.slug]))

  // Fetch ALL ratings for affected agents (cumulative, not just new ones)
  const { data: allRatings } = await supabase
    .from('agent_ratings')
    .select('agent_id, rating')
    .in('agent_id', affectedAgentIds)

  if (!allRatings) {
    return NextResponse.json({ error: 'Failed to fetch all ratings' }, { status: 500 })
  }

  // ── 4. Aggregate per agent ────────────────────────────────────────────────
  // Rating system is thumbs up (1) / down (-1)
  // Convert to 0–500 scale: up% × 500
  // e.g. 90% thumbs up → 450 (4.50 stars equivalent)
  const aggregated: { slug: string; avgRating: number; voteCount: number }[] = []

  for (const agentId of affectedAgentIds) {
    const slug = agentMap.get(agentId)
    if (!slug) continue

    const agentRatings = allRatings.filter(r => r.agent_id === agentId)
    const total = agentRatings.length
    if (total === 0) continue

    const upVotes = agentRatings.filter(r => r.rating === 1).length
    // Scale: (upVotes / total) * 500 → uint16
    const avgRating = Math.round((upVotes / total) * 500)

    aggregated.push({ slug, avgRating, voteCount: total })
  }

  if (aggregated.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'no aggregatable data' })
  }

  // ── 5. Submit batch to contract (chunked, max 500 per tx) ─────────────────
  const CHUNK_SIZE = 500
  const account = privateKeyToAccount(operatorKey)
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  })
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })

  try {
    const chunks = []
    for (let i = 0; i < aggregated.length; i += CHUNK_SIZE) {
      chunks.push(aggregated.slice(i, i + CHUNK_SIZE))
    }

    const results = []
    for (const chunk of chunks) {
      const slugs = chunk.map(a => a.slug)
      const avgRatings = chunk.map(a => a.avgRating)
      const voteCounts = chunk.map(a => a.voteCount)

      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: WASIAI_MARKETPLACE_ABI,
        functionName: 'submitReputationBatch',
        args: [slugs, avgRatings, voteCounts],
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      results.push({ hash, gasUsed: receipt.gasUsed, count: chunk.length })
    }

    const totalGas = results.reduce((sum, r) => sum + r.gasUsed, 0n)
    const receipt = { gasUsed: totalGas }
    const hash = results[results.length - 1].hash

    logger.info('[reputation-batch] Batch submitted', {
      txHash: hash,
      agents: slugs.length,
      gasUsed: receipt.gasUsed.toString(),
    })

    // ── 6. Update last batch timestamp ──────────────────────────────────────
    const now = new Date().toISOString()
    await supabase
      .from('cron_metadata')
      .upsert(
        { key: 'last_reputation_batch_at', value: now, updated_at: now },
        { onConflict: 'key' }
      )

    return NextResponse.json({
      success: true,
      txHash: hash,
      agentsUpdated: slugs.length,
      gasUsed: receipt.gasUsed.toString(),
    })
  } catch (err) {
    logger.error('[reputation-batch] Transaction failed', {
      error: String(err).slice(0, 500),
    })
    return NextResponse.json({ error: 'Transaction failed' }, { status: 500 })
  }
}
```

**Build gate:** `npx tsc --noEmit` — no type errors.

---

## Wave 4 — `cron_metadata` Table

**Files changed:**
- Supabase migration (or manual SQL)

### 4.1 Create `cron_metadata` table

If the table doesn't already exist, create it:

```sql
-- Migration: create cron_metadata for tracking batch timestamps
CREATE TABLE IF NOT EXISTS cron_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed initial value
INSERT INTO cron_metadata (key, value)
VALUES ('last_reputation_batch_at', '1970-01-01T00:00:00Z')
ON CONFLICT (key) DO NOTHING;
```

> **Alternative:** If a `cron_metadata` table already exists or a different pattern is preferred (e.g. storing in an existing `settings` table), adapt accordingly. The cron route reads from `cron_metadata` where `key = 'last_reputation_batch_at'`.

**Build gate:** Verify table exists: `SELECT * FROM cron_metadata WHERE key = 'last_reputation_batch_at';`

---

## Wave 5 — Vercel Cron Configuration

**Files changed:**
- `vercel.json`

### 5.1 Add cron entry

Add to the existing `crons` array:

```json
{
  "path": "/api/cron/reputation-batch",
  "schedule": "0 4 * * *"
}
```

Full `vercel.json` crons section becomes:

```json
{
  "crons": [
    {
      "path": "/api/cron/settle-key-batches",
      "schedule": "0 2 * * *"
    },
    {
      "path": "/api/cron/reconcile-onchain",
      "schedule": "0 3 * * *"
    },
    {
      "path": "/api/cron/reputation-batch",
      "schedule": "0 4 * * *"
    }
  ]
}
```

> Runs at 04:00 UTC daily, after settle (02:00) and reconcile (03:00).

**Build gate:** `cat vercel.json | jq .crons` — valid JSON, 3 entries.

---

## Wave 6 — Build Gate (Full)

### 6.1 Contract build + test

```bash
cd contracts
forge build   # must compile
forge test    # all tests pass (existing + new reputation tests)
```

### 6.2 Frontend build

```bash
npm run build   # Next.js build must pass
```

### 6.3 Verification checklist

| AC | Description | Verified by |
|----|-------------|-------------|
| AC-1 | No changes to voting UX | No files in `src/features/reputation/` modified |
| AC-2 | Cron runs daily | `vercel.json` entry at `0 4 * * *` |
| AC-3 | Single batch tx | `submitReputationBatch` accepts arrays |
| AC-4 | On-chain queryable | `getReputation(slug)` view function |
| AC-5 | Skip if no new ratings | Cron checks `ratings.length === 0` |
| AC-6 | Gas cost documented | Logged in cron response (`gasUsed`) |
| AC-7 | Batch tuples format | `(string[] slugs, uint16[] avgRatings, uint32[] voteCounts)` |
| AC-8 | Build passes | `forge test` + `npm run build` |

---

## Gas Estimation

- `submitReputationBatch` with N agents ≈ 30k base + ~25k per agent (SSTORE to mapping)
- 50 agents ≈ 1.28M gas ≈ $0.03–0.10 on Avalanche C-Chain (25 nAVAX gas price)
- 200 agents ≈ 5M gas ≈ $0.12–0.40
- Batch cap at 500 to stay well under block gas limit

---

## Environment Variables

| Variable | Purpose | Already exists? |
|----------|---------|-----------------|
| `CRON_SECRET` | Auth for Vercel cron | ✅ Yes |
| `MARKETPLACE_CONTRACT_ADDRESS` | Contract address | ✅ Yes |
| `OPERATOR_PRIVATE_KEY` | Wallet signing batch tx | ✅ Yes (used by settle-key-batches) |
| `NEXT_PUBLIC_CHAIN_ID` | 43114 (mainnet) or 43113 (fuji) | ✅ Yes |
| `NEXT_PUBLIC_RPC_MAINNET` / `_TESTNET` | RPC URLs | ✅ Yes |

No new env vars needed.

---

## Rating Scale Conversion

The existing system uses thumbs up (+1) / down (-1). Conversion to uint16 ×100 scale:

```
avgRating = round((upVotes / totalVotes) × 500)
```

| Scenario | upVotes | total | avgRating | Display |
|----------|---------|-------|-----------|---------|
| All up | 10 | 10 | 500 | 5.00★ |
| 90% up | 9 | 10 | 450 | 4.50★ |
| 50/50 | 5 | 10 | 250 | 2.50★ |
| All down | 0 | 10 | 0 | 0.00★ |

---

## File Summary

| Wave | File | Action |
|------|------|--------|
| 1 | `contracts/src/WasiAIMarketplace.sol` | Add struct, mapping, function, event |
| 1 | `src/lib/contracts/WasiAIMarketplace.ts` | Update ABI export |
| 2 | `contracts/test/WasiAIMarketplace.t.sol` | Add 7 test functions |
| 3 | `src/app/api/cron/reputation-batch/route.ts` | Create new cron route |
| 4 | Supabase migration | Create `cron_metadata` table |
| 5 | `vercel.json` | Add cron entry |
