/**
 * handleInvoke — Route A (agent-key budget) behavioural tests.
 * Audit 2026-06-25, P0: exercise the REAL handleInvoke logic (no mock of the
 * handler). Covers the unhappy paths the existing route-a-deduct-order.test.ts
 * does not: invalid key, empty scope, out-of-scope, mutex busy, Redis-down
 * fail-closed, soft budget check, paused agent, circuit-breaker open.
 *
 * Only edge deps are mocked (supabase, redis, circuit breaker, signReceipt,
 * upstream via wrapWithCircuitBreaker).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import {
  ACTIVE_MODEL, KEY_ROW, AGENT_KEY, makeChain, makeAgentCallsChain,
} from './_setup'

const mocks = vi.hoisted(() => ({
  serviceFrom:            vi.fn(),
  rpc:                    vi.fn(),
  agentCallsInsert:       vi.fn(),
  signReceipt:            vi.fn(),
  triggerAgentEvent:      vi.fn(),
  redisDel:               vi.fn(),
  redisSet:               vi.fn(),
  wrapWithCircuitBreaker: vi.fn(),
  getState:               vi.fn(),
  calcPlatformOverhead:   vi.fn(),
  validateInput:          vi.fn(),
  isAgentInScope:         vi.fn(),
  checkRateLimit:         vi.fn(),
  checkCreatorRateLimits: vi.fn(),
}))

vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: vi.fn() }
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
  getSharedRedis:         vi.fn(() => ({ del: mocks.redisDel, set: mocks.redisSet })),
}))
vi.mock('@/lib/circuit-breaker/CircuitBreaker', () => ({
  getState:               mocks.getState,
  wrapWithCircuitBreaker: mocks.wrapWithCircuitBreaker,
}))
vi.mock('@/lib/circuit-breaker/retryWithBackoff', () => ({ retryWithBackoff: vi.fn((fn: () => unknown) => fn()) }))
vi.mock('@/lib/pricing/overhead', () => ({ calcPlatformOverhead: mocks.calcPlatformOverhead }))
vi.mock('@/lib/webhooks/triggerAgentEvent', () => ({ triggerAgentEvent: mocks.triggerAgentEvent }))
vi.mock('@/lib/receipts/signReceipt', () => ({ signReceipt: mocks.signReceipt }))
vi.mock('@/lib/contracts/marketplaceClient', () => ({ keyHashToBytes32: vi.fn(() => '0x' + '0'.repeat(64)) }))
vi.mock('@/lib/chain', () => ({ CHAIN_NAME: 'avalanche-testnet', IS_MAINNET: false }))
vi.mock('@/lib/constants', () => ({ SITE_URL: 'http://localhost:3000' }))
vi.mock('@/lib/scope-check', () => ({ isAgentInScope: mocks.isAgentInScope }))
vi.mock('@/lib/schema-validator', () => ({ validateInput: mocks.validateInput }))
vi.mock('@/lib/validation/payment-type', () => ({ assertPaymentType: vi.fn() }))

import { POST } from '@/app/api/v1/models/[slug]/invoke/route'

function makeRequest(slug: string, key: string = AGENT_KEY, body: unknown = { input: { q: 'hi' } }) {
  return new NextRequest(`http://localhost/api/v1/models/${slug}/invoke`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-agent-key': key },
    body:    JSON.stringify(body),
  })
}
function makeParams(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

function wireSupabase(opts: { model?: unknown; modelError?: unknown; keyRow?: unknown } = {}) {
  const model  = 'model'  in opts ? opts.model  : ACTIVE_MODEL
  const keyRow = 'keyRow' in opts ? opts.keyRow : KEY_ROW
  mocks.serviceFrom.mockImplementation((table: string) => {
    if (table === 'agents')      return makeChain({ data: model, error: opts.modelError ?? null })
    if (table === 'agent_keys')  return makeChain({ data: keyRow, error: null })
    if (table === 'agent_calls') return makeAgentCallsChain(mocks.agentCallsInsert)
    return makeChain({ data: null, error: null })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkRateLimit.mockReturnValue(null)
  mocks.checkCreatorRateLimits.mockReturnValue(null)
  mocks.getState.mockResolvedValue('closed')
  mocks.isAgentInScope.mockReturnValue(true)
  mocks.validateInput.mockReturnValue(null)
  mocks.redisSet.mockResolvedValue('OK')      // mutex acquired
  mocks.redisDel.mockResolvedValue(1)
  mocks.signReceipt.mockResolvedValue('0xsig')
  mocks.triggerAgentEvent.mockResolvedValue(undefined)
  mocks.wrapWithCircuitBreaker.mockResolvedValue({ ok: true, json: async () => ({ output: 'ok' }) })
  mocks.calcPlatformOverhead.mockResolvedValue({
    overhead: 0.02, breakdown: { gas: 0.02 }, circuitBreaker: false, gas_source: 'env_fallback' as const,
  })
  mocks.rpc.mockResolvedValue({ data: null, error: null })
  wireSupabase()
})

describe('Route A — happy path debit', () => {
  it('debits via check_and_deduct_budget with creator+overhead total and returns 200', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null }) // check_and_deduct_budget

    const res = await POST(makeRequest('demo-agent'), makeParams('demo-agent'))

    expect(res.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('check_and_deduct_budget', {
      p_key_id: KEY_ROW.id,
      p_amount: 0.12,
    })
    expect(mocks.agentCallsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ payment_type: 'api_key', status: 'success' }),
    )
    const body = await res.json()
    expect(body.meta.charged).toBe(0.12)
    expect(mocks.redisDel).toHaveBeenCalledTimes(1)
  })

  it('check_and_deduct_budget false (race) → 402, no receipt, no charged logCall, mutex freed', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null })

    const res = await POST(makeRequest('demo-agent'), makeParams('demo-agent'))

    expect(res.status).toBe(402)
    expect((await res.json()).code).toBe('budget_exceeded')
    expect(mocks.signReceipt).not.toHaveBeenCalled()
    expect(mocks.agentCallsInsert).not.toHaveBeenCalled()
    expect(mocks.redisDel).toHaveBeenCalledTimes(1)
  })
})

describe('Route A — auth & scope rejections', () => {
  it('unknown/inactive agent key → 401 invalid_key, no charge', async () => {
    wireSupabase({ keyRow: null })

    const res = await POST(makeRequest('demo-agent'), makeParams('demo-agent'))

    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('invalid_key')
    expect(mocks.rpc).not.toHaveBeenCalledWith('check_and_deduct_budget', expect.anything())
  })

  it('empty scope (allowed_slugs=[]) → 403 agent_not_in_scope before any payment', async () => {
    wireSupabase({ keyRow: { ...KEY_ROW, allowed_slugs: [], allowed_categories: null } })

    const res = await POST(makeRequest('demo-agent'), makeParams('demo-agent'))

    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('agent_not_in_scope')
    expect(mocks.redisSet).not.toHaveBeenCalled()
    expect(mocks.wrapWithCircuitBreaker).not.toHaveBeenCalled()
  })

  it('agent out of declared scope → 403 (isAgentInScope=false)', async () => {
    wireSupabase({ keyRow: { ...KEY_ROW, allowed_slugs: ['other-agent'], allowed_categories: null } })
    mocks.isAgentInScope.mockReturnValue(false)

    const res = await POST(makeRequest('demo-agent'), makeParams('demo-agent'))

    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('agent_not_in_scope')
  })
})

describe('Route A — mutex / Redis', () => {
  it('mutex already held → 429 concurrent_invocation, no upstream, no charge', async () => {
    mocks.redisSet.mockResolvedValue(null) // NX set fails → lock held

    const res = await POST(makeRequest('demo-agent'), makeParams('demo-agent'))

    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe('concurrent_invocation')
    expect(mocks.wrapWithCircuitBreaker).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalledWith('check_and_deduct_budget', expect.anything())
    expect(mocks.redisDel).not.toHaveBeenCalled()
  })

  it('Redis down on mutex acquire → fail-closed 503 (no double-spend window)', async () => {
    mocks.redisSet.mockRejectedValue(new Error('ECONNREFUSED'))

    const res = await POST(makeRequest('demo-agent'), makeParams('demo-agent'))

    expect(res.status).toBe(503)
    expect(mocks.wrapWithCircuitBreaker).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalledWith('check_and_deduct_budget', expect.anything())
  })
})

describe('Route A — budget soft check & validation', () => {
  it('budget remaining < total → 402 budget_exceeded (soft check), upstream not called', async () => {
    wireSupabase({ keyRow: { ...KEY_ROW, budget_usdc: '0.05', spent_usdc: '0.0' } })

    const res = await POST(makeRequest('demo-agent'), makeParams('demo-agent'))

    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.code).toBe('budget_exceeded')
    expect(body.needed).toBe(0.12)
    expect(mocks.wrapWithCircuitBreaker).not.toHaveBeenCalled()
    expect(mocks.redisDel).toHaveBeenCalledTimes(1)
  })

  it('input schema validation failure → 422, no charge', async () => {
    wireSupabase({ keyRow: KEY_ROW, model: { ...ACTIVE_MODEL, input_schema: { type: 'object' } } })
    mocks.validateInput.mockReturnValue('q is required')

    const res = await POST(makeRequest('demo-agent'), makeParams('demo-agent'))

    expect(res.status).toBe(422)
    expect((await res.json()).code).toBe('input_invalid')
    expect(mocks.rpc).not.toHaveBeenCalledWith('check_and_deduct_budget', expect.anything())
    expect(mocks.redisDel).toHaveBeenCalledTimes(1)
  })
})

describe('Route A — agent / circuit-breaker availability', () => {
  it('paused agent (status != active) → 503 agent_unavailable', async () => {
    wireSupabase({ model: { ...ACTIVE_MODEL, status: 'paused' } })

    const res = await POST(makeRequest('demo-agent'), makeParams('demo-agent'))

    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('agent_unavailable')
  })

  it('circuit breaker open → 503 agent_circuit_open with Retry-After', async () => {
    mocks.getState.mockResolvedValue('open')

    const res = await POST(makeRequest('demo-agent'), makeParams('demo-agent'))

    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('agent_circuit_open')
    expect(res.headers.get('Retry-After')).toBe('30')
  })

  it('operational cost exceeds price (overhead circuitBreaker) → 503', async () => {
    mocks.calcPlatformOverhead.mockResolvedValue({
      overhead: 0.50, breakdown: { gas: 0.50 }, circuitBreaker: true, gas_source: 'env_fallback' as const,
    })

    const res = await POST(makeRequest('demo-agent'), makeParams('demo-agent'))

    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('operational_cost_exceeds_price')
  })

  it('unknown model → 404', async () => {
    wireSupabase({ model: null, modelError: { code: 'PGRST116' } })

    const res = await POST(makeRequest('nope'), makeParams('nope'))

    expect(res.status).toBe(404)
  })
})

describe('Route A — upstream failure still released mutex', () => {
  it('upstream 4xx → call logged as error, NOT charged, mutex released, 422 to caller', async () => {
    mocks.wrapWithCircuitBreaker.mockResolvedValue({
      ok: false, status: 400, json: async () => ({ msg: 'bad input' }),
    })

    const res = await POST(makeRequest('demo-agent'), makeParams('demo-agent'))

    expect(mocks.agentCallsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ payment_type: 'api_key', status: 'error' }),
    )
    expect(mocks.rpc).not.toHaveBeenCalledWith('check_and_deduct_budget', expect.anything())
    expect(mocks.redisDel).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(422)
  })
})
