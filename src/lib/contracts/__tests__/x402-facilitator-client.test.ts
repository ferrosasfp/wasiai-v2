/**
 * WAS-V2-1 W2 — tests for x402-facilitator-client.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildX402V2Envelope,
  mapFacilitatorErrorToSettlementResult,
  verifyExternal,
  settleExternal,
  type SettlePaymentX402Ctx,
} from '@/lib/contracts/x402-facilitator-client'
import type { X402EVMPayload } from '@/lib/contracts/usdcSettler'

const ctx: SettlePaymentX402Ctx = {
  requestId:    'req-test',
  agentSlug:    'echo',
  resourceUrl:  'https://app.wasiai.io/api/v1/models/echo/invoke',
  atomicAmount: '1000',
  asset:        '0x5425890298aed601595a70AB815c96711a31Bc65',
  payTo:        '0x0000000000000000000000000000000000000001',
  network:      'avalanche-testnet',
}

const payload: X402EVMPayload = {
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

describe('buildX402V2Envelope — CD-NEW-SDD-6', () => {
  it('produces envelope with explicit keys in schema order', () => {
    const env = buildX402V2Envelope(payload, ctx)
    expect(Object.keys(env)).toEqual(['x402Version', 'resource', 'accepted', 'payload'])
    expect(env.x402Version).toBe(2)
    expect(env.accepted.extra.assetTransferMethod).toBe('eip3009')
    expect(env.accepted.scheme).toBe('exact')
    // Hot-fix 2026-04-25: ctx.network='avalanche-testnet' is translated to
    // canonical x402 v2 'eip155:43113' before sending to facilitator (Zod .strict()).
    expect(env.accepted.network).toBe('eip155:43113')
    expect(env.accepted.amount).toBe('1000')
    expect(env.accepted.maxTimeoutSeconds).toBe(300)
    expect(env.payload).toBe(payload)
  })

  it('resource block has url + description + mimeType', () => {
    const env = buildX402V2Envelope(payload, ctx)
    expect(env.resource.url).toBe(ctx.resourceUrl)
    expect(env.resource.description).toContain('echo')
    expect(env.resource.mimeType).toBe('application/json')
  })
})

describe('mapFacilitatorErrorToSettlementResult — DT-G', () => {
  it.each([
    ['INVALID_PAYLOAD',         'verify' as const, false],
    ['INVALID_SIGNATURE',       'verify' as const, false],
    ['EXPIRED_AUTHORIZATION',   'verify' as const, false],
    ['INVALID_AMOUNT',          'verify' as const, false],
    ['INSUFFICIENT_BALANCE',    'verify' as const, false],
    ['NETWORK_MISMATCH',        'verify' as const, false],
    ['SIMULATION_FAILED',       'verify' as const, false],
    ['RATE_LIMITED',            'verify' as const, false],
    ['CHAIN_UNAVAILABLE',       'verify' as const, false],
    ['TRANSACTION_FAILED',      'settle' as const, true], // verified true, settled false
  ])('maps %s phase=%s → SettlementResult.error startsWith code; verified=%s', (code, phase, verified) => {
    const r = mapFacilitatorErrorToSettlementResult(400, { code, message: 'test' }, phase)
    expect(r.verified).toBe(verified)
    expect(r.settled).toBe(false)
    expect(r.error?.startsWith(`${code}:`)).toBe(true)
  })

  it('unknown code falls back to INVALID_PAYLOAD', () => {
    const r = mapFacilitatorErrorToSettlementResult(400, { code: 'WHATEVER', message: 'x' }, 'verify')
    expect(r.error?.startsWith('INVALID_PAYLOAD:')).toBe(true)
  })

  it('null body falls back to INVALID_PAYLOAD with HTTP status as message', () => {
    const r = mapFacilitatorErrorToSettlementResult(500, null, 'verify')
    expect(r.error).toContain('INVALID_PAYLOAD')
    expect(r.error).toContain('HTTP 500')
  })

  it('CD-12: NONCE_ALREADY_USED is in KNOWN_FACILITATOR_CODES for settle phase', () => {
    const r = mapFacilitatorErrorToSettlementResult(
      409,
      { code: 'NONCE_ALREADY_USED', message: 'consumed' },
      'settle',
    )
    expect(r.verified).toBe(true)
    expect(r.settled).toBe(false)
    expect(r.error).toBe('NONCE_ALREADY_USED: consumed')
  })

  it('CD-12: NONCE_ALREADY_USED at verify phase returns verified=false (verify failed)', () => {
    const r = mapFacilitatorErrorToSettlementResult(
      409,
      { code: 'NONCE_ALREADY_USED', message: 'nonce 0xabc consumed on-chain' },
      'verify',
    )
    expect(r.verified).toBe(false)
    expect(r.settled).toBe(false)
    expect(r.error).toMatch(/^NONCE_ALREADY_USED:/)
  })
})

describe('verifyExternal — fetch behavior', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns ok on HTTP 200 + verified:true body', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ verified: true }),
    } as unknown as Response)
    const env = buildX402V2Envelope(payload, ctx)
    const r = await verifyExternal(env, 'https://fac.test', AbortSignal.timeout(1000))
    expect(r.ok).toBe(true)
  })

  it('returns CHAIN_UNAVAILABLE on fetch reject (timeout)', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('aborted'))
    const env = buildX402V2Envelope(payload, ctx)
    const r = await verifyExternal(env, 'https://fac.test', AbortSignal.timeout(1000))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.error).toContain('CHAIN_UNAVAILABLE')
      expect(r.error.error).toContain('facilitator unreachable')
    }
  })

  it('maps HTTP 400 INVALID_SIGNATURE to SettlementResult', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false, status: 400, json: async () => ({ code: 'INVALID_SIGNATURE', message: 'bad sig' }),
    } as unknown as Response)
    const env = buildX402V2Envelope(payload, ctx)
    const r = await verifyExternal(env, 'https://fac.test', AbortSignal.timeout(1000))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.verified).toBe(false)
      expect(r.error.error).toMatch(/^INVALID_SIGNATURE:/)
    }
  })

  it('returns INVALID_PAYLOAD when shape unexpected (HTTP 200 but no verified key)', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ random: 'shape' }),
    } as unknown as Response)
    const env = buildX402V2Envelope(payload, ctx)
    const r = await verifyExternal(env, 'https://fac.test', AbortSignal.timeout(1000))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.error).toContain('INVALID_PAYLOAD')
  })

  it('POSTs to {facilitatorUrl}/verify with envelope body', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ verified: true }),
    } as unknown as Response)
    const env = buildX402V2Envelope(payload, ctx)
    await verifyExternal(env, 'https://fac.test', AbortSignal.timeout(1000))
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe('https://fac.test/verify')
    const init = call[1] as RequestInit
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body as string)).toMatchObject({ x402Version: 2 })
  })
})

describe('settleExternal — fetch behavior', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns ok with transactionHash on HTTP 200', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ settled: true, transactionHash: '0xabc' }),
    } as unknown as Response)
    const env = buildX402V2Envelope(payload, ctx)
    const r = await settleExternal(env, 'https://fac.test', AbortSignal.timeout(1000))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.body.transactionHash).toBe('0xabc')
  })

  it('returns verified:true settled:false on HTTP 500 TRANSACTION_FAILED (AC-5)', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false, status: 500, json: async () => ({ code: 'TRANSACTION_FAILED', message: 'reverted' }),
    } as unknown as Response)
    const env = buildX402V2Envelope(payload, ctx)
    const r = await settleExternal(env, 'https://fac.test', AbortSignal.timeout(1000))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.verified).toBe(true)
      expect(r.error.settled).toBe(false)
      expect(r.error.error).toMatch(/^TRANSACTION_FAILED:/)
    }
  })

  it('returns INVALID_PAYLOAD when settle ok but transactionHash missing', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ settled: true }),
    } as unknown as Response)
    const env = buildX402V2Envelope(payload, ctx)
    const r = await settleExternal(env, 'https://fac.test', AbortSignal.timeout(1000))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.verified).toBe(true)
      expect(r.error.settled).toBe(false)
      expect(r.error.error).toContain('INVALID_PAYLOAD')
    }
  })

  it('POSTs to {facilitatorUrl}/settle', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ settled: true, transactionHash: '0xabc' }),
    } as unknown as Response)
    const env = buildX402V2Envelope(payload, ctx)
    await settleExternal(env, 'https://fac.test', AbortSignal.timeout(1000))
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe('https://fac.test/settle')
  })
})
