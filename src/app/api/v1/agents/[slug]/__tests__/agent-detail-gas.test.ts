/**
 * WAS-297 — GET /api/v1/agents/[slug] estimated_total_cost field
 * Tests gas overhead integration in agent detail response.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── vi.hoisted ────────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  supabaseFrom:          vi.fn(),
  supabaseRpc:           vi.fn(),
  getCachedGasOverhead:  vi.fn(),
  getMarketplaceAddress: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: mocks.supabaseFrom,
    rpc:  mocks.supabaseRpc,
  })),
  createServiceClient: vi.fn(() => ({
    from: mocks.supabaseFrom,
    rpc:  mocks.supabaseRpc,
  })),
}))

vi.mock('@/lib/pricing/overhead', () => ({
  getCachedGasOverhead: mocks.getCachedGasOverhead,
}))

vi.mock('@/lib/contracts/WasiAIMarketplace', () => ({
  getMarketplaceAddress: mocks.getMarketplaceAddress,
}))

vi.mock('@/lib/chain', () => ({
  CHAIN_ID:   43113,
  CHAIN_NAME: 'Avalanche Fuji',
}))

vi.mock('@/lib/constants', () => ({
  SITE_URL: 'http://localhost:3000',
}))

vi.mock('@/features/agents/utils/resolveExampleInput', () => ({
  resolveExampleInput: vi.fn(() => null),
}))

vi.mock('@/lib/security/validateEndpointUrl', () => ({
  validateEndpointUrlAsync: vi.fn(async () => ({ valid: true })),
}))

vi.mock('@/lib/schema-validator', () => ({
  metaValidateSchema: vi.fn(() => ({ valid: true })),
}))

vi.mock('@/features/agents/utils/buildExampleFromSchema', () => ({
  buildExampleFromSchema: vi.fn(() => null),
}))

// ── Import bajo test ──────────────────────────────────────────────────────────
import { GET } from '../route'

// ── Fixtures ──────────────────────────────────────────────────────────────────
const AGENT = {
  id:               'agent-uuid-001',
  slug:             'test-agent',
  name:             'Test Agent',
  description:      'A test agent',
  category:         'general',
  agent_type:       'api',
  status:           'active',
  price_per_call:   0.50,
  cover_image:      null,
  is_featured:      false,
  endpoint_url:     'https://example.com/api',
  mcp_tool_name:    'test_agent',
  capabilities:     null,
  input_schema:     null,
  output_schema:    null,
  total_calls:      100,
  total_revenue:    50,
  reputation_score: 4.5,
  reputation_count: 10,
  performance_score: 0.95,
  sandbox_enabled:  true,
  metadata:         null,
  created_at:       '2025-01-01T00:00:00Z',
  creator:          { id: 'creator-001', username: 'creator', display_name: 'Creator', avatar_url: null, verified: false },
}

// ── Chain builder ─────────────────────────────────────────────────────────────
function makeChain(result: unknown) {
  const chain = {} as Record<string, ReturnType<typeof vi.fn>>
  const methods = ['select', 'eq', 'single', 'neq']
  methods.forEach(m => { chain[m] = vi.fn().mockReturnValue(chain) })
  chain['single'] = vi.fn().mockResolvedValue(result)
  return chain
}

function makeRequest(slug: string) {
  return new NextRequest(`http://localhost/api/v1/agents/${slug}`)
}

function makeParams(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getMarketplaceAddress.mockReturnValue('0xMarketplace123')
})

function setupAgentQuery() {
  mocks.supabaseFrom.mockReturnValueOnce(makeChain({ data: AGENT, error: null }))
  // RPC metrics query
  mocks.supabaseRpc.mockReturnValueOnce({
    single: vi.fn().mockResolvedValue({
      data: { p50_latency_ms: 100, p95_latency_ms: 200, error_rate_7d: 0.01, error_rate_sample: 50 },
    }),
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('GET /api/v1/agents/[slug] — estimated_total_cost (WAS-297)', () => {

  it('1. estimated_total_cost present when cache exists', async () => {
    setupAgentQuery()
    mocks.getCachedGasOverhead.mockResolvedValueOnce({ overhead: 0.02, gas_source: 'redis' })

    const res = await GET(makeRequest('test-agent'), makeParams('test-agent'))
    expect(res.status).toBe(200)

    const body = await res.json()
    // price_per_call=0.50 + overhead=0.02 = 0.52
    expect(body.estimated_total_cost).toBe(0.52)
  })

  it('2. estimated_total_cost = null when cache misses', async () => {
    setupAgentQuery()
    mocks.getCachedGasOverhead.mockResolvedValueOnce(null)

    const res = await GET(makeRequest('test-agent'), makeParams('test-agent'))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.estimated_total_cost).toBeNull()
  })

  it('3. estimated_total_cost precision ≤6 decimals', async () => {
    const agentWithPrecisePrice = { ...AGENT, price_per_call: 0.123456 }
    mocks.supabaseFrom.mockReturnValueOnce(makeChain({ data: agentWithPrecisePrice, error: null }))
    mocks.supabaseRpc.mockReturnValueOnce({
      single: vi.fn().mockResolvedValue({ data: null }),
    })
    mocks.getCachedGasOverhead.mockResolvedValueOnce({ overhead: 0.000001, gas_source: 'chainlink' })

    const res = await GET(makeRequest('test-agent'), makeParams('test-agent'))
    expect(res.status).toBe(200)

    const body = await res.json()
    // 0.123456 + 0.000001 = 0.123457
    const value = body.estimated_total_cost as number
    expect(value).not.toBeNull()
    const decimals = (value.toString().split('.')[1] ?? '').length
    expect(decimals).toBeLessThanOrEqual(6)
  })

  it('4. estimated_total_cost = price + overhead (math check)', async () => {
    setupAgentQuery()
    mocks.getCachedGasOverhead.mockResolvedValueOnce({ overhead: 0.03, gas_source: 'coingecko' })

    const res = await GET(makeRequest('test-agent'), makeParams('test-agent'))
    const body = await res.json()
    expect(body.estimated_total_cost).toBeCloseTo(0.53, 6)
  })
})
