/**
 * usdc.test.ts — V4 (KEY_BALANCE_MISMATCH) integer USDC math.
 *
 * Cubre toAtomic/fromAtomic round-trip, feeSplit (suma exacta, casos de redondeo)
 * y el caso NO-DRIFT: sumar N montos pequeños en micro-USDC enteros cierra exacto
 * mientras que la suma en float driftea.
 */
import { describe, it, expect } from 'vitest'
import { toAtomic, fromAtomic, feeSplit, sumAtomic } from '@/lib/money/usdc'

describe('toAtomic', () => {
  it('converts whole dollars', () => {
    expect(toAtomic(1)).toBe(1_000_000n)
    expect(toAtomic('1')).toBe(1_000_000n)
    expect(toAtomic('1.000000')).toBe(1_000_000n)
  })

  it('converts 6-decimal values exactly (string path, no float)', () => {
    expect(toAtomic('0.123456')).toBe(123456n)
    expect(toAtomic('0.000001')).toBe(1n)
    expect(toAtomic('10.500000')).toBe(10_500_000n)
  })

  it('converts numbers via round-to-nearest micro-unit', () => {
    expect(toAtomic(0.02)).toBe(20_000n)
    expect(toAtomic(0.000001)).toBe(1n)
  })

  it('rounds the 7th fractional digit (string path)', () => {
    expect(toAtomic('0.0000005')).toBe(1n)  // round up
    expect(toAtomic('0.0000004')).toBe(0n)  // round down
    expect(toAtomic('0.1234565')).toBe(123457n)
  })

  it('handles negatives', () => {
    expect(toAtomic('-0.000005')).toBe(-5n)
    expect(toAtomic(-1)).toBe(-1_000_000n)
  })

  it('throws on non-finite / unparseable', () => {
    expect(() => toAtomic(Number.NaN)).toThrow()
    expect(() => toAtomic(Number.POSITIVE_INFINITY)).toThrow()
    expect(() => toAtomic('')).toThrow()
    expect(() => toAtomic('abc')).toThrow()
  })
})

describe('fromAtomic', () => {
  it('formats with 6 decimals', () => {
    expect(fromAtomic(1_000_000n)).toBe('1.000000')
    expect(fromAtomic(123456n)).toBe('0.123456')
    expect(fromAtomic(1n)).toBe('0.000001')
    expect(fromAtomic(0n)).toBe('0.000000')
  })

  it('formats negatives', () => {
    expect(fromAtomic(-5n)).toBe('-0.000005')
    expect(fromAtomic(-1_500_000n)).toBe('-1.500000')
  })
})

describe('toAtomic/fromAtomic round-trip', () => {
  const samples = ['0.000001', '0.020000', '0.123456', '1.000000', '999.999999', '10.500000']
  for (const s of samples) {
    it(`round-trips ${s}`, () => {
      expect(fromAtomic(toAtomic(s))).toBe(s)
    })
  }
})

describe('feeSplit', () => {
  it('fee + creator === amount exactly (no unit lost)', () => {
    for (const amount of [1n, 999n, 1_000_000n, 123_456n, 7n, 9_999_999n]) {
      for (const bps of [0, 1, 250, 1000, 9999, 10000]) {
        const { fee, creator } = feeSplit(amount, bps)
        expect(fee + creator).toBe(amount)
        expect(fee).toBeGreaterThanOrEqual(0n)
        expect(creator).toBeGreaterThanOrEqual(0n)
      }
    }
  })

  it('floors the fee — remainder goes to creator', () => {
    // 0.001 USDC = 1000 atomic, feeBps 1000 (10%) → fee = floor(1000*1000/10000) = 100
    const { fee, creator } = feeSplit(toAtomic('0.001'), 1000)
    expect(fee).toBe(100n)
    expect(creator).toBe(900n)
  })

  it('sub-unit fee floors to 0 (creator keeps it)', () => {
    // 1 atomic at 10% → fee = floor(1*1000/10000) = 0, creator = 1
    const { fee, creator } = feeSplit(1n, 1000)
    expect(fee).toBe(0n)
    expect(creator).toBe(1n)
  })

  it('0 bps → all to creator; 10000 bps → all to fee', () => {
    expect(feeSplit(123_456n, 0)).toEqual({ fee: 0n, creator: 123_456n })
    expect(feeSplit(123_456n, 10000)).toEqual({ fee: 123_456n, creator: 0n })
  })

  it('rejects invalid inputs', () => {
    expect(() => feeSplit(-1n, 1000)).toThrow()
    expect(() => feeSplit(100n, -1)).toThrow()
    expect(() => feeSplit(100n, 10001)).toThrow()
    expect(() => feeSplit(100n, 10.5)).toThrow()
  })
})

