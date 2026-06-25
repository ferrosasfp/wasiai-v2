/**
 * WAS-V2-2 W1 — tests for facilitator-router.trySettle.
 *
 * Mock strategy (mirrors WAS-V2-1 usdcSettler.x402.test.ts:21-39):
 *   - Mock @/lib/logger to assert structured log emissions.
 *   - Mock @/lib/contracts/x402-facilitator-config to inject toggle/URL fixtures.
 *   - Mock verifyExternal/settleExternal to simulate facilitator responses.
 *   - Mock settlePaymentDirectly to keep tests fast (no viem/RPC).
 *
 * AC traceability per Story §10. Each `it()` name follows the exact strings
 * from the AC → Test matrix.
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
  getFacilitatorUrl:                    vi.fn(),
  isWasiaiFacilitatorPrimary:           vi.fn(),
  getWasiaiFacilitatorUrl:              vi.fn(() => 'https://wasiai.test'),
  // WAS-V2-INT: default null → wasiai branch threads apiKey=undefined unless a
  // test overrides this mock. UVD branch never receives any key (separate arg).
  getWasiaiFacilitatorApiKey:           vi.fn(() => null),
  WASIAI_CHAIN_ALLOWLIST:               new Set([
    'eip155:2366',
    'eip155:2368',
    'eip155:43113',
    'eip155:43114',
  ]),
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

vi.mock('@/lib/contracts/usdcSettler', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/contracts/usdcSettler')
  >('@/lib/contracts/usdcSettler')
  return {
    ...actual,
    settlePaymentDirectly: vi.fn(),
  }
})

// ─── Fixtures (verbatim from Story §10) ─────────────────────────────────────

const ctx: SettlePaymentX402Ctx = {
  requestId:    'req-1',
  agentSlug:    'echo',
  resourceUrl:  'https://x.test/api/v1/models/echo/invoke',
  atomicAmount: '1000',
  asset:        '0x5425890298aed601595a70AB815c96711a31Bc65',
  payTo:        '0x0000000000000000000000000000000000000001',
  network:      'avalanche-testnet',
}

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

describe('facilitator-router — WAS-V2-2 W1 (trySettle)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ─── AC-1: toggle OFF → ultravioleta exclusive ────────────────────────────

  it('AC-1: toggle unset routes to ultravioleta and never invokes wasiai', async () => {
    const config = await import('@/lib/contracts/x402-facilitator-config')
    ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(false)
    ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')

    const client = await import('@/lib/contracts/x402-facilitator-client')
    ;(client.verifyExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { verified: true },
    })
    ;(client.settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { settled: true, transactionHash: '0xUVD' },
    })

    const { trySettle } = await import('@/lib/contracts/facilitator-router')
    const r = await trySettle(livePayload, '1000', ctx)

    expect(r).toEqual({ verified: true, settled: true, transactionHash: '0xUVD' })
    // wasiai NEVER called → verifyExternal called exactly once (with UVD URL).
    expect(client.verifyExternal).toHaveBeenCalledTimes(1)
    // WAS-V2-INT: UVD branch calls with apiKey omitted → 4th arg undefined.
    expect(client.verifyExternal).toHaveBeenCalledWith(
      expect.anything(), 'https://uvd.test', expect.any(AbortSignal), undefined,
    )
    expect(client.settleExternal).toHaveBeenCalledWith(
      expect.anything(), 'https://uvd.test', expect.any(AbortSignal), undefined,
    )
  })

  it('AC-1: toggle false routes to ultravioleta', async () => {
    const config = await import('@/lib/contracts/x402-facilitator-config')
    ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(false)
    ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')

    const client = await import('@/lib/contracts/x402-facilitator-client')
    ;(client.verifyExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { verified: true },
    })
    ;(client.settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { settled: true, transactionHash: '0xUVD2' },
    })

    const { trySettle } = await import('@/lib/contracts/facilitator-router')
    const r = await trySettle(livePayload, '1000', ctx)

    expect(r.transactionHash).toBe('0xUVD2')
    expect(client.verifyExternal).toHaveBeenCalledTimes(1)
    expect(client.verifyExternal).toHaveBeenCalledWith(
      expect.anything(), 'https://uvd.test', expect.any(AbortSignal), undefined,
    )
  })

  it('AC-1: toggle FALSE (case-insensitive) routes to ultravioleta', async () => {
    // The case-insensitive parsing is in isWasiaiFacilitatorPrimary itself; the
    // router only sees the boolean result. We assert the router behaves the
    // same when the helper returns false (regardless of upstream case).
    const config = await import('@/lib/contracts/x402-facilitator-config')
    ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(false)
    ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')

    const client = await import('@/lib/contracts/x402-facilitator-client')
    ;(client.verifyExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { verified: true },
    })
    ;(client.settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { settled: true, transactionHash: '0xUVD3' },
    })

    const { trySettle } = await import('@/lib/contracts/facilitator-router')
    const r = await trySettle(livePayload, '1000', ctx)

    expect(r.transactionHash).toBe('0xUVD3')
    expect(client.verifyExternal).toHaveBeenCalledWith(
      expect.anything(), 'https://uvd.test', expect.any(AbortSignal), undefined,
    )
  })

  it('FUND-LOSS FIX: toggle off + UVD URL unset FAILS CLOSED (no internal settle, payTo-less path removed)', async () => {
    const config = await import('@/lib/contracts/x402-facilitator-config')
    ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(false)
    ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue(null)

    const settler = await import('@/lib/contracts/usdcSettler')
    const client = await import('@/lib/contracts/x402-facilitator-client')
    const { trySettle } = await import('@/lib/contracts/facilitator-router')
    const r = await trySettle(livePayload, '1000', ctx)

    // Fail-closed: NOT settled, error surfaced. The legacy internal
    // settlePaymentDirectly (which settled without validating payTo) is gone.
    expect(r.settled).toBe(false)
    expect(r.verified).toBe(false)
    expect(r.error).toMatch(/^NO_FACILITATOR_AVAILABLE:/)
    // settlePaymentDirectly MUST NOT be invoked by the router anymore.
    expect(settler.settlePaymentDirectly).not.toHaveBeenCalled()
    // No external facilitator was reachable either.
    expect(client.verifyExternal).not.toHaveBeenCalled()
    expect(client.settleExternal).not.toHaveBeenCalled()
  })

  it('FUND-LOSS FIX: toggle ON + wasiai fails + no UVD URL FAILS CLOSED (never settles without payTo)', async () => {
    const config = await import('@/lib/contracts/x402-facilitator-config')
    ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue(null) // no UVD fallback

    const client = await import('@/lib/contracts/x402-facilitator-client')
    // wasiai verify fails (5xx) → would fall back, but there is no UVD URL.
    ;(client.verifyExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      error: { verified: false, settled: false, error: 'SIMULATION_FAILED: boom' },
    })

    const settler = await import('@/lib/contracts/usdcSettler')
    const { trySettle } = await import('@/lib/contracts/facilitator-router')
    const r = await trySettle(livePayload, '1000', ctx)

    // Fail-closed: error, never settled. No payTo-less internal settle path exists.
    expect(r.settled).toBe(false)
    expect(r.verified).toBe(false)
    expect(r.error).toMatch(/^NO_FACILITATOR_AVAILABLE:/)
    // wasiai was tried (verify), but no settle ran anywhere.
    expect(settler.settlePaymentDirectly).not.toHaveBeenCalled()
    expect(client.settleExternal).not.toHaveBeenCalled()
  })

  // ─── AC-2: malformed toggle → safe defaults ─────────────────────────────

  it('AC-2: toggle malformed (maybe) routes to ultravioleta and warns once', async () => {
    // The helper itself warns once + returns false. From the router's POV,
    // we mock the helper to return false (same observable behavior).
    const config = await import('@/lib/contracts/x402-facilitator-config')
    ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(false)
    ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')

    const client = await import('@/lib/contracts/x402-facilitator-client')
    ;(client.verifyExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { verified: true },
    })
    ;(client.settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { settled: true, transactionHash: '0xUVD_MAYBE' },
    })

    const { trySettle } = await import('@/lib/contracts/facilitator-router')
    const r = await trySettle(livePayload, '1000', ctx)

    expect(r.transactionHash).toBe('0xUVD_MAYBE')
    // Router never invokes wasiai when primary === false.
    expect(client.verifyExternal).toHaveBeenCalledTimes(1)
    expect(client.verifyExternal).toHaveBeenCalledWith(
      expect.anything(), 'https://uvd.test', expect.any(AbortSignal), undefined,
    )
  })

  it('AC-2: malformed toggle does NOT throw at module init or call time', async () => {
    const config = await import('@/lib/contracts/x402-facilitator-config')
    ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(false)
    ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue(null)

    const settler = await import('@/lib/contracts/usdcSettler')
    ;(settler.settlePaymentDirectly as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      verified: true, settled: true, transactionHash: '0xOK',
    })

    const { trySettle } = await import('@/lib/contracts/facilitator-router')
    // Should NOT throw — wrap to assert promise resolves.
    await expect(trySettle(livePayload, '1000', ctx)).resolves.toBeDefined()
  })

  // ─── AC-3: toggle ON + allowed chain → wasiai first ──────────────────────

  it('AC-3: toggle on + chain avalanche-testnet (eip155:43113) calls wasiai first', async () => {
    const config = await import('@/lib/contracts/x402-facilitator-config')
    ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')

    const client = await import('@/lib/contracts/x402-facilitator-client')
    ;(client.verifyExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { verified: true },
    })
    ;(client.settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { settled: true, transactionHash: '0xWASIAI' },
    })

    const { trySettle } = await import('@/lib/contracts/facilitator-router')
    const r = await trySettle(livePayload, '1000', { ...ctx, network: 'avalanche-testnet' })

    expect(r.transactionHash).toBe('0xWASIAI')
    expect(client.verifyExternal).toHaveBeenNthCalledWith(
      1, expect.anything(), 'https://wasiai.test', expect.any(AbortSignal), undefined,
    )
  })

  it('AC-3: toggle on + chain avalanche (eip155:43114) calls wasiai first', async () => {
    const config = await import('@/lib/contracts/x402-facilitator-config')
    ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')

    const client = await import('@/lib/contracts/x402-facilitator-client')
    ;(client.verifyExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { verified: true },
    })
    ;(client.settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { settled: true, transactionHash: '0xWASIAI_MAINNET' },
    })

    const { trySettle } = await import('@/lib/contracts/facilitator-router')
    const r = await trySettle(livePayload, '1000', { ...ctx, network: 'avalanche' })

    expect(r.transactionHash).toBe('0xWASIAI_MAINNET')
    expect(client.verifyExternal).toHaveBeenNthCalledWith(
      1, expect.anything(), 'https://wasiai.test', expect.any(AbortSignal), undefined,
    )
  })

  // ─── AC-4: toggle ON + unknown chain → UVD direct ────────────────────────

  it('AC-4: toggle on + unknown chain bypasses wasiai and logs chain_not_in_allowlist', async () => {
    // Use a typed network value that networkToEip155 returns null for.
    // We achieve this by casting an out-of-domain literal — defensive path.
    const config = await import('@/lib/contracts/x402-facilitator-config')
    ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')

    const client = await import('@/lib/contracts/x402-facilitator-client')
    ;(client.verifyExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { verified: true },
    })
    ;(client.settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { settled: true, transactionHash: '0xUVD_BYPASS' },
    })

    const { logger } = await import('@/lib/logger')
    const { trySettle } = await import('@/lib/contracts/facilitator-router')
    // Cast an unknown network — the production types only permit avalanche/avalanche-testnet,
    // but defensive code in networkToEip155 returns null for any other value.
    const unknownNetworkCtx = {
      ...ctx,
      network: 'ethereum' as unknown as SettlePaymentX402Ctx['network'],
    }
    const r = await trySettle(livePayload, '1000', unknownNetworkCtx)

    expect(r.transactionHash).toBe('0xUVD_BYPASS')
    // wasiai NEVER invoked.
    expect(client.verifyExternal).toHaveBeenCalledTimes(1)
    expect(client.verifyExternal).toHaveBeenCalledWith(
      expect.anything(), 'https://uvd.test', expect.any(AbortSignal), undefined,
    )
    // debug log for chain bypass.
    expect(logger.debug).toHaveBeenCalledWith(
      '[facilitator-router] chain bypass',
      expect.objectContaining({ reason: 'chain_not_in_allowlist' }),
    )
  })

  // ─── AC-5: wasiai full success ───────────────────────────────────────────

  it('AC-5: wasiai verify+settle ok returns wasiai txHash and never calls ultravioleta', async () => {
    const config = await import('@/lib/contracts/x402-facilitator-config')
    ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')

    const client = await import('@/lib/contracts/x402-facilitator-client')
    ;(client.verifyExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { verified: true },
    })
    ;(client.settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { settled: true, transactionHash: '0xWASIAI_HAPPY' },
    })

    const { trySettle } = await import('@/lib/contracts/facilitator-router')
    const r = await trySettle(livePayload, '1000', ctx)

    expect(r).toEqual({
      verified: true, settled: true, transactionHash: '0xWASIAI_HAPPY',
    })
    // Exactly ONE verify + ONE settle call (against wasiai only).
    expect(client.verifyExternal).toHaveBeenCalledTimes(1)
    expect(client.settleExternal).toHaveBeenCalledTimes(1)
    // WAS-V2-INT: default apiKey mock = null → wasiai branch threads undefined.
    expect(client.verifyExternal).toHaveBeenCalledWith(
      expect.anything(), 'https://wasiai.test', expect.any(AbortSignal), undefined,
    )
    expect(client.settleExternal).toHaveBeenCalledWith(
      expect.anything(), 'https://wasiai.test', expect.any(AbortSignal), undefined,
    )
  })

  // ─── AC-6: wasiai 5xx → fallback ────────────────────────────────────────

  it('AC-6: wasiai 500 on verify falls back to ultravioleta with fallback_reason wasiai_5xx', async () => {
    const config = await import('@/lib/contracts/x402-facilitator-config')
    ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')

    const client = await import('@/lib/contracts/x402-facilitator-client')
    ;(client.verifyExternal as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({  // call #1 = wasiai
        ok: false,
        error: { verified: false, settled: false, error: 'SIMULATION_FAILED: rpc overload' },
      })
      .mockResolvedValueOnce({  // call #2 = uvd
        ok: true, body: { verified: true },
      })
    ;(client.settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { settled: true, transactionHash: '0xUVD_RECOVERED' },
    })

    const { logger } = await import('@/lib/logger')
    const { trySettle } = await import('@/lib/contracts/facilitator-router')
    const r = await trySettle(livePayload, '1000', ctx)

    expect(r.transactionHash).toBe('0xUVD_RECOVERED')
    expect(client.verifyExternal).toHaveBeenCalledTimes(2)
    expect(client.verifyExternal).toHaveBeenNthCalledWith(
      1, expect.anything(), 'https://wasiai.test', expect.any(AbortSignal), undefined,
    )
    expect(client.verifyExternal).toHaveBeenNthCalledWith(
      2, expect.anything(), 'https://uvd.test', expect.any(AbortSignal), undefined,
    )
    expect(logger.info).toHaveBeenCalledWith(
      '[settler]',
      expect.objectContaining({
        facilitatorUsed:   'ultravioleta',
        fallbackTriggered: true,
        fallbackReason:    'wasiai_5xx',
        wasiai_outcome:    'fail',
        uvd_outcome:       'ok',
        ok:                true,
        durationMs:        expect.any(Number),
      }),
    )
  })

  it('AC-6: wasiai 503 on settle falls back to ultravioleta with fallback_reason wasiai_5xx', async () => {
    const config = await import('@/lib/contracts/x402-facilitator-config')
    ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')

    const client = await import('@/lib/contracts/x402-facilitator-client')
    ;(client.verifyExternal as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, body: { verified: true } })  // wasiai verify ok
      .mockResolvedValueOnce({ ok: true, body: { verified: true } })  // uvd verify ok
    ;(client.settleExternal as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({  // wasiai settle 503
        ok: false,
        error: { verified: true, settled: false, error: 'TRANSACTION_FAILED: rpc unavailable' },
      })
      .mockResolvedValueOnce({  // uvd settle ok
        ok: true, body: { settled: true, transactionHash: '0xUVD_AFTER_SETTLE_FAIL' },
      })

    const { logger } = await import('@/lib/logger')
    const { trySettle } = await import('@/lib/contracts/facilitator-router')
    const r = await trySettle(livePayload, '1000', ctx)

    expect(r.transactionHash).toBe('0xUVD_AFTER_SETTLE_FAIL')
    expect(client.settleExternal).toHaveBeenCalledTimes(2)
    expect(logger.info).toHaveBeenCalledWith(
      '[settler]',
      expect.objectContaining({
        facilitatorUsed:   'ultravioleta',
        fallbackTriggered: true,
        fallbackReason:    'wasiai_5xx',
        ok:                true,
      }),
    )
  })

  // ─── AC-7: wasiai unreachable → fallback ────────────────────────────────

  it('AC-7: wasiai unreachable (CHAIN_UNAVAILABLE literal) falls back with fallback_reason wasiai_unreachable', async () => {
    const config = await import('@/lib/contracts/x402-facilitator-config')
    ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')

    const client = await import('@/lib/contracts/x402-facilitator-client')
    ;(client.verifyExternal as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({  // wasiai network error — exact literal from client:180
        ok: false,
        error: {
          verified: false, settled: false,
          error: 'CHAIN_UNAVAILABLE: facilitator unreachable',
        },
      })
      .mockResolvedValueOnce({ ok: true, body: { verified: true } })  // uvd ok
    ;(client.settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { settled: true, transactionHash: '0xUVD_NETERR_RECOVERED' },
    })

    const { logger } = await import('@/lib/logger')
    const { trySettle } = await import('@/lib/contracts/facilitator-router')
    const r = await trySettle(livePayload, '1000', ctx)

    expect(r.transactionHash).toBe('0xUVD_NETERR_RECOVERED')
    expect(logger.info).toHaveBeenCalledWith(
      '[settler]',
      expect.objectContaining({
        fallbackTriggered: true,
        fallbackReason:    'wasiai_unreachable',
      }),
    )
  })

  // ─── AC-8: wasiai INVALID_PAYLOAD / CHAIN_UNAVAILABLE body → fallback ───

  it('AC-8: wasiai INVALID_PAYLOAD body falls back with fallback_reason wasiai_invalid_payload', async () => {
    const config = await import('@/lib/contracts/x402-facilitator-config')
    ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')

    const client = await import('@/lib/contracts/x402-facilitator-client')
    ;(client.verifyExternal as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: false,
        error: { verified: false, settled: false, error: 'INVALID_PAYLOAD: bad envelope' },
      })
      .mockResolvedValueOnce({ ok: true, body: { verified: true } })
    ;(client.settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { settled: true, transactionHash: '0xUVD_INVALID_PAYLOAD_RECOVERED' },
    })

    const { logger } = await import('@/lib/logger')
    const { trySettle } = await import('@/lib/contracts/facilitator-router')
    const r = await trySettle(livePayload, '1000', ctx)

    expect(r.transactionHash).toBe('0xUVD_INVALID_PAYLOAD_RECOVERED')
    expect(logger.info).toHaveBeenCalledWith(
      '[settler]',
      expect.objectContaining({
        fallbackTriggered: true,
        fallbackReason:    'wasiai_invalid_payload',
      }),
    )
  })

  it('AC-8: wasiai CHAIN_UNAVAILABLE body falls back with fallback_reason wasiai_chain_unavailable', async () => {
    const config = await import('@/lib/contracts/x402-facilitator-config')
    ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')

    const client = await import('@/lib/contracts/x402-facilitator-client')
    ;(client.verifyExternal as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: false,
        error: { verified: false, settled: false, error: 'CHAIN_UNAVAILABLE: chain 43113 disabled' },
      })
      .mockResolvedValueOnce({ ok: true, body: { verified: true } })
    ;(client.settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { settled: true, transactionHash: '0xUVD_CHAIN_UNAVAILABLE_RECOVERED' },
    })

    const { logger } = await import('@/lib/logger')
    const { trySettle } = await import('@/lib/contracts/facilitator-router')
    const r = await trySettle(livePayload, '1000', ctx)

    expect(r.transactionHash).toBe('0xUVD_CHAIN_UNAVAILABLE_RECOVERED')
    expect(logger.info).toHaveBeenCalledWith(
      '[settler]',
      expect.objectContaining({
        fallbackTriggered: true,
        fallbackReason:    'wasiai_chain_unavailable',
      }),
    )
  })

  // ─── AC-9: both fail ─────────────────────────────────────────────────────

  it('AC-9: both wasiai and ultravioleta fail returns last error and logs both_failed=true', async () => {
    const config = await import('@/lib/contracts/x402-facilitator-config')
    ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')

    const client = await import('@/lib/contracts/x402-facilitator-client')
    ;(client.verifyExternal as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({  // wasiai fail
        ok: false,
        error: { verified: false, settled: false, error: 'SIMULATION_FAILED: rpc overload' },
      })
      .mockResolvedValueOnce({  // uvd fail
        ok: false,
        error: { verified: false, settled: false, error: 'INVALID_SIGNATURE: bad sig' },
      })

    const { logger } = await import('@/lib/logger')
    const { trySettle } = await import('@/lib/contracts/facilitator-router')
    const r = await trySettle(livePayload, '1000', ctx)

    expect(r.error).toBe('INVALID_SIGNATURE: bad sig') // last error wins
    expect(r.settled).toBe(false)
    expect(logger.info).toHaveBeenCalledWith(
      '[settler]',
      expect.objectContaining({
        facilitatorUsed:   'ultravioleta',
        fallbackTriggered: true,
        wasiai_outcome:    'fail',
        uvd_outcome:       'fail',
        both_failed:       true,
        ok:                false,
        errorCode:         'INVALID_SIGNATURE',
      }),
    )
  })

  // ─── AC-10 CRITICAL: idempotency guard — no fallback ────────────────────

  it('AC-10 CRITICAL: wasiai NONCE_ALREADY_USED body does NOT fall back, returns verified=true settled=false', async () => {
    const config = await import('@/lib/contracts/x402-facilitator-config')
    ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')

    const client = await import('@/lib/contracts/x402-facilitator-client')
    ;(client.verifyExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { verified: true },
    })
    ;(client.settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      error: {
        verified: true,
        settled: false,
        error: 'NONCE_ALREADY_USED: nonce 0xabc...def already consumed on-chain',
      } as SettlementResult,
    })

    const { trySettle } = await import('@/lib/contracts/facilitator-router')
    const r = await trySettle(livePayload, '1000', ctx)

    expect(r).toEqual({
      verified: true, settled: false,
      error: expect.stringMatching(/^NONCE_ALREADY_USED:/),
    })
    // CRITICAL: wasiai called twice (verify+settle), UVD ZERO times.
    expect(client.verifyExternal).toHaveBeenCalledTimes(1)
    expect(client.settleExternal).toHaveBeenCalledTimes(1)
    // UVD URL was NEVER passed to either client method.
    expect(client.verifyExternal).not.toHaveBeenCalledWith(
      expect.anything(), 'https://uvd.test', expect.any(AbortSignal),
    )
    expect(client.settleExternal).not.toHaveBeenCalledWith(
      expect.anything(), 'https://uvd.test', expect.any(AbortSignal),
    )
  })

  it('AC-10 CRITICAL: wasiai HTTP 409 mapped to NONCE_ALREADY_USED does NOT call settleExternal on UVD', async () => {
    const config = await import('@/lib/contracts/x402-facilitator-config')
    ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')

    const client = await import('@/lib/contracts/x402-facilitator-client')
    // wasiai verify returns NONCE_ALREADY_USED (e.g. HTTP 409 mapped at /verify)
    ;(client.verifyExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      error: {
        verified: false,
        settled: false,
        error: 'NONCE_ALREADY_USED: detected at verify phase',
      } as SettlementResult,
    })

    const { logger } = await import('@/lib/logger')
    const { trySettle } = await import('@/lib/contracts/facilitator-router')
    const r = await trySettle(livePayload, '1000', ctx)

    expect(r.error).toMatch(/^NONCE_ALREADY_USED:/)
    // wasiai verify called once, settle NOT called (verify already returned NONCE).
    expect(client.verifyExternal).toHaveBeenCalledTimes(1)
    expect(client.settleExternal).not.toHaveBeenCalled()
    // UVD NEVER invoked.
    expect(client.verifyExternal).not.toHaveBeenCalledWith(
      expect.anything(), 'https://uvd.test', expect.any(AbortSignal),
    )
    expect(client.settleExternal).not.toHaveBeenCalledWith(
      expect.anything(), 'https://uvd.test', expect.any(AbortSignal),
    )
    // Log records the guard.
    expect(logger.info).toHaveBeenCalledWith(
      '[settler]',
      expect.objectContaining({
        facilitatorUsed:            'wasiai',
        fallbackTriggered:          false,
        idempotencyGuardTriggered:  true,
        errorCode:                  'NONCE_ALREADY_USED',
        ok:                         false,
      }),
    )
  })

  // ─── AC-11: telemetry structure ──────────────────────────────────────────

  it('AC-11: log structure includes facilitatorUsed, fallbackTriggered, durationMs, ok, errorCode', async () => {
    const config = await import('@/lib/contracts/x402-facilitator-config')
    ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')

    const client = await import('@/lib/contracts/x402-facilitator-client')
    ;(client.verifyExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { verified: true },
    })
    ;(client.settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { settled: true, transactionHash: '0xTELEMETRY' },
    })

    const { logger } = await import('@/lib/logger')
    const { trySettle } = await import('@/lib/contracts/facilitator-router')
    await trySettle(livePayload, '1000', ctx)

    expect(logger.info).toHaveBeenCalledWith(
      '[settler]',
      expect.objectContaining({
        requestId:         'req-1',
        agentSlug:         'echo',
        facilitatorUsed:   'wasiai',
        fallbackTriggered: false,
        durationMs:        expect.any(Number),
        ok:                true,
      }),
    )
  })

  it('AC-11 + CD-10: log emitted exactly once per settlement', async () => {
    const config = await import('@/lib/contracts/x402-facilitator-config')
    ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')

    const client = await import('@/lib/contracts/x402-facilitator-client')
    // Force a fallback path to exercise the most complex case.
    ;(client.verifyExternal as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: false,
        error: { verified: false, settled: false, error: 'SIMULATION_FAILED: x' },
      })
      .mockResolvedValueOnce({ ok: true, body: { verified: true } })
    ;(client.settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { settled: true, transactionHash: '0xONE_LOG_ONLY' },
    })

    const { logger } = await import('@/lib/logger')
    const { trySettle } = await import('@/lib/contracts/facilitator-router')
    await trySettle(livePayload, '1000', ctx)

    // Exactly ONE [settler] info log, regardless of how many sub-calls happened.
    const settlerCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === '[settler]',
    )
    expect(settlerCalls).toHaveLength(1)
  })

  // ─── BLQ-MED-1: UVD must receive a FRESH AbortSignal (not wasiai's) ─────

  it('BLQ-MED-1: wasiai timeout (aborted signal) does NOT propagate to UVD — UVD gets a fresh, non-aborted signal', async () => {
    vi.useFakeTimers()
    try {
      const config = await import('@/lib/contracts/x402-facilitator-config')
      ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(true)
      ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')

      const client = await import('@/lib/contracts/x402-facilitator-client')

      // wasiai verifyExternal: simulate a timeout by waiting until the signal
      // aborts (mirrors real-world fetch behavior under AbortSignal.timeout).
      ;(client.verifyExternal as ReturnType<typeof vi.fn>).mockImplementationOnce(
        async (_env: unknown, _url: string, signal: AbortSignal) => {
          // Resolve once the signal aborts — emulates `await fetch(url, { signal })`
          // throwing AbortError, which the client maps to CHAIN_UNAVAILABLE.
          await new Promise<void>((resolve) => {
            if (signal.aborted) return resolve()
            signal.addEventListener('abort', () => resolve(), { once: true })
          })
          return {
            ok: false,
            error: {
              verified: false,
              settled: false,
              error: 'CHAIN_UNAVAILABLE: facilitator unreachable',
            },
          }
        },
      )
      // UVD verifyExternal: captures its signal and resolves immediately so
      // we can assert the signal is fresh and NOT aborted at call time.
      let uvdReceivedSignal: AbortSignal | undefined
      ;(client.verifyExternal as ReturnType<typeof vi.fn>).mockImplementationOnce(
        async (_env: unknown, url: string, signal: AbortSignal) => {
          uvdReceivedSignal = signal
          expect(url).toBe('https://uvd.test')
          expect(signal.aborted).toBe(false)
          return { ok: true, body: { verified: true } }
        },
      )
      ;(client.settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true, body: { settled: true, transactionHash: '0xUVD_AFTER_WASIAI_TIMEOUT' },
      })

      const { trySettle } = await import('@/lib/contracts/facilitator-router')
      const promise = trySettle(livePayload, '1000', ctx)

      // Advance past the wasiai 30s timeout so its AbortSignal fires.
      await vi.advanceTimersByTimeAsync(30_001)

      const r = await promise

      // UVD recovered the payment after wasiai timed out.
      expect(r.transactionHash).toBe('0xUVD_AFTER_WASIAI_TIMEOUT')
      // UVD verifyExternal was called with a signal — and that signal is a
      // different instance from any timed-out wasiai signal (BLQ-MED-1).
      expect(uvdReceivedSignal).toBeDefined()
      // Capture wasiai's signal from the first call to prove it's a different
      // instance from UVD's (i.e. NOT shared).
      const wasiaiCall = (client.verifyExternal as ReturnType<typeof vi.fn>).mock.calls[0]
      const wasiaiSignal = wasiaiCall[2] as AbortSignal
      expect(uvdReceivedSignal).not.toBe(wasiaiSignal)
      // wasiai's signal is aborted (timeout fired); UVD's must still be live.
      expect(wasiaiSignal.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  // ─── CD-11 sanity: envelope is built ONCE via buildX402V2Envelope ───────

  it('CD-11: router does not mutate or spread envelope keys (delegates to buildX402V2Envelope)', async () => {
    const config = await import('@/lib/contracts/x402-facilitator-config')
    ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')

    const client = await import('@/lib/contracts/x402-facilitator-client')
    ;(client.verifyExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { verified: true },
    })
    ;(client.settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { settled: true, transactionHash: '0xENVELOPE_CHECK' },
    })

    const { trySettle } = await import('@/lib/contracts/facilitator-router')
    await trySettle(livePayload, '1000', ctx)

    // Inspect the envelope passed to verifyExternal — keys must be in canonical order.
    const verifyCall = (client.verifyExternal as ReturnType<typeof vi.fn>).mock.calls[0]
    const envelope = verifyCall[0] as Record<string, unknown>
    expect(Object.keys(envelope)).toEqual(['x402Version', 'resource', 'accepted', 'payload'])
    expect((envelope as { x402Version: number }).x402Version).toBe(2)
  })

  // ─── WAS-V2-INT: FACILITATOR_API_KEY threading (wasiai ONLY, never UVD) ──

  it('AC-1: when FACILITATOR_API_KEY set, wasiai verify+settle receive it as 4th arg', async () => {
    const config = await import('@/lib/contracts/x402-facilitator-config')
    ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')
    ;(config.getWasiaiFacilitatorApiKey as ReturnType<typeof vi.fn>).mockReturnValue('sk-wasiai-key')

    const client = await import('@/lib/contracts/x402-facilitator-client')
    ;(client.verifyExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { verified: true },
    })
    ;(client.settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { settled: true, transactionHash: '0xWASIAI_AUTH' },
    })

    const { trySettle } = await import('@/lib/contracts/facilitator-router')
    await trySettle(livePayload, '1000', ctx)

    // wasiai branch threads the key as the 4th positional arg.
    expect(client.verifyExternal).toHaveBeenCalledWith(
      expect.anything(), 'https://wasiai.test', expect.any(AbortSignal), 'sk-wasiai-key',
    )
    expect(client.settleExternal).toHaveBeenCalledWith(
      expect.anything(), 'https://wasiai.test', expect.any(AbortSignal), 'sk-wasiai-key',
    )
  })

  it('AC-1 CRITICAL: on fallback, UVD NEVER receives FACILITATOR_API_KEY (4th arg undefined)', async () => {
    const config = await import('@/lib/contracts/x402-facilitator-config')
    ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')
    ;(config.getWasiaiFacilitatorApiKey as ReturnType<typeof vi.fn>).mockReturnValue('sk-wasiai-key')

    const client = await import('@/lib/contracts/x402-facilitator-client')
    // wasiai verify fails (5xx) → fallback to UVD.
    ;(client.verifyExternal as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: false,
        error: { verified: false, settled: false, error: 'SIMULATION_FAILED: boom' },
      })
      .mockResolvedValueOnce({ ok: true, body: { verified: true } })
    ;(client.settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { settled: true, transactionHash: '0xUVD_NO_AUTH' },
    })

    const { trySettle } = await import('@/lib/contracts/facilitator-router')
    const r = await trySettle(livePayload, '1000', ctx)

    expect(r.transactionHash).toBe('0xUVD_NO_AUTH')
    // wasiai (1st verify call) got the key.
    expect((client.verifyExternal as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([
      expect.anything(), 'https://wasiai.test', expect.any(AbortSignal), 'sk-wasiai-key',
    ])
    // UVD (2nd verify call) did NOT — key MUST be undefined for the third-party.
    expect((client.verifyExternal as ReturnType<typeof vi.fn>).mock.calls[1]).toEqual([
      expect.anything(), 'https://uvd.test', expect.any(AbortSignal), undefined,
    ])
    // UVD settle also never receives the key.
    expect(client.settleExternal).toHaveBeenCalledWith(
      expect.anything(), 'https://uvd.test', expect.any(AbortSignal), undefined,
    )
    // The key string must NEVER appear in any UVD-targeted call.
    const uvdCalls = [
      ...(client.verifyExternal as ReturnType<typeof vi.fn>).mock.calls,
      ...(client.settleExternal as ReturnType<typeof vi.fn>).mock.calls,
    ].filter((c) => c[1] === 'https://uvd.test')
    for (const c of uvdCalls) {
      expect(c[3]).toBeUndefined()
    }
  })

  it('AC-1: toggle OFF (UVD-exclusive) NEVER passes the key even when env is set', async () => {
    const config = await import('@/lib/contracts/x402-facilitator-config')
    ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(false)
    ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')
    ;(config.getWasiaiFacilitatorApiKey as ReturnType<typeof vi.fn>).mockReturnValue('sk-wasiai-key')

    const client = await import('@/lib/contracts/x402-facilitator-client')
    ;(client.verifyExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { verified: true },
    })
    ;(client.settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { settled: true, transactionHash: '0xUVD_TOGGLE_OFF' },
    })

    const { trySettle } = await import('@/lib/contracts/facilitator-router')
    await trySettle(livePayload, '1000', ctx)

    // getWasiaiFacilitatorApiKey is not even consulted on the UVD-exclusive path,
    // and UVD calls carry undefined as the 4th arg.
    expect(client.verifyExternal).toHaveBeenCalledWith(
      expect.anything(), 'https://uvd.test', expect.any(AbortSignal), undefined,
    )
    expect(client.settleExternal).toHaveBeenCalledWith(
      expect.anything(), 'https://uvd.test', expect.any(AbortSignal), undefined,
    )
  })

  it('AC-2: FACILITATOR_API_KEY unset (null) → wasiai 4th arg undefined (no header)', async () => {
    const config = await import('@/lib/contracts/x402-facilitator-config')
    ;(config.isWasiaiFacilitatorPrimary as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(config.getFacilitatorUrl as ReturnType<typeof vi.fn>).mockReturnValue('https://uvd.test')
    ;(config.getWasiaiFacilitatorApiKey as ReturnType<typeof vi.fn>).mockReturnValue(null)

    const client = await import('@/lib/contracts/x402-facilitator-client')
    ;(client.verifyExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { verified: true },
    })
    ;(client.settleExternal as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, body: { settled: true, transactionHash: '0xWASIAI_NO_KEY' },
    })

    const { trySettle } = await import('@/lib/contracts/facilitator-router')
    await trySettle(livePayload, '1000', ctx)

    // null ?? undefined → undefined threaded to wasiai (graceful, no header).
    expect(client.verifyExternal).toHaveBeenCalledWith(
      expect.anything(), 'https://wasiai.test', expect.any(AbortSignal), undefined,
    )
  })
})
