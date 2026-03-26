/**
 * WAS-297 — GET /api/v1/agent-keys/me — current_gas_fee_usdc field
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── vi.hoisted ────────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  supabaseFrom:         vi.fn(),
  getCachedGasOverhead: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({
    from: mocks.supabaseFrom,
  })),
}))

vi.mock('@/lib/pricing/overhead', () => ({
  getCachedGasOverhead: mocks.getCachedGasOverhead,
}))

// ── Import bajo test ──────────────────────────────────────────────────────────
import { GET } from '../me/route'

// ── Fixtures ──────────────────────────────────────────────────────────────────
const VALID_KEY = 'wai_test_key_me_abc123'
const KEY_ROW = {
  id:                 'key-uuid-001',
  name:               'My Agent Key',
  budget_usdc:        10,
  spent_usdc:         2.5,
  is_active:          true,
  last_used_at:       '2025-01-01T00:00:00Z',
  created_at:         '2024-01-01T00:00:00Z',
  erc8004_identity:   null,
  allowed_slugs:      null,
  allowed_categories: null,
}

// ── Chain builder ─────────────────────────────────────────────────────────────
function makeChain(result: unknown) {
  const chain = {} as Record<string, ReturnType<typeof vi.fn>>
  const methods = ['select', 'eq', 'single']
  methods.forEach(m => { chain[m] = vi.fn().mockReturnValue(chain) })
  chain['single'] = vi.fn().mockResolvedValue(result)
  return chain
}

function makeRequest(key?: string) {
  return new NextRequest('http://localhost/api/v1/agent-keys/me', {
    headers: key ? { 'x-agent-key': key } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('GET /api/v1/agent-keys/me — current_gas_fee_usdc (WAS-297)', () => {

  it('1. current_gas_fee_usdc present when cache exists', async () => {
    mocks.supabaseFrom.mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))
    mocks.getCachedGasOverhead.mockResolvedValueOnce({ overhead: 0.015, gas_source: 'redis' })

    const res = await GET(makeRequest(VALID_KEY))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.current_gas_fee_usdc).toBe(0.015)
  })

  it('2. current_gas_fee_usdc = null when cache misses', async () => {
    mocks.supabaseFrom.mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))
    mocks.getCachedGasOverhead.mockResolvedValueOnce(null)

    const res = await GET(makeRequest(VALID_KEY))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.current_gas_fee_usdc).toBeNull()
  })

  it('3. Existing fields still present in response', async () => {
    mocks.supabaseFrom.mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))
    mocks.getCachedGasOverhead.mockResolvedValueOnce({ overhead: 0.01, gas_source: 'chainlink' })

    const res = await GET(makeRequest(VALID_KEY))
    const body = await res.json()

    expect(body).toHaveProperty('remaining_usdc')
    expect(body).toHaveProperty('budget_usdc')
    expect(body).toHaveProperty('spent_usdc')
    expect(body).toHaveProperty('is_active')
    expect(body).toHaveProperty('usage_pct')
    expect(body).toHaveProperty('status')
    expect(body).toHaveProperty('name')
  })

  it('4. remaining_usdc is computed correctly', async () => {
    mocks.supabaseFrom.mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))
    mocks.getCachedGasOverhead.mockResolvedValueOnce(null)

    const res = await GET(makeRequest(VALID_KEY))
    const body = await res.json()

    // budget=10 - spent=2.5 = 7.5
    expect(body.remaining_usdc).toBe(7.5)
    expect(body.usage_pct).toBe(25) // 2.5/10 * 100 = 25
  })

  it('5. 401 when no x-agent-key header', async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('6. 404 when key not found', async () => {
    mocks.supabaseFrom.mockReturnValueOnce(makeChain({ data: null, error: null }))

    const res = await GET(makeRequest(VALID_KEY))
    expect(res.status).toBe(404)
  })

  it('7. current_gas_fee_usdc = 0 when cache returns 0 (valid value)', async () => {
    mocks.supabaseFrom.mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))
    mocks.getCachedGasOverhead.mockResolvedValueOnce({ overhead: 0, gas_source: 'redis' })

    const res = await GET(makeRequest(VALID_KEY))
    const body = await res.json()

    // gasCache?.overhead ?? null → 0 (not null)
    expect(body.current_gas_fee_usdc).toBe(0)
  })
})
