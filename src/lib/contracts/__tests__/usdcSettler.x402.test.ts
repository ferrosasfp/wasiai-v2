/**
 * WAS-V2-1 W3 — tests for settlePaymentX402 wrapper.
 *
 * Strategy:
 *   - Mock the *dependencies* of settlePaymentX402 (`getFacilitatorUrl`,
 *     `verifyExternal`, `settleExternal`) — these are imported from sibling
 *     modules so vi.mock cleanly intercepts them.
 *   - For the "internal branch" tests, use a payload whose `validBefore` is in
 *     the past so settlePaymentDirectly returns quickly via the early
 *     timing-check return (no on-chain calls, no viem signature recovery).
 *   - Assert the observable invariants: which deps were called, with what args,
 *     and what shape the wrapper returns.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type {
  X402EVMPayload,
  SettlementResult,
  SettlePaymentX402Ctx,
} from '@/lib/contracts/usdcSettler'

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/contracts/x402-facilitator-config', () => ({
  getFacilitatorUrl: vi.fn(),
  __resetFacilitatorUrlCacheForTesting: vi.fn(),
}))

vi.mock('@/lib/contracts/x402-facilitator-client', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/contracts/x402-facilitator-client')
  >('@/lib/contracts/x402-facilitator-client')
  return {
    ...actual,
    verifyExternal: vi.fn(),
    settleExternal: vi.fn(),
  }
})

const ctx: SettlePaymentX402Ctx = {
  requestId:    'req-1',
  agentSlug:    'echo',
  resourceUrl:  'https://x.test/api/v1/models/echo/invoke',
  atomicAmount: '1000',
  asset:        '0x5425890298aed601595a70AB815c96711a31Bc65',
  payTo:        '0x0000000000000000000000000000000000000001',
  network:      'avalanche-testnet',
}

// Payload that returns immediately from settlePaymentDirectly via the
// "Authorization expired" early branch — keeps tests fast and deterministic.
const expiredPayload: X402EVMPayload = {
  signature: '0x' + 'a'.repeat(130),
  authorization: {
    from:        '0x' + '1'.repeat(40),
    to:          '0x' + '2'.repeat(40),
    value:       '1000',
    validAfter:  '0',
    validBefore: '1', // year 1970 — guaranteed expired
    nonce:       '0x' + '0'.repeat(64),
  },
}

// Payload for external-branch tests (timing OK, but external mock controls flow).
const livePayload: X402EVMPayload = {
  signature: '0x' + 'a'.repeat(130),
  authorization: {
    from:        '0x' + '1'.repeat(40),
    to:          '0x' + '2'.repeat(40),
    value:       '1000',
    validAfter:  '0',
    validBefore: '9999999999',
    nonce:       '0x' + '0'.repeat(64),
  },
}

describe('settlePaymentX402 — wrapper (W3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('AC-1/AC-7: flag unset → invokes settlePaymentDirectly path; fetch NOT called', async () => {
    const { getFacilitatorUrl } = await import('@/lib/contracts/x402-facilitator-config')
    ;(getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue(null)
    const { settlePaymentX402 } = await import('@/lib/contracts/usdcSettler')

    const r = await settlePaymentX402(expiredPayload, '1000', ctx)

    // settlePaymentDirectly ran (we know because we got its early-return shape)
    expect(r.verified).toBe(false)
    expect(r.settled).toBe(false)
    expect(r.error).toContain('Authorization expired')
    expect(globalThis.fetch).not.toHaveBeenCalled()
    const { verifyExternal, settleExternal } = await import('@/lib/contracts/x402-facilitator-client')
    expect(verifyExternal).not.toHaveBeenCalled()
    expect(settleExternal).not.toHaveBeenCalled()
  })

  it('AC-2/AC-3/AC-8: flag set + verify ok + settle ok → external called, returns facilitator txHash', async () => {
    const { getFacilitatorUrl } = await import('@/lib/contracts/x402-facilitator-config')
    ;(getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://fac.test')
    const { verifyExternal, settleExternal } = await import('@/lib/contracts/x402-facilitator-client')
    ;(verifyExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, body: { verified: true } })
    ;(settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      body: { settled: true, transactionHash: '0xEXTERNAL' },
    })

    const { settlePaymentX402 } = await import('@/lib/contracts/usdcSettler')
    const r = await settlePaymentX402(livePayload, '1000', ctx)

    expect(verifyExternal).toHaveBeenCalledTimes(1)
    expect(settleExternal).toHaveBeenCalledTimes(1)
    expect(r).toEqual({ verified: true, settled: true, transactionHash: '0xEXTERNAL' })
  })

  it('AC-4: flag set + verify 400 INVALID_SIGNATURE → mapped error, settle NOT called', async () => {
    const { getFacilitatorUrl } = await import('@/lib/contracts/x402-facilitator-config')
    ;(getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://fac.test')
    const { verifyExternal, settleExternal } = await import('@/lib/contracts/x402-facilitator-client')
    const errResult: SettlementResult = {
      verified: false,
      settled: false,
      error: 'INVALID_SIGNATURE: bad sig',
    }
    ;(verifyExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, error: errResult })

    const { settlePaymentX402 } = await import('@/lib/contracts/usdcSettler')
    const r = await settlePaymentX402(livePayload, '1000', ctx)

    expect(verifyExternal).toHaveBeenCalledTimes(1)
    expect(settleExternal).not.toHaveBeenCalled()
    expect(r.verified).toBe(false)
    expect(r.error).toMatch(/^INVALID_SIGNATURE:/)
  })

  it('AC-5: flag set + verify ok + settle 500 TRANSACTION_FAILED → verified:true settled:false', async () => {
    const { getFacilitatorUrl } = await import('@/lib/contracts/x402-facilitator-config')
    ;(getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://fac.test')
    const { verifyExternal, settleExternal } = await import('@/lib/contracts/x402-facilitator-client')
    ;(verifyExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, body: { verified: true } })
    const errResult: SettlementResult = {
      verified: true,
      settled: false,
      error: 'TRANSACTION_FAILED: reverted',
    }
    ;(settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, error: errResult })

    const { settlePaymentX402 } = await import('@/lib/contracts/usdcSettler')
    const r = await settlePaymentX402(livePayload, '1000', ctx)

    expect(r.verified).toBe(true)
    expect(r.settled).toBe(false)
    expect(r.error).toMatch(/^TRANSACTION_FAILED:/)
  })

  it('AC-6: flag set + verifyExternal returns CHAIN_UNAVAILABLE → propagates', async () => {
    const { getFacilitatorUrl } = await import('@/lib/contracts/x402-facilitator-config')
    ;(getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://fac.test')
    const { verifyExternal, settleExternal } = await import('@/lib/contracts/x402-facilitator-client')
    ;(verifyExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      error: {
        verified: false,
        settled: false,
        error: 'CHAIN_UNAVAILABLE: facilitator unreachable',
      },
    })

    const { settlePaymentX402 } = await import('@/lib/contracts/usdcSettler')
    const r = await settlePaymentX402(livePayload, '1000', ctx)

    expect(r.verified).toBe(false)
    expect(r.error).toContain('CHAIN_UNAVAILABLE')
    expect(settleExternal).not.toHaveBeenCalled()
  })

  it('CD-NEW-SDD-4: flag malformed (config returns null) → falls back to internal path', async () => {
    const { getFacilitatorUrl } = await import('@/lib/contracts/x402-facilitator-config')
    ;(getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue(null)
    const { verifyExternal } = await import('@/lib/contracts/x402-facilitator-client')

    const { settlePaymentX402 } = await import('@/lib/contracts/usdcSettler')
    const r = await settlePaymentX402(expiredPayload, '1000', ctx)

    // internal path returned its early-return shape; external never invoked.
    expect(r.error).toContain('Authorization expired')
    expect(verifyExternal).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('AC-10: emits structured log with settlerType + durationMs + ok (internal)', async () => {
    const { getFacilitatorUrl } = await import('@/lib/contracts/x402-facilitator-config')
    ;(getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue(null)
    const { logger } = await import('@/lib/logger')

    const { settlePaymentX402 } = await import('@/lib/contracts/usdcSettler')
    await settlePaymentX402(expiredPayload, '1000', ctx)

    expect(logger.info).toHaveBeenCalledWith(
      '[settler]',
      expect.objectContaining({
        requestId:   'req-1',
        agentSlug:   'echo',
        settlerType: 'internal',
        ok:          false, // expired auth → not ok
        durationMs:  expect.any(Number),
      }),
    )
  })

  it('AC-10: emits structured log with settlerType=external + facilitatorUrl + ok=true', async () => {
    const { getFacilitatorUrl } = await import('@/lib/contracts/x402-facilitator-config')
    ;(getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://fac.test')
    const { verifyExternal, settleExternal } = await import('@/lib/contracts/x402-facilitator-client')
    ;(verifyExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, body: { verified: true } })
    ;(settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      body: { settled: true, transactionHash: '0xOK' },
    })
    const { logger } = await import('@/lib/logger')

    const { settlePaymentX402 } = await import('@/lib/contracts/usdcSettler')
    await settlePaymentX402(livePayload, '1000', ctx)

    expect(logger.info).toHaveBeenCalledWith(
      '[settler]',
      expect.objectContaining({
        requestId:      'req-1',
        agentSlug:      'echo',
        settlerType:    'external',
        facilitatorUrl: 'https://fac.test',
        ok:             true,
        durationMs:     expect.any(Number),
      }),
    )
  })
})
