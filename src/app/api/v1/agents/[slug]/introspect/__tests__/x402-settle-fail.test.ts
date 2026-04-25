/**
 * BLQ-MED-1 regression — AC-6: when settlePaymentX402 returns
 * { verified: true, settled: false }, the introspect route MUST return HTTP 502
 * with body.code === 'settle_failed' BEFORE callUpstreamIntrospect / logCall
 * run. Otherwise the client receives the COB without a confirmed on-chain
 * payment.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  serviceFrom:       vi.fn(),
  rpc:               vi.fn(),
  settlePaymentX402: vi.fn(),
  buildCOB:          vi.fn(),
}))

// ── Module mocks (must precede route import) ─────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
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
  getInvokeLimit: vi.fn(() => null),
  getIdentifier:  vi.fn(() => 'test-id'),
  checkRateLimit: vi.fn(() => null),
}))

vi.mock('@/lib/introspect/buildCOB', () => ({
  buildCOB: mocks.buildCOB,
}))

vi.mock('@/lib/security/validateEndpointUrl', () => ({
  validateEndpointUrlAsync: vi.fn(() => true),
}))

vi.mock('@/lib/validation/payment-type', () => ({
  assertPaymentType: vi.fn(),
}))

vi.mock('@/lib/constants', () => ({
  SITE_URL: 'http://localhost:3000',
}))

// ── Import under test (after mocks) ──────────────────────────────────────────
import { POST } from '@/app/api/v1/agents/[slug]/introspect/route'

// ── Fixtures ─────────────────────────────────────────────────────────────────
const ACTIVE_AGENT = {
  id:                  'agent-uuid',
  slug:                'demo-agent',
  name:                'Demo Agent',
  status:              'active',
  price_per_call:      0.10,
  endpoint_url:        'https://example.com/introspect',
  webhook_secret:      null,
  on_chain_registered: false,
  creator_wallet:      null,
}

const x402Payload = {
  x402Version: 1,
  scheme:      'exact',
  network:     'avalanche-testnet',
  payload: {
    signature: '0x' + 'a'.repeat(130),
    authorization: {
      from:        '0x' + '1'.repeat(40),
      to:          '0x' + '2'.repeat(40),
      value:       '100000',
      validAfter:  '0',
      validBefore: '9999999999',
      nonce:       '0x' + '0'.repeat(64),
    },
  },
}
const xPaymentHeader = Buffer.from(JSON.stringify(x402Payload)).toString('base64')

function makeChain(result: unknown) {
  const chain = {} as Record<string, ReturnType<typeof vi.fn>>
  for (const m of ['select', 'eq', 'single', 'neq', 'in', 'update', 'insert']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.single = vi.fn().mockResolvedValue(result)
  return chain
}

function makeRequest(slug: string) {
  return new NextRequest(`http://localhost/api/v1/agents/${slug}/introspect`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PAYMENT':    xPaymentHeader,
      'x-request-id': 'req-introspect-1',
    },
    body: JSON.stringify({
      runtime: 'node',
      target:  'main',
      depth:   'shallow',
    }),
  })
}

function makeParams(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

beforeEach(() => {
  vi.clearAllMocks()

  mocks.serviceFrom.mockImplementation((table: string) => {
    if (table === 'agents') {
      return makeChain({ data: ACTIVE_AGENT, error: null })
    }
    return makeChain({ data: null, error: null })
  })
})

describe('AC-6 / BLQ-MED-1: settle_failed → HTTP 502 (introspect)', () => {
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
    expect(typeof body.reason).toBe('string')

    // CRITICAL: COB must NOT be built when settlement failed —
    // settle_failed must short-circuit BEFORE the upstream/COB path.
    expect(mocks.buildCOB).not.toHaveBeenCalled()
  })
})
