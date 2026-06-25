/**
 * V6 — handleInvoke registers a refund when settle-OK + upstream-fail.
 *
 * The caller paid on-chain (settle OK) but the upstream agent failed, so the
 * caller got no service. handleInvoke must register a 'pending' refund with
 * payer = authorization.from and amount = the settled amount (auth.value).
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
  refundsInsert:            vi.fn(),
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

const PAYER = '0x' + '1'.repeat(40)
const x402Payload = {
  x402Version: 1,
  scheme:      'exact',
  network:     'avalanche-testnet',
  payload: {
    signature: '0x' + 'a'.repeat(130),
    authorization: {
      from:        PAYER,
      to:          '0x' + '2'.repeat(40),
      value:       '120000', // 0.12 USDC atomic = the settled amount
      validAfter:  '0',
      validBefore: '9999999999',
      nonce:       '0x' + '0'.repeat(64),
    },
  },
}
const X_PAYMENT = Buffer.from(JSON.stringify(x402Payload)).toString('base64')

function makeRequest(slug: string) {
  return new NextRequest(`http://localhost/api/v1/models/${slug}/invoke`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-request-id': 'req-test-1', 'X-PAYMENT': X_PAYMENT },
    body:    JSON.stringify({ input: { q: 'hello' } }),
  })
}
function makeParams(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

/** refunds chain: insert() spy resolves OK (or supplied result). */
function makeRefundsChain(insertSpy: ReturnType<typeof vi.fn>, result: { error: unknown } = { error: null }) {
  const chain = {} as Record<string, ReturnType<typeof vi.fn>>
  chain.insert = insertSpy.mockResolvedValue(result)
  return chain
}

function wireSupabase(refunds = makeRefundsChain(mocks.refundsInsert)) {
  mocks.serviceFrom.mockImplementation((table: string) => {
    if (table === 'agents')              return makeChain({ data: ACTIVE_MODEL, error: null })
    if (table === 'agent_calls')         return makeAgentCallsChain(mocks.agentCallsInsert)
    if (table === 'settlement_failures') return makeSettlementFailuresChain(mocks.settlementFailuresInsert)
    if (table === 'refunds')             return refunds
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
  wireSupabase()
})

describe('V6 — refund registration on settle-OK + upstream-fail', () => {
  it('registers ONE pending refund with payer=authorization.from and amount=settled', async () => {
    mocks.settlePaymentX402.mockResolvedValue({
      verified: true, settled: true, transactionHash: '0x' + 'f'.repeat(64),
    })
    mocks.wrapWithCircuitBreaker.mockRejectedValue(new Error('Upstream HTTP 503'))

    const res = await POST(makeRequest('demo-agent'), makeParams('demo-agent'))

    expect(mocks.refundsInsert).toHaveBeenCalledTimes(1)
    expect(mocks.refundsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        settlement_tx_hash: '0x' + 'f'.repeat(64),
        payer_address:      PAYER,
        amount_usdc:        '0.120000', // exactly what the caller paid (settled amount)
        agent_slug:         'demo-agent',
        status:             'pending',
      }),
    )
    expect((await res.json()).meta.upstream_failed).toBe(true)
  })

  it('does NOT register a refund when upstream succeeds', async () => {
    mocks.settlePaymentX402.mockResolvedValue({
      verified: true, settled: true, transactionHash: '0x' + 'e'.repeat(64),
    })
    mocks.wrapWithCircuitBreaker.mockResolvedValue({ ok: true, json: async () => ({ output: 'ok' }) })

    await POST(makeRequest('demo-agent'), makeParams('demo-agent'))

    expect(mocks.refundsInsert).not.toHaveBeenCalled()
  })

  it('duplicate settlement tx (23505) is swallowed — anti double-refund', async () => {
    mocks.settlePaymentX402.mockResolvedValue({
      verified: true, settled: true, transactionHash: '0x' + 'f'.repeat(64),
    })
    mocks.wrapWithCircuitBreaker.mockRejectedValue(new Error('Upstream HTTP 503'))
    // refunds.insert returns unique-violation → handler must not throw / must treat as idempotent
    wireSupabase(makeRefundsChain(mocks.refundsInsert, { error: { code: '23505' } }))

    const res = await POST(makeRequest('demo-agent'), makeParams('demo-agent'))

    // still responds with the upstream error; the duplicate refund is silently ignored
    expect(res.status).toBe(503)
    expect((await res.json()).meta.upstream_failed).toBe(true)
  })
})
