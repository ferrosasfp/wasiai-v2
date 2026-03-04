/**
 * Tests para POST /api/v1/agents/[slug]/invoke-agent
 * WAS-140: Pagos autónomos agente→agente
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// vi.hoisted
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  serviceClientFrom: vi.fn(),
  invokeAgentWithPayment: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({
    from: mocks.serviceClientFrom,
  })),
}))

// Mock agentWallet primero — evita fail-fast de AGENT_WALLET_ENCRYPTION_KEY
vi.mock('@/lib/agent-wallets/agentWallet', () => ({
  getAgentWalletClient:      vi.fn(),
  getAgentWalletAddress:     vi.fn(),
  getAgentWalletUsdcBalance: vi.fn(),
}))

// Mock agentPay: usa importActual (agentWallet ya mockeado, no hay fail-fast)
vi.mock('@/lib/agent-wallets/agentPay', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent-wallets/agentPay')>('@/lib/agent-wallets/agentPay')
  return {
    ...actual,
    invokeAgentWithPayment: mocks.invokeAgentWithPayment,
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// ---------------------------------------------------------------------------
// Import bajo test
// ---------------------------------------------------------------------------
import { POST } from '@/app/api/v1/agents/[slug]/invoke-agent/route'
import { AgentPayError } from '@/lib/agent-wallets/agentPay'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const VALID_KEY     = 'wai_test_key_123'
// KEY_HASH: reserved for future hash-verification tests
const CREATOR_ID    = 'creator-uuid-001'
const CALLER_AGENT  = { id: 'agent-uuid-001', slug: 'caller-agent', status: 'active', creator_id: CREATOR_ID }
const KEY_ROW       = { id: 'key-uuid-001', owner_id: CREATOR_ID, is_active: true }
const INVOKE_RESULT = {
  result: { output: 'respuesta del agente destino' },
  meta:   { model: 'target-agent', latency_ms: 120, charged: 0.01, currency: 'USDC', tx_hash: '0xabc', status: 'success' },
}

// ---------------------------------------------------------------------------
// Chainable query builder
// ---------------------------------------------------------------------------
function makeChain(result: unknown) {
  const chain = {} as Record<string, ReturnType<typeof vi.fn>>
  const methods = ['select', 'eq', 'single', 'neq', 'in']
  methods.forEach(m => { chain[m] = vi.fn().mockReturnValue(chain) })
  chain['single'] = vi.fn().mockResolvedValue(result)
  return chain
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------
function makeRequest(slug: string, body: unknown, key?: string) {
  return new NextRequest(`http://localhost/api/v1/agents/${slug}/invoke-agent`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'x-agent-key': key } : {}),
    },
    body: JSON.stringify(body),
  })
}

function makeParams(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks()
  mocks.invokeAgentWithPayment.mockResolvedValue(INVOKE_RESULT)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/v1/agents/[slug]/invoke-agent', () => {

  describe('Auth', () => {
    it('retorna 401 sin x-agent-key', async () => {
      const res = await POST(makeRequest('caller-agent', { targetSlug: 'target', input: 'hola' }), makeParams('caller-agent'))
      expect(res.status).toBe(401)
    })

    it('retorna 401 con key inválida', async () => {
      mocks.serviceClientFrom
        .mockReturnValueOnce(makeChain({ data: null, error: 'not found' }))

      const res = await POST(makeRequest('caller-agent', { targetSlug: 'target', input: 'hola' }, 'bad-key'), makeParams('caller-agent'))
      expect(res.status).toBe(401)
    })
  })

  describe('Ownership', () => {
    it('retorna 403 si la key no pertenece al creator del agente', async () => {
      mocks.serviceClientFrom
        .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))
        .mockReturnValueOnce(makeChain({ data: { ...CALLER_AGENT, creator_id: 'otro-creator' }, error: null }))

      const res = await POST(makeRequest('caller-agent', { targetSlug: 'target', input: 'hola' }, VALID_KEY), makeParams('caller-agent'))
      expect(res.status).toBe(403)
    })
  })

  describe('Validación body', () => {
    it('retorna 400 sin targetSlug', async () => {
      mocks.serviceClientFrom
        .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))
        .mockReturnValueOnce(makeChain({ data: CALLER_AGENT, error: null }))

      const res = await POST(makeRequest('caller-agent', { input: 'hola' }, VALID_KEY), makeParams('caller-agent'))
      expect(res.status).toBe(400)
    })

    it('retorna 400 si targetSlug === callerSlug (self-invocation)', async () => {
      mocks.serviceClientFrom
        .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))
        .mockReturnValueOnce(makeChain({ data: CALLER_AGENT, error: null }))

      const res = await POST(makeRequest('caller-agent', { targetSlug: 'caller-agent', input: 'hola' }, VALID_KEY), makeParams('caller-agent'))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('Agent cannot invoke itself')
    })
  })

  describe('AgentPayError mapping', () => {
    async function withPayError(code: AgentPayError['code'], body = { targetSlug: 'target', input: 'hola' }) {
      mocks.serviceClientFrom
        .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))
        .mockReturnValueOnce(makeChain({ data: CALLER_AGENT, error: null }))
      mocks.invokeAgentWithPayment.mockRejectedValueOnce(new AgentPayError(code, `error: ${code}`))
      return POST(makeRequest('caller-agent', body, VALID_KEY), makeParams('caller-agent'))
    }

    it('no_agent_wallet → 402', async () => {
      const res = await withPayError('no_agent_wallet')
      expect(res.status).toBe(402)
      expect((await res.json()).error).toBe('no_agent_wallet')
    })

    it('insufficient_balance → 402', async () => {
      const res = await withPayError('insufficient_balance')
      expect(res.status).toBe(402)
    })

    it('target_not_found → 404', async () => {
      const res = await withPayError('target_not_found')
      expect(res.status).toBe(404)
    })

    it('probe_failed → 502', async () => {
      const res = await withPayError('probe_failed')
      expect(res.status).toBe(502)
    })

    it('payment_failed → 502', async () => {
      const res = await withPayError('payment_failed')
      expect(res.status).toBe(502)
    })
  })

  describe('Éxito', () => {
    it('retorna 200 con result + meta cuando pago es exitoso', async () => {
      mocks.serviceClientFrom
        .mockReturnValueOnce(makeChain({ data: KEY_ROW, error: null }))
        .mockReturnValueOnce(makeChain({ data: CALLER_AGENT, error: null }))

      const res = await POST(
        makeRequest('caller-agent', { targetSlug: 'target-agent', input: 'procesa esto' }, VALID_KEY),
        makeParams('caller-agent'),
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.meta.tx_hash).toBe('0xabc')
      expect(body.meta.status).toBe('success')
    })
  })
})
