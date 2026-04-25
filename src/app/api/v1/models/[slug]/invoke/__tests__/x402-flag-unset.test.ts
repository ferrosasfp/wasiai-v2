/**
 * WAS-V2-1 W4 — AC-9 regression smoke test.
 *
 * Asserts that when X402_FACILITATOR_URL is unset, settlePaymentX402 NEVER
 * invokes fetch (i.e., the wrapper delegates to the internal settler — same
 * shape as pre-WAS-V2-1 behavior).
 *
 * We don't run the full route handler here (that would require Supabase + DB
 * fixtures). Instead we validate the contract at the wrapper boundary, which
 * is what the route depends on. AC-9 (response body shape) is preserved by
 * AC-1 (settlePaymentDirectly returns identical SettlementResult shape) +
 * the route handler being untouched in the response path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { X402EVMPayload, SettlePaymentX402Ctx } from '@/lib/contracts/usdcSettler'

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/contracts/x402-facilitator-config', () => ({
  getFacilitatorUrl: vi.fn(() => null), // simulate flag unset
  __resetFacilitatorUrlCacheForTesting: vi.fn(),
}))

describe('AC-9: flag unset → fetch never called from settlePaymentX402 (regression smoke)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('settlePaymentX402 with flag unset never invokes fetch (delegates to internal)', async () => {
    const { settlePaymentX402 } = await import('@/lib/contracts/usdcSettler')
    const ctx: SettlePaymentX402Ctx = {
      requestId:    'r',
      agentSlug:    's',
      resourceUrl:  'https://x',
      atomicAmount: '1000',
      asset:        '0x5425890298aed601595a70AB815c96711a31Bc65',
      payTo:        '0x0000000000000000000000000000000000000001',
      network:      'avalanche-testnet',
    }
    // Expired authorization → settlePaymentDirectly returns early; no on-chain call.
    const payload: X402EVMPayload = {
      signature: '0x' + 'a'.repeat(130),
      authorization: {
        from:        '0x' + '1'.repeat(40),
        to:          '0x' + '2'.repeat(40),
        value:       '1000',
        validAfter:  '0',
        validBefore: '1',
        nonce:       '0x' + '0'.repeat(64),
      },
    }
    const r = await settlePaymentX402(payload, '1000', ctx)
    // Either returned the early-return shape or the catch-all error — never a fetch call.
    expect(r.verified).toBe(false)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
