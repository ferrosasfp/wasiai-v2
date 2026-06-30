/**
 * fee-math.test.ts — V-03 (audit 2026-06-25)
 *
 * The admin settlement route (`route.ts:246`) used to write the creator's net
 * earnings to the off-chain ledger as an IEEE-754 float:
 *
 *     const net = (batchAmounts[i] ?? 0) * (1 - PLATFORM_FEE_BPS / 10000)
 *
 * That drifts from the integer 90/10 split the contract performs on-chain and
 * desyncs `pending_earnings_usdc`. The fix mirrors the cron
 * (`runSettlement.ts:256-263`): accumulate the creator share in atomic
 * micro-USDC via `feeSplit(toAtomic(amount), bps)` and convert with `fromAtomic`
 * at write time, guaranteeing `fee + creatorNet === amount` exactly.
 *
 * This test reproduces the route's per-creator accumulation loop bit-for-bit
 * (the heavy on-chain/dynamic-import machinery of the full route is out of
 * scope) and asserts: (a) conservation `fee + creator === amount`, and (b) the
 * old float path actually drifts on the same inputs.
 */
import { describe, it, expect } from 'vitest'
import { toAtomic, feeSplit, fromAtomic } from '@/lib/money/usdc'

// Exact replica of the new route loop (route.ts:250-256): accumulate creator
// share per agent in atomic micro-USDC, keyed by creator wallet.
function accumulateEarnings(
  rows: ReadonlyArray<{ wallet: string; amount: number }>,
  bps: number,
): Map<string, bigint> {
  const earningsByCreator = new Map<string, bigint>()
  let totalAtomic = 0n
  let feeAtomic = 0n
  for (const { wallet, amount } of rows) {
    const amountAtomic = toAtomic(amount)
    const { fee, creator } = feeSplit(amountAtomic, bps)
    totalAtomic += amountAtomic
    feeAtomic += fee
    earningsByCreator.set(wallet, (earningsByCreator.get(wallet) ?? 0n) + creator)
  }
  // Sanity invariant available to callers via the returned map; also assert here.
  let creatorAtomic = 0n
  for (const v of earningsByCreator.values()) creatorAtomic += v
  expect(feeAtomic + creatorAtomic).toBe(totalAtomic)
  return earningsByCreator
}

describe('V-03 admin settlement fee math (atomic, no float drift)', () => {
  it('fee + creatorNet === amount exactly for each call', () => {
    const bps = 1000 // 10%
    for (const amount of [0.02, 0.01, 0.000001, 0.123457, 9999.999999]) {
      const amountAtomic = toAtomic(amount)
      const { fee, creator } = feeSplit(amountAtomic, bps)
      expect(fee + creator).toBe(amountAtomic)
    }
  })

  it('accumulates net per creator with no micro-USDC lost across a batch', () => {
    const rows = [
      { wallet: '0xAAA', amount: 0.02 },
      { wallet: '0xBBB', amount: 0.01 },
      { wallet: '0xAAA', amount: 0.000001 },
      { wallet: '0xBBB', amount: 0.123457 },
      { wallet: '0xAAA', amount: 0.000003 },
    ]
    const bps = 1000
    const byCreator = accumulateEarnings(rows, bps) // asserts conservation internally

    // 0xAAA: 0.02 + 0.000001 + 0.000003 = 0.020004 → creator = 90% floored per call
    // Per-call: feeSplit(20000,1000)=creator 18000; feeSplit(1,1000)=creator 1; feeSplit(3,1000)=creator 3
    expect(byCreator.get('0xAAA')).toBe(18000n + 1n + 3n)
    // The ledger write value is fromAtomic(atomic) — a canonical 6-decimal string.
    expect(fromAtomic(byCreator.get('0xAAA')!)).toBe('0.018004')
  })

  it('the atomic path is exact where the old float path drifts', () => {
    // 7 micro-USDC at 10% fee: feeSplit(7,1000).fee = floor(7000/10000) = 0,
    // creator = 7 (sub-unit fee floors to the creator, contract-faithful). The
    // old float net = 0.000007 * 0.9 = 0.0000063 → rounds to 6 atomic, LOSING a
    // micro-USDC vs the on-chain split. The atomic path keeps all 7.
    const atomicNet = feeSplit(toAtomic(0.000007), 1000).creator
    expect(atomicNet).toBe(7n)
    expect(fromAtomic(atomicNet)).toBe('0.000007')

    const floatNet = 0.000007 * (1 - 1000 / 10000) // 0.0000063
    const floatAtomic = BigInt(Math.round(floatNet * 1_000_000)) // 6n — drift
    expect(floatAtomic).not.toBe(atomicNet)
  })
})
