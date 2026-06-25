/**
 * handleInvoke — Route B (x402) behavioural tests.
 * Audit 2026-06-25, P0: exercise the REAL handleInvoke x402 path. settlePaymentX402
 * is mocked at the boundary (the settler has its own unit tests); the route logic
 * (verify gate, settle gate, settlement_failures on upstream-fail, nonce replay,
 * pending-earnings credit) runs for real.
 *
 * Complements models/[slug]/invoke/__tests__/x402-settle-fail.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import {
  ACTIVE_MODEL, makeChain, makeAgentCallsChain, makeSettlementFailuresChain,
} from './_setup'

const mocks = vi.hoisted(() => ({
  serviceFrom:              vi.fn(),
  rpc:                      vi.fn(),
  agentCallsInsert:         vi.fn(),
  settlementFailuresInsert: vi.fn(),
  triggerAgentEvent:        vi.fn(),
  wrapWithCircuitBreaker:   vi.fn(),
  getState:                 vi.fn(),
  calcPlatformOverhead:     vi.fn(),
  settlePaymentX402:        vi.fn(),
  validateInput:            vi.fn(),
  checkRateLimit:           vi.fn(),
  checkCreatorRateLimits:   vi.fn(),
}))

vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  // Run deferred work synchronously so after()-scheduled side effects (settlement_failures
  // insert, increment_pending_earnings) are observable in tests.
  return { ...actual, after: vi.fn((cb: () => unknown) => { void cb() }) }
})
vi.mock('@/lib/supabase/server', () => ({
  createClient:        vi.fn(),
  createServiceClient: vi.fn(() => ({ from: mocks.serviceFrom, rpc: mocks.rpc })),
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/ratelimit', () => ({
  getInvokeLimit:         vi.fn(() => null),
  getIdentifier:          vi.fn(() => 'test-id'),
  checkRateLimit:         mocks.checkRateLimit,
  checkCreatorRateLimits: mocks.checkCreatorRateLimits,
  getSharedRedis:         vi.fn(() => ({ del: vi.fn(), set: vi.fn() })),
}))
vi.mock('@/lib/circuit-breaker/CircuitBreaker', () => ({
  getState:               mocks.getState,
  wrapWithCircuitBreaker: mocks.wrapWithCircuitBreaker,
}))
vi.mock('@/lib/circuit-breaker/retryWithBackoff', () => ({ retryWithBackoff: vi.fn((fn: () => unknown) => fn()) }))
vi.mock('@/lib/pricing/overhead', () => ({ calcPlatformOverhead: mocks.calcPlatformOverhead }))
vi.mock('@/lib/webhooks/triggerAgentEvent', () => ({ triggerAgentEvent: mocks.triggerAgentEvent }))
vi.mock('@/lib/receipts/signReceipt', () => ({ signReceipt: vi.fn(async () => '0xsig') }))
vi.mock('@/lib/contracts/marketplaceClient', () => ({ keyHashToBytes32: vi.fn(() => '0x' + '0'.repeat(64)) }))
vi.mock('@/lib/contracts/usdcSettler', async () => {
  const actual = await vi.importActual<typeof import('@/lib/contracts/usdcSettler')>('@/lib/contracts/usdcSettler')
  return { ...actual, settlePaymentX402: mocks.settlePaymentX402 }
})
vi.mock('@/lib/chain', () => ({ CHAIN_NAME: 'avalanche-testnet', IS_MAINNET: false }))
vi.mock('@/lib/constants', () => ({ SITE_URL: 'http://localhost:3000' }))
vi.mock('@/lib/scope-check', () => ({ isAgentInScope: vi.fn(() => true) }))
vi.mock('@/lib/schema-validator', () => ({ validateInput: mocks.validateInput }))
vi.mock('@/lib/validation/payment-type', () => ({ assertPaymentType: vi.fn() }))

import { POST } from '@/app/api/v1/models/[slug]/invoke/route'

const x402Payload = {
  x402Version: 1,
  scheme:      'exact',
  network:     'avalanche-testnet',
  payload: {
    signature: '0x' + 'a'.repeat(130),
    authorization: {
      from:        '0x' + '1'.repeat(40),
      to:          '0x' + '2'.repeat(40),
      value:       '120000',
      validAfter:  '0',
      validBefore: '9999999999',
      nonce:       '0x' + '0'.repeat(64),
    },
  },
}
const X_PAYMENT = Buffer.from(JSON.stringify(x402Payload)).toString('base64')

function makeRequest(slug: string, withPayment = true) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-request-id': 'req-test-1' }
  if (withPayment) headers['X-PAYMENT'] = X_PAYMENT
  return new NextRequest(`http://localhost/api/v1/models/${slug}/invoke`, {
    method:  'POST',
    headers,
    body:    JSON.stringify({ input: { q: 'hello' } }),
  })
}
function makeParams(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

function wireSupabase(agentCalls = makeAgentCallsChain(mocks.agentCallsInsert)) {
  mocks.serviceFrom.mockImplementation((table: string) => {
    if (table === 'agents')              return makeChain({ data: ACTIVE_MODEL, error: null })
    if (table === 'agent_calls')         return agentCalls
    if (table === 'settlement_failures') return makeSettlementFailuresChain(mocks.settlementFailuresInsert)
    return makeChain({ data: null, error: null })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkRateLimit.mockReturnValue(null)
  mocks.checkCreatorRateLimits.mockReturnValue(null)
  mocks.getState.mockResolvedValue('closed')
  mocks.validateInput.mockReturnValue(null)
  mocks.triggerAgentEvent.mockResolvedValue(undefined)
  mocks.calcPlatformOverhead.mockResolvedValue({
    overhead: 0.02, breakdown: { gas: 0.02 }, circuitBreaker: false, gas_source: 'env_fallback' as const,
  })
  mocks.rpc.mockResolvedValue({ data: null, error: null })
  mocks.wrapWithCircuitBreaker.mockResolvedValue({ ok: true, json: async () => ({ output: 'ok' }) })
  wireSupabase()
})

describe('Route B — probe / verify gates', () => {
  it('no X-PAYMENT header → 402 with x402 instructions (probe)', async () => {
    const res = await POST(makeRequest('demo-agent', false), makeParams('demo-agent'))

    expect(res.status).toBe(402)
    expect((await res.json()).x402Version).toBe(1)
    expect(mocks.settlePaymentX402).not.toHaveBeenCalled()
  })

  it('settlement verified=false → 402 payment_invalid, no upstream, no logCall', async () => {
    mocks.settlePaymentX402.mockResolvedValue({ verified: false, settled: false, error: 'BAD_SIG' })

    const res = await POST(makeRequest('demo-agent'), makeParams('demo-agent'))

    expect(res.status).toBe(402)
    expect((await res.json()).code).toBe('payment_invalid')
    expect(mocks.wrapWithCircuitBreaker).not.toHaveBeenCalled()
    expect(mocks.agentCallsInsert).not.toHaveBeenCalled()
  })
})

describe('Route B — settle OK + upstream fails', () => {
  it('records settlement_failures and does not increment pending earnings', async () => {
    mocks.settlePaymentX402.mockResolvedValue({
      verified: true, settled: true, transactionHash: '0x' + 'f'.repeat(64),
    })
    mocks.wrapWithCircuitBreaker.mockRejectedValue(new Error('Upstream HTTP 503'))

    const res = await POST(makeRequest('demo-agent'), makeParams('demo-agent'))

    expect(mocks.settlementFailuresInsert).toHaveBeenCalledWith(
      expect.objectContaining({ settlement_tx_hash: '0x' + 'f'.repeat(64), agent_slug: 'demo-agent' }),
    )
    expect(mocks.rpc).not.toHaveBeenCalledWith('increment_pending_earnings', expect.anything())
    const body = await res.json()
    expect(body.meta.upstream_failed).toBe(true)
    expect(res.status).toBe(503)
  })

  it('settle OK + upstream success → increments pending earnings, no settlement_failures', async () => {
    mocks.settlePaymentX402.mockResolvedValue({
      verified: true, settled: true, transactionHash: '0x' + 'e'.repeat(64),
    })

    const res = await POST(makeRequest('demo-agent'), makeParams('demo-agent'))

    expect(res.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('increment_pending_earnings', expect.objectContaining({
      p_user_id: ACTIVE_MODEL.creator_id,
    }))
    expect(mocks.settlementFailuresInsert).not.toHaveBeenCalled()
  })
})

describe('Route B — nonce replay', () => {
  it('logCall hits unique nonce constraint (23505) → 402 payment_already_used', async () => {
    mocks.settlePaymentX402.mockResolvedValue({
      verified: true, settled: true, transactionHash: '0x' + 'd'.repeat(64),
    })
    wireSupabase(makeAgentCallsChain(mocks.agentCallsInsert, { data: null, error: { code: '23505' } }))

    const res = await POST(makeRequest('demo-agent'), makeParams('demo-agent'))

    expect(res.status).toBe(402)
    expect((await res.json()).code).toBe('payment_already_used')
    expect(mocks.rpc).not.toHaveBeenCalledWith('increment_pending_earnings', expect.anything())
  })
})

describe('Route B — settle stage failure (regression guard)', () => {
  it('verified=true settled=false → 502 settle_failed before upstream', async () => {
    mocks.settlePaymentX402.mockResolvedValue({ verified: true, settled: false, error: 'SETTLE_TIMEOUT' })

    const res = await POST(makeRequest('demo-agent'), makeParams('demo-agent'))

    expect(res.status).toBe(502)
    expect((await res.json()).code).toBe('settle_failed')
    expect(mocks.wrapWithCircuitBreaker).not.toHaveBeenCalled()
  })
})
