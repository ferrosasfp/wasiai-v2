# Work Item — 062: Reputation batch on-chain (ERC-8004)

**Classification:** HU-MAJOR
**Priority:** P2
**Sprint:** 17

---

## Problem

Agent ratings are stored off-chain only (Supabase). ERC-8004 defines a Reputation Registry for on-chain trust signals. Ratings should be written on-chain for verifiability, but individual tx per vote creates friction and cost.

## Desired Outcome

Batch approach: users vote off-chain (zero friction, zero cost). A daily cron consolidates all votes and writes one transaction to the on-chain Reputation Registry.

## Acceptance Criteria

1. **AC-1:** Users rate agents off-chain as today (no change to voting UX)
2. **AC-2:** Cron job runs daily, collects all ratings since last batch
3. **AC-3:** Cron writes a single transaction to the Reputation Registry contract with aggregated scores
4. **AC-4:** On-chain data is queryable: average rating and total votes per agent
5. **AC-5:** If no new ratings since last batch, cron skips (no empty tx)
6. **AC-6:** Gas cost per batch documented
7. **AC-7:** Contract function accepts batch of (agentSlug, avgRating, voteCount) tuples
8. **AC-8:** Build passes, forge tests pass

## Technical Notes

- ERC-8004 Reputation Registry: need to implement or extend WasiAIMarketplace contract
- Cron: reuse existing cron pattern (reconcile-onchain runs daily at 0 3 * * *)
- Operator wallet signs the batch tx
- Consider: store last batch timestamp in DB to know cutoff
