/**
 * V2 (audit 2026-06-25) — Route A: orden del débito en handleInvoke
 *
 * Antes el orden era logCall → signReceipt → check_and_deduct_budget, y si el
 * débito devolvía `false` (budget drenado por concurrencia) la request seguía
 * devolviendo 200 con receipt firmado de un cobro que NUNCA ocurrió.
 *
 * Nuevo contrato:
 *   - check_and_deduct_budget corre ANTES de logCall/signReceipt/buildResponse.
 *   - deduct truthy → 200, se firma receipt, se loguea la call cobrada.
 *   - deduct false  → 402, SIN signReceipt, SIN logCall de cobro.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  serviceFrom:           vi.fn(),
  rpc:                   vi.fn(),
  agentCallsInsert:      vi.fn(),
  signReceipt:           vi.fn(),
  triggerAgentEvent:     vi.fn(),
  redisDel:              vi.fn(),
  redisSet:              vi.fn(),
  wrapWithCircuitBreaker: vi.fn(),
}))

// next/server: preservar NextRequest/NextResponse, stubbear `after`
// (fuera de un request context real `after` lanza).
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: vi.fn() }
})

vi.mock('@/lib/supabase/server', () => ({
  createClient:        vi.fn(),
  createServiceClient: vi.fn(() => ({
    from: mocks.serviceFrom,
    rpc:  mocks.rpc,
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/ratelimit', () => ({
  getInvokeLimit:          vi.fn(() => null),
  getIdentifier:           vi.fn(() => 'test-id'),
  checkRateLimit:          vi.fn(() => null),
  checkCreatorRateLimits:  vi.fn(() => null),
  // Mutex: set → acquired (truthy), del → release
  getSharedRedis:          vi.fn(() => ({ del: mocks.redisDel, set: mocks.redisSet })),
}))

vi.mock('@/lib/circuit-breaker/CircuitBreaker', () => ({
  getState:                vi.fn(() => 'closed'),
  wrapWithCircuitBreaker:  mocks.wrapWithCircuitBreaker,
}))

vi.mock('@/lib/circuit-breaker/retryWithBackoff', () => ({
  retryWithBackoff: vi.fn(),
}))

vi.mock('@/lib/pricing/overhead', () => ({
  calcPlatformOverhead: vi.fn(async () => ({
    overhead:        0.02,
    breakdown:       { gas: 0.02 },
    circuitBreaker:  false,
    gas_source:      'env_fallback' as const,
  })),
}))

vi.mock('@/lib/webhooks/triggerAgentEvent', () => ({
  triggerAgentEvent: mocks.triggerAgentEvent,
}))

vi.mock('@/lib/security/validateEndpointUrl', () => ({
  validateEndpointUrlAsync: vi.fn(async () => true),
}))

vi.mock('@/lib/receipts/signReceipt', () => ({
  signReceipt: mocks.signReceipt,
}))

vi.mock('@/lib/contracts/marketplaceClient', () => ({
  keyHashToBytes32: vi.fn(() => '0x' + '0'.repeat(64)),
}))

vi.mock('@/lib/chain', () => ({
  CHAIN_NAME: 'avalanche-testnet',
  IS_MAINNET: false,
}))

vi.mock('@/lib/constants', () => ({
  SITE_URL: 'http://localhost:3000',
}))

vi.mock('@/lib/scope-check', () => ({
  isAgentInScope: vi.fn(() => true),
}))

vi.mock('@/lib/schema-validator', () => ({
  validateInput: vi.fn(() => null),
}))

vi.mock('@/lib/validation/payment-type', () => ({
  assertPaymentType: vi.fn(),
}))

import { POST } from '@/app/api/v1/models/[slug]/invoke/route'

const ACTIVE_MODEL = {
  id:                  'model-uuid',
  slug:                'demo-agent',
  name:                'Demo Agent',
  status:              'active',
  endpoint_url:        'https://example.com/invoke',
  webhook_secret:      null,
  price_per_call:      0.10,
  creator_id:          'creator-uuid',
  category:            'data',
  input_schema:        null,
  max_rpd:             1000,
  max_rpm:             60,
  free_trial_enabled:  false,
  free_trial_limit:    0,
  sandbox_enabled:     false,
  metadata:            null,
  capabilities:        [],
}

// Agent key con budget suficiente (soft check pasa)
const KEY_ROW = {
  id:                 'key-uuid-001',
  owner_id:           'creator-uuid',
  is_active:          true,
  key_hash:           'abc123def456',
  budget_usdc:        '10.0',
  spent_usdc:         '0.0',
  allowed_slugs:      null,
  allowed_categories: null,
}

const AGENT_KEY = 'wai_test_key_abcdefghijklmnopqrstuvwxyz012345'

function makeChain(result: unknown) {
  const chain = {} as Record<string, ReturnType<typeof vi.fn>>
  for (const m of ['select', 'eq', 'single', 'neq', 'in', 'update', 'insert']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.single = vi.fn().mockResolvedValue(result)
  return chain
}

// agent_calls chain — el insert() es espiable; .select('id').single() devuelve un id
function makeAgentCallsChain() {
  const chain = {} as Record<string, ReturnType<typeof vi.fn>>
  chain.insert = mocks.agentCallsInsert.mockReturnValue(chain)
  chain.select = vi.fn().mockReturnValue(chain)
  chain.update = vi.fn().mockReturnValue(chain)
  chain.eq     = vi.fn().mockReturnValue(chain)
  chain.single = vi.fn().mockResolvedValue({ data: { id: 'call-uuid-1' }, error: null })
  return chain
}

function makeRequest(slug: string) {
  return new NextRequest(`http://localhost/api/v1/models/${slug}/invoke`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-agent-key':  AGENT_KEY,
    },
    body: JSON.stringify({ input: { q: 'hello' } }),
  })
}

function makeParams(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

beforeEach(() => {
  vi.clearAllMocks()

  // Mutex acquired
  mocks.redisSet.mockResolvedValue('OK')
  mocks.redisDel.mockResolvedValue(1)

  // Upstream success — bypass fetch via circuit breaker mock
  mocks.wrapWithCircuitBreaker.mockResolvedValue({
    ok:   true,
    json: async () => ({ output: 'ok' }),
  })

  mocks.signReceipt.mockResolvedValue('0xsignature')
  // triggerAgentEvent se invoca como `void trigger(...).catch(...)` → debe devolver promesa
  mocks.triggerAgentEvent.mockResolvedValue(undefined)
  // rpc por defecto resuelve OK (increment_agent_stats, etc.); check_and_deduct_budget
  // se configura por test con mockResolvedValueOnce ANTES del default.
  mocks.rpc.mockResolvedValue({ data: null, error: null })

  mocks.serviceFrom.mockImplementation((table: string) => {
    if (table === 'agents')      return makeChain({ data: ACTIVE_MODEL, error: null })
    if (table === 'agent_keys')  return makeChain({ data: KEY_ROW, error: null })
    if (table === 'agent_calls') return makeAgentCallsChain()
    return makeChain({ data: null, error: null })
  })
})

describe('V2 — Route A: check_and_deduct_budget orden', () => {
  it('budget OK + deduct truthy → 200, cobra, firma receipt y loguea la call', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null })

    const res = await POST(makeRequest('demo-agent'), makeParams('demo-agent'))

    expect(res.status).toBe(200)
    // débito ocurrió
    expect(mocks.rpc).toHaveBeenCalledWith('check_and_deduct_budget', expect.objectContaining({
      p_key_id: KEY_ROW.id,
    }))
    // receipt firmado + call logueada (cobro confirmado)
    expect(mocks.signReceipt).toHaveBeenCalledTimes(1)
    expect(mocks.agentCallsInsert).toHaveBeenCalledTimes(1)
    expect(mocks.agentCallsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ payment_type: 'api_key', status: 'success' }),
    )
  })

  it('deduct false (budget drenado por concurrencia) → 402, SIN signReceipt, SIN logCall de cobro', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null })

    const res = await POST(makeRequest('demo-agent'), makeParams('demo-agent'))

    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.code).toBe('budget_exceeded')

    // débito intentado pero devolvió false → NO se firma receipt ni se loguea cobro
    expect(mocks.rpc).toHaveBeenCalledWith('check_and_deduct_budget', expect.objectContaining({
      p_key_id: KEY_ROW.id,
    }))
    expect(mocks.signReceipt).not.toHaveBeenCalled()
    expect(mocks.agentCallsInsert).not.toHaveBeenCalled()

    // mutex liberado (V11 finally) pese al early-return
    expect(mocks.redisDel).toHaveBeenCalledTimes(1)
  })

  it('V11: el mutex se libera (del) también en el happy path', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null })
    await POST(makeRequest('demo-agent'), makeParams('demo-agent'))
    expect(mocks.redisDel).toHaveBeenCalledTimes(1)
  })
})
