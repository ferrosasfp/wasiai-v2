/**
 * BLQ-MED-1 regression — AC-6: when settlePaymentX402 returns
 * { verified: true, settled: false }, the invoke route MUST return HTTP 502
 * with body.code === 'settle_failed' BEFORE any upstream call / logCall /
 * pending-earnings increment runs. Otherwise the client receives service
 * without a confirmed on-chain payment.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── vi.hoisted: shared mocks usable inside vi.mock factories ─────────────────
const mocks = vi.hoisted(() => ({
  serviceFrom: vi.fn(),
  rpc:         vi.fn(),
  settlePaymentX402: vi.fn(),
  callUpstream:      vi.fn(),
  logCall:           vi.fn(),
  triggerAgentEvent: vi.fn(),
  redisDel:          vi.fn(),
  redisSet:          vi.fn(),
}))

// ── Module mocks (must precede route import) ─────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createClient:        vi.fn(),
  createServiceClient: vi.fn(() => ({
    from: mocks.serviceFrom,
    rpc:  mocks.rpc,
  })),
}))

vi.mock('@/lib/contracts/usdcSettler', async () => {
  const actual = await vi.importActual<typeof import('@/lib/contracts/usdcSettler')>(
    '@/lib/contracts/usdcSettler',
  )
  return {
    ...actual,
    settlePaymentX402: mocks.settlePaymentX402,
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/ratelimit', () => ({
  getInvokeLimit:          vi.fn(() => null),
  getIdentifier:           vi.fn(() => 'test-id'),
  checkRateLimit:          vi.fn(() => null),
  checkCreatorRateLimits:  vi.fn(() => null),
  getSharedRedis:          vi.fn(() => ({ del: mocks.redisDel, set: mocks.redisSet })),
}))

vi.mock('@/lib/circuit-breaker/CircuitBreaker', () => ({
  getState:                vi.fn(() => 'closed'),
  wrapWithCircuitBreaker:  vi.fn(),
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
  validateEndpointUrlAsync: vi.fn(() => true),
}))

vi.mock('@/lib/receipts/signReceipt', () => ({
  signReceipt: vi.fn(async () => '0xsig'),
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

// ── Import under test (after mocks) ──────────────────────────────────────────
import { POST } from '@/app/api/v1/models/[slug]/invoke/route'

// ── Fixtures ─────────────────────────────────────────────────────────────────
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

// Valid x402 EVM payload — only structural; settlePaymentX402 is mocked.
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
const xPaymentHeader = Buffer.from(JSON.stringify(x402Payload)).toString('base64')

// Chainable supabase query builder — returns the configured single() result.
function makeChain(result: unknown) {
  const chain = {} as Record<string, ReturnType<typeof vi.fn>>
  for (const m of ['select', 'eq', 'single', 'neq', 'in', 'update']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.single = vi.fn().mockResolvedValue(result)
  return chain
}

function makeRequest(slug: string) {
  return new NextRequest(`http://localhost/api/v1/models/${slug}/invoke`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PAYMENT':    xPaymentHeader,
      'x-request-id': 'req-test-1',
    },
    body: JSON.stringify({ input: { q: 'hello' } }),
  })
}

function makeParams(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

beforeEach(() => {
  vi.clearAllMocks()

  // Supabase: agents lookup returns ACTIVE_MODEL; agent_keys never queried (no x-agent-key).
  mocks.serviceFrom.mockImplementation((table: string) => {
    if (table === 'agents') {
      return makeChain({ data: ACTIVE_MODEL, error: null })
    }
    // logCall / agent_calls / settlement_failures fallback
    return makeChain({ data: null, error: null })
  })
})

describe('AC-6 / BLQ-MED-1: settle_failed → HTTP 502', () => {
  it('returns 502 + code=settle_failed when settlement.verified=true settled=false', async () => {
    mocks.settlePaymentX402.mockResolvedValueOnce({
      verified: true,
      settled:  false,
      error:    'SETTLE_TIMEOUT: facilitator did not respond',
    })

    const res = await POST(makeRequest('demo-agent'), makeParams('demo-agent'))

    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.code).toBe('settle_failed')
    expect(body.error).toBe('Payment settlement failed')
    // The reason field surfaces the canonical settler error so operators can debug.
    expect(typeof body.reason).toBe('string')

    // CRITICAL: upstream + bookkeeping MUST NOT have run when settle failed.
    // settle_failed must short-circuit BEFORE the "Payment valid" path.
    expect(mocks.triggerAgentEvent).not.toHaveBeenCalled()
    // No RPC call to increment_pending_earnings or check_and_deduct_budget.
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
