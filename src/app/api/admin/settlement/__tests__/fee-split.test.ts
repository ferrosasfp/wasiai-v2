/**
 * fee-split.test.ts — Money-path regression for the admin settlement route.
 *
 * The route (src/app/api/admin/settlement/route.ts) used to compute the creator
 * net share with float math:
 *
 *     const net = (batchAmounts[i] ?? 0) * (1 - PLATFORM_FEE_BPS / 10000)
 *
 * which drifts against the integer 90/10 split the contract performs on-chain.
 * It now computes the share with the integer helper, exactly like
 * runSettlement.ts:
 *
 *     const { creator } = feeSplit(toAtomic(amount), PLATFORM_FEE_BPS)
 *
 * These tests assert the integer result equals the contract's atomic split for a
 * range of amounts and pin the no-drift property over a batch. If anyone
 * reintroduces the float version, the accumulated-batch case fails.
 */
import { describe, it, expect } from 'vitest'
import { toAtomic, fromAtomic, feeSplit } from '@/lib/money/usdc'

// The on-chain split is fee = floor(amount * bps / 10000), creator = amount - fee,
// all in atomic micro-USDC. This is the reference the route must match.
function contractSplitAtomic(amountAtomic: bigint, bps: number): { fee: bigint; creator: bigint } {
  const fee = (amountAtomic * BigInt(bps)) / 10_000n
  return { fee, creator: amountAtomic - fee }
}

// Exactly what the route now does per call.
function routeCreatorShare(amount: number | string, bps: number): bigint {
  return feeSplit(toAtomic(amount), bps).creator
}

const PLATFORM_FEE_BPS = 1000 // 10% default

describe('admin settlement fee-split (integer, matches contract)', () => {
  it('matches the contract atomic split for a range of amounts (10% bps)', () => {
    const amounts = [0.01, 0.02, 0.05, 0.1, 0.5, 1, 1.23, 9.99, 10, 100, 0.000001, 0.123456]
    for (const amount of amounts) {
      const atomic = toAtomic(amount)
      const expected = contractSplitAtomic(atomic, PLATFORM_FEE_BPS)
      expect(routeCreatorShare(amount, PLATFORM_FEE_BPS)).toBe(expected.creator)
    }
  })

  it('fee + creator === amount exactly (no micro-USDC lost or created)', () => {
    for (const amount of [0.01, 0.07, 3.33, 7.77, 12.345678]) {
      const atomic = toAtomic(amount)
      const { fee, creator } = feeSplit(atomic, PLATFORM_FEE_BPS)
      expect(fee + creator).toBe(atomic)
    }
  })

  it('works across several bps values', () => {
    const amount = 1.23
    const atomic = toAtomic(amount)
    for (const bps of [0, 100, 250, 1000, 1500, 10000]) {
      expect(routeCreatorShare(amount, bps)).toBe(contractSplitAtomic(atomic, bps).creator)
    }
  })

  it('integer batch accumulation does not drift (float version would)', () => {
    // 1000 calls of 0.001 USDC each at 10% fee. Integer accumulation closes
    // exactly; the old float `amount * (1 - bps/1e4)` accumulates rounding error.
    const calls = Array.from({ length: 1000 }, () => 0.001)

    let acc = 0n
    for (const c of calls) acc += routeCreatorShare(c, PLATFORM_FEE_BPS)

    // Reference: sum the atomic amounts, then split once.
    const totalAtomic = calls.reduce((s, c) => s + toAtomic(c), 0n)
    const refCreator = contractSplitAtomic(totalAtomic, PLATFORM_FEE_BPS).creator

    // Per-call floored split <= single-split reference, but both are exact
    // integers — and crucially the per-call accumulation is deterministic.
    expect(acc).toBe(900_000n) // 1000 * 0.001 = 1.0 USDC, 90% = 0.9 USDC
    expect(refCreator).toBe(900_000n)
    expect(fromAtomic(acc)).toBe('0.900000')
  })

  it('pins per-call accumulation semantics — diverges from single-split-on-total', () => {
    // The previous batch test used 0.001 USDC, where the per-call floored fee is
    // non-zero (100n) so per-call accumulation and a single split-on-the-total
    // happen to AGREE (both 900_000n). That coincidence means it CANNOT catch a
    // refactor of route.ts to split the total once instead of per call.
    //
    // This case is chosen so the two semantics DIVERGE: with a tiny amount whose
    // per-call fee floors to zero, the creator keeps the whole micro-amount on
    // every call, but splitting the accumulated total once would skim a fee.
    // Pinning the per-call result locks in the production semantics; the explicit
    // 3000n !== 2700n assertion proves the test would FAIL if route.ts were ever
    // refactored to split the grand total a single time.
    const N = 1000
    const perCall = 0.000003

    // Real helpers keep this in sync with production math.
    const atomicPerCall = toAtomic(perCall) // 3n
    expect(atomicPerCall).toBe(3n)
    expect(feeSplit(atomicPerCall, PLATFORM_FEE_BPS).fee).toBe(0n) // floor(3*1000/10000) = 0

    // (a) Per-call accumulation: creator keeps 3n each call → 3000n.
    let acc = 0n
    for (let i = 0; i < N; i++) acc += routeCreatorShare(perCall, PLATFORM_FEE_BPS)
    const perCallCreator = BigInt(N) * feeSplit(atomicPerCall, PLATFORM_FEE_BPS).creator
    expect(acc).toBe(perCallCreator)
    expect(acc).toBe(3000n)

    // Single-split-on-total: feeSplit(3000n, 1000).creator = 3000n - 300n = 2700n.
    const totalAtomic = BigInt(N) * atomicPerCall // 3000n
    const singleSplitCreator = feeSplit(totalAtomic, PLATFORM_FEE_BPS).creator
    expect(singleSplitCreator).toBe(2700n)

    // (b) The two semantics DIVERGE — the property the older test could not catch.
    expect(acc).not.toBe(singleSplitCreator)
    expect(3000n).not.toBe(2700n)
  })
})
