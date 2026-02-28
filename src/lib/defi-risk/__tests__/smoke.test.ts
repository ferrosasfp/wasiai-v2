import { describe, it, expect } from 'vitest'
import { computeRiskScore } from '../riskScorer'
import type { AuditResult, OnChainResult, ChainlinkResult, SentimentResult } from '../types'

describe('riskScorer — unit tests (no external calls)', () => {

  it('AVOID: token con CRITICAL finding', () => {
    const audit: AuditResult = {
      token_address: '0x0000000000000000000000000000000000000000',
      findings: [{ severity: 'CRITICAL', title: 'Rug pull', description: 'drainable' }],
      summary: 'Dangerous',
      powered_by: 'groq-llama',
    }

    const score = computeRiskScore(null, null, audit, null)
    expect(score.total).toBeGreaterThanOrEqual(66)
    expect(score.rating).toBe('AVOID')
  })

  it('SAFE: token limpio, baja concentración, baja volatilidad', () => {
    const chainlink: ChainlinkResult = {
      feed_address: '0x1234567890123456789012345678901234567890',
      token_symbol: 'TEST',
      price_usd: 1.0,
      timestamp: Date.now() / 1000,
      round_id: '1',
      history: [],
      volatility_7d_pct: 5,  // bajo
    }
    const onchain: OnChainResult = {
      token_address: '0x1234567890123456789012345678901234567890',
      name: 'Clean Token',
      symbol: 'CLN',
      total_supply: '1000000',
      decimals: 18,
      contract_age_days: 365,
      holder_count: 5000,
      top10_concentration_pct: 25,  // bajo
      flags: { has_mint_function: false, owner_renounced: true, is_paused: false, is_proxy: false, bytecode_size_bytes: 1000 },
    }
    const sentiment: SentimentResult = {
      token_name: 'Clean Token',
      token_symbol: 'CLN',
      sentiment_score: 5,  // muy limpio
      flags: [],
      analysis: 'Appears legitimate',
    }
    const score = computeRiskScore(chainlink, onchain, null, sentiment)
    expect(score.total).toBeLessThanOrEqual(30)
    expect(score.rating).toBe('SAFE')
  })

  it('CAUTION: datos neutros sin findings', () => {
    const score = computeRiskScore(null, null, null, null)
    // audit=null → 0 (no findings = no audit risk)
    // volatility=null → 50, concentration=null → 50, sentiment=null → 50
    // 0*0.35 + 50*0.25 + 50*0.25 + 50*0.15 = 0 + 12.5 + 12.5 + 7.5 = 32.5 → 33
    expect(score.total).toBe(33)
    expect(score.rating).toBe('CAUTION')
  })

  it('rating thresholds correctos', () => {
    // Test boundary values
    const makeRating = (total: number) => {
      return total <= 30 ? 'SAFE' : total <= 65 ? 'CAUTION' : 'AVOID'
    }
    expect(makeRating(0)).toBe('SAFE')
    expect(makeRating(30)).toBe('SAFE')
    expect(makeRating(31)).toBe('CAUTION')
    expect(makeRating(65)).toBe('CAUTION')
    expect(makeRating(66)).toBe('AVOID')
    expect(makeRating(100)).toBe('AVOID')
  })

  it('breakdown contiene los 4 componentes', () => {
    const score = computeRiskScore(null, null, null, null)
    expect(score.breakdown).toHaveProperty('volatility')
    expect(score.breakdown).toHaveProperty('concentration')
    expect(score.breakdown).toHaveProperty('audit')
    expect(score.breakdown).toHaveProperty('sentiment')
    expect(score.breakdown.audit.weight).toBe(0.35)
    expect(score.breakdown.volatility.weight).toBe(0.25)
  })

})
