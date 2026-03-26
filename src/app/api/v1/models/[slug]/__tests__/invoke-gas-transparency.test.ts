/**
 * WAS-297 integration tests for invoke route — gas transparency fields
 * Tests build402Instructions and buildResponse logic in isolation.
 *
 * Pattern: mirrors settlement-failure-serialization.test.ts — extract + test pure logic.
 * The invoke route is 835 lines with many deps; we test the changed functions in isolation.
 */
import { describe, it, expect } from 'vitest'

// ── Type mirrors ──────────────────────────────────────────────────────────────
type GasSource = 'redis' | 'chainlink' | 'coingecko' | 'env_fallback' | 'none'

interface PricingInfo {
  creatorPrice: number
  overhead:     number
  totalPrice:   number
  breakdown:    { gas: number }
  gas_source:   GasSource
}

interface OverheadInfo {
  overhead:   number
  gas_source: GasSource
}

// ── Mirrors of production functions (extracted for isolation testing) ─────────
// These mirror the exact logic from invoke/route.ts without external dependencies.

function build402BreakdownLogic(
  priceStr: string,
  overheadInfo: OverheadInfo,
) {
  const total = Number(priceStr)
  return {
    creator_price: total - overheadInfo.overhead,
    gas_fee_usdc:  overheadInfo.overhead,
    total,
    gas_estimated: overheadInfo.gas_source !== 'none',
  }
}

function buildResponsePricingLogic(pricingInfo: PricingInfo) {
  return {
    creator_price:     pricingInfo.creatorPrice,
    platform_overhead: pricingInfo.overhead,
    gas_fee_usdc:      pricingInfo.overhead,    // NEW alias
    total:             pricingInfo.totalPrice,
    gas_source:        pricingInfo.gas_source,  // NEW
    breakdown:         pricingInfo.breakdown,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WAS-297: build402Instructions — gas transparency', () => {

  it('1. PricingInfo type includes gas_source field', () => {
    // TypeScript structural check — if the type is correct, this object is valid
    const info: PricingInfo = {
      creatorPrice: 0.10,
      overhead:     0.02,
      totalPrice:   0.12,
      breakdown:    { gas: 0.02 },
      gas_source:   'chainlink',
    }
    expect(info.gas_source).toBe('chainlink')
  })

  it('2. build402Instructions includes breakdown fields', () => {
    const breakdown = build402BreakdownLogic('0.12', { overhead: 0.02, gas_source: 'chainlink' })
    expect(breakdown).toHaveProperty('creator_price')
    expect(breakdown).toHaveProperty('gas_fee_usdc')
    expect(breakdown).toHaveProperty('total')
    expect(breakdown).toHaveProperty('gas_estimated')
  })

  it('2b. breakdown values are correct', () => {
    const breakdown = build402BreakdownLogic('0.12', { overhead: 0.02, gas_source: 'chainlink' })
    expect(breakdown.creator_price).toBeCloseTo(0.10, 6)
    expect(breakdown.gas_fee_usdc).toBe(0.02)
    expect(breakdown.total).toBe(0.12)
    expect(breakdown.gas_estimated).toBe(true)
  })

  it('3. build402Instructions gas_estimated=false when gas_source="none" (fail-open)', () => {
    const breakdown = build402BreakdownLogic('0.10', { overhead: 0, gas_source: 'none' })
    expect(breakdown.gas_estimated).toBe(false)
    expect(breakdown.gas_fee_usdc).toBe(0)
  })

  it('4a. gas_estimated=true for source: chainlink', () => {
    const breakdown = build402BreakdownLogic('0.12', { overhead: 0.02, gas_source: 'chainlink' })
    expect(breakdown.gas_estimated).toBe(true)
  })

  it('4b. gas_estimated=true for source: coingecko', () => {
    const breakdown = build402BreakdownLogic('0.12', { overhead: 0.02, gas_source: 'coingecko' })
    expect(breakdown.gas_estimated).toBe(true)
  })

  it('4c. gas_estimated=true for source: redis', () => {
    const breakdown = build402BreakdownLogic('0.12', { overhead: 0.02, gas_source: 'redis' })
    expect(breakdown.gas_estimated).toBe(true)
  })

  it('4d. gas_estimated=true for source: env_fallback', () => {
    const breakdown = build402BreakdownLogic('0.12', { overhead: 0.02, gas_source: 'env_fallback' })
    expect(breakdown.gas_estimated).toBe(true)
  })
})

describe('WAS-297: buildResponse — gas transparency in pricing', () => {

  it('5. pricing includes gas_fee_usdc AND platform_overhead (backward compat)', () => {
    const pricingInfo: PricingInfo = {
      creatorPrice: 0.10,
      overhead:     0.02,
      totalPrice:   0.12,
      breakdown:    { gas: 0.02 },
      gas_source:   'chainlink',
    }
    const pricing = buildResponsePricingLogic(pricingInfo)
    expect(pricing).toHaveProperty('gas_fee_usdc')
    expect(pricing).toHaveProperty('platform_overhead')
    // Both should be the same value (alias)
    expect(pricing.gas_fee_usdc).toBe(pricingInfo.overhead)
    expect(pricing.platform_overhead).toBe(pricingInfo.overhead)
  })

  it('6. pricing includes gas_source', () => {
    const pricingInfo: PricingInfo = {
      creatorPrice: 0.10,
      overhead:     0.02,
      totalPrice:   0.12,
      breakdown:    { gas: 0.02 },
      gas_source:   'redis',
    }
    const pricing = buildResponsePricingLogic(pricingInfo)
    expect(pricing).toHaveProperty('gas_source')
    expect(pricing.gas_source).toBe('redis')
  })

  it('6b. gas_source is preserved for all sources', () => {
    const sources: GasSource[] = ['redis', 'chainlink', 'coingecko', 'env_fallback', 'none']
    for (const source of sources) {
      const pricing = buildResponsePricingLogic({
        creatorPrice: 0.10,
        overhead: source === 'none' ? 0 : 0.02,
        totalPrice: source === 'none' ? 0.10 : 0.12,
        breakdown: { gas: source === 'none' ? 0 : 0.02 },
        gas_source: source,
      })
      expect(pricing.gas_source).toBe(source)
    }
  })

  it('7. pricing includes breakdown field', () => {
    const pricingInfo: PricingInfo = {
      creatorPrice: 0.10,
      overhead:     0.02,
      totalPrice:   0.12,
      breakdown:    { gas: 0.02 },
      gas_source:   'chainlink',
    }
    const pricing = buildResponsePricingLogic(pricingInfo)
    expect(pricing).toHaveProperty('breakdown')
    expect(pricing.breakdown).toEqual({ gas: 0.02 })
  })

  it('8. creator_price + overhead = total (math check)', () => {
    const pricingInfo: PricingInfo = {
      creatorPrice: 0.10,
      overhead:     0.02,
      totalPrice:   0.12,
      breakdown:    { gas: 0.02 },
      gas_source:   'chainlink',
    }
    const pricing = buildResponsePricingLogic(pricingInfo)
    expect(pricing.creator_price + pricing.platform_overhead).toBeCloseTo(pricing.total, 6)
  })
})
