/**
 * Tests para WAS-295 — POST /api/v1/agents/[slug]/deposit-to-key
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── vi.hoisted ────────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  serviceClientFrom: vi.fn(),
  supabaseRpc:       vi.fn(),
  getAgentWalletClient:      vi.fn(),
  getAgentWalletAddress:     vi.fn(),
  getAgentWalletUsdcBalance: vi.fn(),
  depositForKeyOnChain:      vi.fn(),
  calcPlatformOverhead:      vi.fn(),
  rateLimitSuccess:          vi.fn(),
}))

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock agentWallet ANTES de cualquier import que lo use
vi.mock('@/lib/agent-wallets/agentWallet', () => ({
  getAgentWalletClient:      mocks.getAgentWalletClient,
  getAgentWalletAddress:     mocks.getAgentWalletAddress,
  getAgentWalletUsdcBalance: mocks.getAgentWalletUsdcBalance,
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({
    from: mocks.serviceClientFrom,
    rpc:  mocks.supabaseRpc,
  })),
}))

vi.mock('@/lib/contracts/marketplaceClient', () => ({
  depositForKeyOnChain: mocks.depositForKeyOnChain,
}))

vi.mock('@/lib/pricing/overhead', () => ({
  calcPlatformOverhead: mocks.calcPlatformOverhead,
}))

vi.mock('@/lib/ratelimit', () => ({
  getSharedRedis: vi.fn(() => ({
    get:  vi.fn(),
    set:  vi.fn(),
  })),
  getIdentifier:  vi.fn(() => '127.0.0.1'),
  checkRateLimit: vi.fn(() => null),
}))

vi.mock('@upstash/ratelimit', () => {
  const RatelimitMock = vi.fn().mockImplementation(() => ({
    limit: mocks.rateLimitSuccess,
  })) as unknown as { new(...args: unknown[]): unknown; slidingWindow: ReturnType<typeof vi.fn> }
  RatelimitMock.slidingWindow = vi.fn().mockReturnValue({ type: 'slidingWindow', tokens: 5, interval: '1 h' })
  return { Ratelimit: RatelimitMock }
})

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// ── Import bajo test ──────────────────────────────────────────────────────────
import { POST } from '../route'

// ── Fixtures ──────────────────────────────────────────────────────────────────
const VALID_KEY   = 'wai_test_key_deposit_abc123'
const KEY_ROW     = { id: 'key-uuid-001', owner_id: 'creator-uuid-001', key_hash: 'hash-abc', is_active: true }
const AGENT_ROW   = { id: 'agent-uuid-001', creator_id: 'creator-uuid-001' }
const WALLET_ADDR = '0xWalletAddress123' as `0x${string}`
const TX_HASH     = '0xTxHash123'

// ── Chain builder ─────────────────────────────────────────────────────────────
function makeChain(result: unknown) {
  const chain = {} as Record<string, ReturnType<typeof vi.fn>>
  const methods = ['select', 'eq', 'single', 'insert', 'update', 'upsert', 'neq', 'in']
  methods.forEach(m => { chain[m] = vi.fn().mockReturnValue(chain) })
  chain['single'] = vi.fn().mockResolvedValue(result)
  return chain
}

// Chainable that returns insert().select().single()
function makeInsertChain(result: unknown) {
  const chain = {} as Record<string, ReturnType<typeof vi.fn>>
  const methods = ['select', 'eq', 'single', 'insert', 'update', 'neq']
  methods.forEach(m => { chain[m] = vi.fn().mockReturnValue(chain) })
  chain['single'] = vi.fn().mockResolvedValue(result)
  return chain
}

// ── Request helper ────────────────────────────────────────────────────────────
function makeRequest(slug: string, body: Record<string, unknown>, agentKey?: string) {
  const req = new NextRequest(`http://localhost/api/v1/agents/${slug}/deposit-to-key`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(agentKey ? { 'x-agent-key': agentKey } : {}),
    },
    body: JSON.stringify(body),
  })
  return req
}

function makeParams(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

// ── Setup ─────────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks()
  // Default happy-path mocks
  mocks.rateLimitSuccess.mockResolvedValue({ success: true })
  mocks.calcPlatformOverhead.mockResolvedValue({ overhead: 0.001, breakdown: { gas: 0.001 }, circuitBreaker: false, cached: false, gas_source: 'chainlink' })
  mocks.getAgentWalletAddress.mockResolvedValue(WALLET_ADDR)
  mocks.getAgentWalletUsdcBalance.mockResolvedValue({ balanceUsdc: BigInt(10_000_000) }) // 10 USDC
  mocks.depositForKeyOnChain.mockResolvedValue(TX_HASH)
  mocks.getAgentWalletClient.mockResolvedValue({
    signTypedData: vi.fn().mockResolvedValue('0x' + 'aa'.repeat(65)),
  })
  mocks.supabaseRpc.mockResolvedValue({ error: null })

  // Default DB chains (agent_keys → agent → deposit insert → update → updatedKey)
  mocks.serviceClientFrom
    .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))        // agent_keys lookup
    .mockReturnValueOnce(makeChain({ data: AGENT_ROW, error: null }))      // agents lookup
    .mockReturnValueOnce(makeInsertChain({ data: { id: 'deposit-001' }, error: null }))  // agent_deposits insert
    .mockReturnValueOnce(makeChain({ data: null, error: null }))            // update failed status (not called in success)
    .mockReturnValueOnce(makeChain({ data: { budget_usdc: 10.001 }, error: null })) // updatedKey
})

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('POST /api/v1/agents/[slug]/deposit-to-key', () => {

  describe('Auth', () => {
    it('retorna 401 sin x-agent-key', async () => {
      const res = await POST(makeRequest('test-agent', { amount_usdc: 1 }), makeParams('test-agent'))
      expect(res.status).toBe(401)
    })

    it('retorna 401 con key inválida (no encontrada en DB)', async () => {
      mocks.rateLimitSuccess.mockResolvedValueOnce({ success: true })
      mocks.serviceClientFrom.mockReset()
      mocks.serviceClientFrom
        .mockReturnValueOnce(makeChain({ data: null, error: 'not found' }))  // agent_keys miss

      const res = await POST(makeRequest('test-agent', { amount_usdc: 1 }, 'bad-key'), makeParams('test-agent'))
      expect(res.status).toBe(401)
    })
  })

  describe('Ownership', () => {
    it('retorna 403 si la key no pertenece al creator del agente', async () => {
      mocks.serviceClientFrom.mockReset()
      mocks.serviceClientFrom
        .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))
        .mockReturnValueOnce(makeChain({ data: { ...AGENT_ROW, creator_id: 'otro-creator' }, error: null }))

      const res = await POST(makeRequest('test-agent', { amount_usdc: 1 }, VALID_KEY), makeParams('test-agent'))
      expect(res.status).toBe(403)
    })
  })

  describe('Wallet', () => {
    it('retorna 409 si wallet no está inicializado', async () => {
      mocks.serviceClientFrom.mockReset()
      mocks.serviceClientFrom
        .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))
        .mockReturnValueOnce(makeChain({ data: AGENT_ROW, error: null }))
      mocks.getAgentWalletAddress.mockResolvedValueOnce(null)

      const res = await POST(makeRequest('test-agent', { amount_usdc: 1 }, VALID_KEY), makeParams('test-agent'))
      expect(res.status).toBe(409)
    })
  })

  describe('Balance', () => {
    it('retorna 402 si balance insuficiente con breakdown', async () => {
      mocks.serviceClientFrom.mockReset()
      mocks.serviceClientFrom
        .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))
        .mockReturnValueOnce(makeChain({ data: AGENT_ROW, error: null }))
      mocks.getAgentWalletUsdcBalance.mockResolvedValueOnce({ balanceUsdc: BigInt(500_000) }) // 0.5 USDC

      const res = await POST(makeRequest('test-agent', { amount_usdc: 5 }, VALID_KEY), makeParams('test-agent'))
      expect(res.status).toBe(402)
      const body = await res.json()
      expect(body.error).toBe('insufficient_balance')
      expect(body).toHaveProperty('breakdown')
    })
  })

  describe('Rate limit', () => {
    it('retorna 429 cuando rate limit excedido', async () => {
      mocks.rateLimitSuccess.mockResolvedValueOnce({ success: false })

      const res = await POST(makeRequest('test-agent', { amount_usdc: 1 }, VALID_KEY), makeParams('test-agent'))
      expect(res.status).toBe(429)
    })
  })

  describe('Contract', () => {
    it('retorna 503 si depositForKeyOnChain retorna null (contrato no configurado)', async () => {
      mocks.depositForKeyOnChain.mockResolvedValueOnce(null)

      const res = await POST(makeRequest('test-agent', { amount_usdc: 1 }, VALID_KEY), makeParams('test-agent'))
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.error).toBe('contract_not_configured')
    })

    it('retorna 500 si depositForKeyOnChain lanza excepción', async () => {
      mocks.depositForKeyOnChain.mockRejectedValueOnce(new Error('blockchain error'))

      const res = await POST(makeRequest('test-agent', { amount_usdc: 1 }, VALID_KEY), makeParams('test-agent'))
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error).toBe('deposit_failed')
    })
  })

  describe('Validación body', () => {
    it('retorna 400 si amount_usdc > MAX_SELF_DEPOSIT', async () => {
      // Route validates body AFTER key auth — need valid key chain
      mocks.serviceClientFrom.mockReset()
      mocks.serviceClientFrom
        .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))    // agent_keys
        .mockReturnValueOnce(makeChain({ data: AGENT_ROW, error: null }))  // agents (may not be reached)

      // MAX_SELF_DEPOSIT default = 1000, send 9999
      const res = await POST(makeRequest('test-agent', { amount_usdc: 9999 }, VALID_KEY), makeParams('test-agent'))
      expect(res.status).toBe(400)
    })
  })

  describe('Éxito', () => {
    it('retorna 200 con tx_hash, deposited_usdc, gas_fee_usdc en happy path', async () => {
      const res = await POST(makeRequest('test-agent', { amount_usdc: 1 }, VALID_KEY), makeParams('test-agent'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.tx_hash).toBe(TX_HASH)
      expect(body.deposited_usdc).toBe(1)
      expect(body).toHaveProperty('gas_fee_usdc')
      expect(body).toHaveProperty('total_debited_usdc')
      expect(body).toHaveProperty('new_budget_usdc')
    })
  })
})