describe('NO-DRIFT: integer summation vs float', () => {
  it('summing 1000 small amounts in atomic units is exact', () => {
    const N = 1000
    const amount = '0.000001' // 1 micro-USDC
    const amounts = Array.from({ length: N }, () => amount)

    // Integer path: exact.
    const totalAtomic = sumAtomic(amounts)
    expect(totalAtomic).toBe(BigInt(N)) // 1000 micro-USDC
    expect(fromAtomic(totalAtomic)).toBe('0.001000')

    // Float path: demonstrate it can drift (this is the bug we eliminate).
    const floatTotal = amounts.reduce((a, b) => a + Number(b), 0)
    // 1000 * 0.000001 in float is NOT exactly 0.001 — round-trip via atomic differs.
    const floatAtomic = BigInt(Math.round(floatTotal * 1_000_000))
    // Both happen to land here, but the canonical integer total is authoritative.
    expect(totalAtomic).toBe(floatAtomic) // sanity, not the point
  })

  it('summing many odd cents stays exact where float accumulates error', () => {
    // 0.1 has no exact binary representation. Summing it 10x in float != 1.0 exactly.
    const ten = Array.from({ length: 10 }, () => '0.100000')
    expect(sumAtomic(ten)).toBe(1_000_000n)
    expect(fromAtomic(sumAtomic(ten))).toBe('1.000000')

    // Float drift evidence: 0.1 summed 10 times !== 1.0 in IEEE-754.
    const floatSum = ten.reduce((a, b) => a + Number(b), 0)
    expect(floatSum).not.toBe(1.0) // 0.9999999999999999
  })

  it('batch: creatorShare + fee summed per-call === total of inputs (no unit lost)', () => {
    // Mirror runSettlement: per-call feeSplit accumulated, then compare against total.
    const inputs = ['0.020000', '0.010000', '0.000001', '0.123457', '0.000003']
    const feeBps = 1000

    let totalAtomic = 0n
    let feeAtomic = 0n
    let creatorAtomic = 0n
    for (const i of inputs) {
      const a = toAtomic(i)
      totalAtomic += a
      const { fee, creator } = feeSplit(a, feeBps)
      feeAtomic += fee
      creatorAtomic += creator
    }
    // Every micro-USDC is accounted for: fee + creator === total.
    expect(feeAtomic + creatorAtomic).toBe(totalAtomic)
    expect(totalAtomic).toBe(sumAtomic(inputs))
  })

  it('FP-2: immediateSettlement audit total is exact (fromAtomic(sumAtomic(...)))', () => {
    // Mirrors immediateSettlement.ts: total_usdc written for a settled key batch.
    // amount_paid arrives from the DB as numeric(20,6) decimal strings.
    // 0.1 has no exact binary representation — summing it in float drifts.
    const batch = Array.from({ length: 3 }, () => ({ amount_paid: '0.100000' }))
    const totalUsd = fromAtomic(sumAtomic(batch.map(c => c.amount_paid)))
    expect(totalUsd).toBe('0.300000') // exact integer total, no IEEE-754 drift

    // Float path drifts on the same inputs (0.1 + 0.1 + 0.1 !== 0.3).
    const floatTotal = batch.map(c => Number(c.amount_paid)).reduce((a, b) => a + b, 0)
    expect(floatTotal).not.toBe(0.3) // 0.30000000000000004
  })
})
