/**
 * WKH-128 — unit tests for the pure ledger reconciliation logic.
 *
 * Covers: exact match, divergence above tolerance, divergence within tolerance
 * (treated as match), empty input, signed delta direction, and the custom
 * tolerance boundary.
 */
import { describe, it, expect } from 'vitest'
import {
  reconcileKeyBalances,
  reconcileEarnings,
  isDivergent,
  DEFAULT_DUST_TOLERANCE_USDC,
  type KeyLedgerSnapshot,
  type CreatorLedgerSnapshot,
} from '@/lib/reconcile/reconcileLedger'

describe('isDivergent', () => {
  it('treats an exact match as not divergent', () => {
    expect(isDivergent(10, 10)).toBe(false)
  })

  it('treats a sub-tolerance gap as not divergent', () => {
    // 0.005 < default 0.01
    expect(isDivergent(10.005, 10)).toBe(false)
  })

  it('treats an at-tolerance gap as not divergent (boundary inclusive)', () => {
    expect(isDivergent(10.01, 10)).toBe(false)
  })

  it('flags a gap above tolerance as divergent', () => {
    expect(isDivergent(10.02, 10)).toBe(true)
  })

  it('respects a custom tolerance', () => {
    expect(isDivergent(10.5, 10, 1)).toBe(false)
    expect(isDivergent(11.5, 10, 1)).toBe(true)
  })
})

describe('reconcileKeyBalances', () => {
  it('returns an empty report for no snapshots', () => {
    const report = reconcileKeyBalances([])
    expect(report).toMatchObject({
      kind: 'key_balance',
      checked: 0,
      matched: 0,
      divergences: [],
      toleranceUsdc: DEFAULT_DUST_TOLERANCE_USDC,
    })
  })

  it('counts matches when off-chain == on-chain within tolerance', () => {
    const snaps: KeyLedgerSnapshot[] = [
      { id: 'k1', keyHash: 'aa', offChainUsdc: 9.98, onChainUsdc: 9.98 },
      { id: 'k2', keyHash: 'bb', offChainUsdc: 5.0, onChainUsdc: 5.005 },
    ]
    const report = reconcileKeyBalances(snaps)
    expect(report.checked).toBe(2)
    expect(report.matched).toBe(2)
    expect(report.divergences).toHaveLength(0)
  })

  it('flags divergence above tolerance with a signed delta', () => {
    const snaps: KeyLedgerSnapshot[] = [
      // DB shows MORE than chain (positive delta) — chain already debited
      { id: 'k1', keyHash: 'aa', offChainUsdc: 10, onChainUsdc: 8 },
    ]
    const report = reconcileKeyBalances(snaps)
    expect(report.matched).toBe(0)
    expect(report.divergences).toHaveLength(1)
    expect(report.divergences[0]).toMatchObject({
      kind: 'key_balance',
      ref: 'k1',
      offChainUsdc: 10,
      onChainUsdc: 8,
      deltaUsdc: 2,
    })
  })

  it('produces a negative delta when chain shows more than DB', () => {
    const snaps: KeyLedgerSnapshot[] = [
      { id: 'k1', keyHash: 'aa', offChainUsdc: 3, onChainUsdc: 7 },
    ]
    const report = reconcileKeyBalances(snaps)
    expect(report.divergences[0].deltaUsdc).toBe(-4)
  })

  it('separates matches from divergences in a mixed batch', () => {
    const snaps: KeyLedgerSnapshot[] = [
      { id: 'ok', keyHash: 'aa', offChainUsdc: 4, onChainUsdc: 4 },
      { id: 'bad', keyHash: 'bb', offChainUsdc: 4, onChainUsdc: 1 },
    ]
    const report = reconcileKeyBalances(snaps)
    expect(report.checked).toBe(2)
    expect(report.matched).toBe(1)
    expect(report.divergences).toHaveLength(1)
    expect(report.divergences[0].ref).toBe('bad')
  })

  it('honors a custom tolerance argument', () => {
    const snaps: KeyLedgerSnapshot[] = [
      { id: 'k1', keyHash: 'aa', offChainUsdc: 10.5, onChainUsdc: 10 },
    ]
    expect(reconcileKeyBalances(snaps, 1).divergences).toHaveLength(0)
    expect(reconcileKeyBalances(snaps, 0.1).divergences).toHaveLength(1)
  })
})

describe('reconcileEarnings', () => {
  it('returns an empty report for no snapshots', () => {
    const report = reconcileEarnings([])
    expect(report).toMatchObject({ kind: 'creator_earnings', checked: 0, matched: 0, divergences: [] })
  })

  it('matches within tolerance and flags above tolerance', () => {
    const snaps: CreatorLedgerSnapshot[] = [
      { wallet: '0xaaa', offChainUsdc: 100, onChainUsdc: 100 },
      { wallet: '0xbbb', offChainUsdc: 50, onChainUsdc: 40 },
    ]
    const report = reconcileEarnings(snaps)
    expect(report.checked).toBe(2)
    expect(report.matched).toBe(1)
    expect(report.divergences).toHaveLength(1)
    expect(report.divergences[0]).toMatchObject({
      kind: 'creator_earnings',
      ref: '0xbbb',
      deltaUsdc: 10,
    })
  })
})
