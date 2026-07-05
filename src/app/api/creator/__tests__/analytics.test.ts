/**
 * Tests para GET /api/creator/analytics
 * HU-1.4: Creator Analytics
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// vi.hoisted
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getUser:         vi.fn(),
  readContract:    vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mocks de módulos
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({ auth: { getUser: mocks.getUser } }),
  ),
  createServiceClient: vi.fn(() => ({ from: mockSvcFrom })),
}))

vi.mock('@/shared/lib/web3/client', () => ({
  getPublicClient: vi.fn(() => ({
    readContract: mocks.readContract,
  })),
}))

vi.mock('@/lib/contracts/WasiAIMarketplace', () => ({
  WASIAI_MARKETPLACE_ABI: [],
}))

vi.mock('viem', () => ({
  formatUnits: vi.fn((val: bigint, decimals: number) =>
    (Number(val) / 10 ** decimals).toFixed(6),
  ),
}))

// ---------------------------------------------------------------------------
// Supabase service mock
// ---------------------------------------------------------------------------

const mockSvcFrom = vi.fn()

// ---------------------------------------------------------------------------
// Import bajo test
// ---------------------------------------------------------------------------

import { GET } from '@/app/api/creator/analytics/route'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const TEST_USER = { id: 'user-creator-1' }

const PROFILE = {
  id:                     TEST_USER.id,
  wallet_address:         '0xabc123',
}

const PROFILE_NO_WALLET = {
  ...PROFILE,
  wallet_address: null,
}

// WKH-SEC-03: pending_earnings_usdc now comes from creator_earnings (2nd query).
const EARNINGS = {
  pending_earnings_usdc: '12.50',
}

const AGENT_1 = { id: 'agent-1', name: 'Agente Uno' }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/creator/analytics')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url.toString(), { method: 'GET' })
}

/**
 * Chain thenable: cualquier secuencia de métodos encadenados puede ser
 * await-ada directamente (no requiere .single() al final).
 * Cuando se llama .single() también resuelve a resolveWith.
 */
function makeChain(resolveWith: unknown) {
  const chain: Record<string, unknown> = {}

  // Hace el chain thenable (await directo funciona)
  chain['then'] = (
    onFulfilled: (v: unknown) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => Promise.resolve(resolveWith).then(onFulfilled, onRejected)
  chain['catch'] = (onRejected: (e: unknown) => unknown) =>
    Promise.resolve(resolveWith).catch(onRejected)
  chain['finally'] = (fn: () => void) =>
    Promise.resolve(resolveWith).finally(fn)

  const methods = [
    'select', 'eq', 'neq', 'gte', 'lte', 'gt', 'lt', 'in', 'is',
    'order', 'limit', 'range', 'insert', 'update', 'upsert', 'delete',
    'match', 'filter', 'not', 'or', 'and', 'maybeSingle', 'ilike',
  ]
  methods.forEach(m => {
    chain[m] = vi.fn().mockReturnValue(chain)
  })

  // single() también resuelve
  chain['single'] = vi.fn().mockResolvedValue(resolveWith)

  return chain
}

/** Configura el builder para el caso de "sin agentes activos" */
function setupEmptyAgentsMock(profileOverride?: Record<string, unknown>) {
  const profile = profileOverride ?? PROFILE
  mockSvcFrom
    .mockReturnValueOnce(makeChain({ data: profile,  error: null }))  // creator_profiles
    .mockReturnValueOnce(makeChain({ data: EARNINGS, error: null }))  // creator_earnings (WKH-SEC-03)
    .mockReturnValueOnce(makeChain({ data: [],       error: null }))  // agents (vacío)
}

/**
 * Configura el builder para el caso con un agente activo.
 * 6 queries paralelas en Promise.all + 3 queries por agente en el loop.
 */
function setupOneAgentMock(options: {
  profile?: Record<string, unknown>
  agents?: { id: string; name: string }[]
  totalCalls?: number
  calls24h?: number
  latencyData?: { latency_ms: number | null }[]
  last100?: { status: string }[]
  errors24h?: number
  rawSeries?: { called_at: string }[]
  agentCalls24h?: number
  agentErrors24h?: number
  agentCalls7d?: number
} = {}) {
  const {
    profile = PROFILE,
    agents = [AGENT_1],
    totalCalls = 42,
    calls24h = 10,
    latencyData = [{ latency_ms: 200 }, { latency_ms: 300 }],
    last100 = [{ status: 'success' }, { status: 'success' }, { status: 'error' }],
    errors24h = 1,
    rawSeries = [],
    agentCalls24h = 10,
    agentErrors24h = 1,
    agentCalls7d = 25,
  } = options

  mockSvcFrom
    // 1. creator_profiles
    .mockReturnValueOnce(makeChain({ data: profile, error: null }))
    // 1b. creator_earnings (WKH-SEC-03 — pending_earnings_usdc self-read)
    .mockReturnValueOnce(makeChain({ data: EARNINGS, error: null }))
    // 2. agents
    .mockReturnValueOnce(makeChain({ data: agents, error: null }))
    // ── Promise.all (6 queries) ──────────────────────────────────────────
    // 3. totalCalls count
    .mockReturnValueOnce(makeChain({ count: totalCalls, data: null, error: null }))
    // 4. calls24h count
    .mockReturnValueOnce(makeChain({ count: calls24h, data: null, error: null }))
    // 5. latency data
    .mockReturnValueOnce(makeChain({ data: latencyData, error: null }))
    // 6. last100 status
    .mockReturnValueOnce(makeChain({ data: last100, error: null }))
    // 7. errors24h count
    .mockReturnValueOnce(makeChain({ count: errors24h, data: null, error: null }))
    // 8. rawSeries (called_at last 30d)
    .mockReturnValueOnce(makeChain({ data: rawSeries, error: null }))
    // ── Per-agent loop (3 queries por agente) ───────────────────────────
    // 9. agentCalls24h
    .mockReturnValueOnce(makeChain({ count: agentCalls24h, data: null, error: null }))
    // 10. agentErrors24h
    .mockReturnValueOnce(makeChain({ count: agentErrors24h, data: null, error: null }))
    // 11. agentCalls7d
    .mockReturnValueOnce(makeChain({ count: agentCalls7d, data: null, error: null }))
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  // Limpiar la cola de mockReturnValueOnce (no lo hace clearAllMocks)
  mockSvcFrom.mockReset()

  mocks.getUser.mockResolvedValue({ data: { user: TEST_USER } })
  mocks.readContract.mockResolvedValue(BigInt('5000000')) // 5 USDC
  process.env.MARKETPLACE_ADDRESS = '0xMarketplace'
})

// ===========================================================================
// Tests
// ===========================================================================

describe('GET /api/creator/analytics', () => {
  // =========================================================================
  // Auth
  // =========================================================================
  it('retorna 401 si no hay sesión', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } })

    const res = await GET(makeRequest())

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'unauthorized' })
  })

  // =========================================================================
  // Validación de params
  // =========================================================================
  it('retorna 400 si agent_id no es un UUID válido', async () => {
    const res = await GET(makeRequest({ agent_id: 'no-es-uuid' }))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'invalid_params' })
  })

  it('acepta requests sin agent_id (opcional)', async () => {
    setupEmptyAgentsMock()

    const res = await GET(makeRequest())

    expect(res.status).not.toBe(400)
  })

  // =========================================================================
  // Profile no encontrado
  // =========================================================================
  it('retorna 404 si el profile del creator no existe', async () => {
    mockSvcFrom.mockReturnValueOnce(makeChain({ data: null, error: null })) // creator_profiles

    const res = await GET(makeRequest())

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'profile_not_found' })
  })

  // =========================================================================
  // Sin agentes activos
  // =========================================================================
  it('retorna summary.totalCalls: 0 y dailySeries de 30 días cuando no hay agentes', async () => {
    setupEmptyAgentsMock()

    const res = await GET(makeRequest())

    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.summary.totalCalls).toBe(0)
    expect(body.summary.calls24h).toBe(0)
    expect(body.alerts).toEqual([])
  })

  it('dailySeries tiene exactamente 30 entradas cuando no hay agentes', async () => {
    setupEmptyAgentsMock()

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.dailySeries).toHaveLength(30)
  })

  it('todos los días en dailySeries tienen calls: 0 cuando no hay agentes', async () => {
    setupEmptyAgentsMock()

    const res = await GET(makeRequest())
    const body = await res.json()

    for (const entry of body.dailySeries) {
      expect(entry.calls).toBe(0)
      expect(typeof entry.date).toBe('string')
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  // =========================================================================
  // 403 — agent_id de otro creator
  // =========================================================================
  it('retorna 403 si agent_id no pertenece al creator autenticado', async () => {
    // El creator tiene AGENT_1, pero se pide un agent distinto
    mockSvcFrom
      .mockReturnValueOnce(makeChain({ data: PROFILE, error: null }))    // creator_profiles
      .mockReturnValueOnce(makeChain({ data: EARNINGS, error: null }))   // creator_earnings (WKH-SEC-03)
      .mockReturnValueOnce(makeChain({ data: [AGENT_1], error: null }))  // agents del creator

    const otherAgentId = '550e8400-e29b-41d4-a716-446655440099'
    const res = await GET(makeRequest({ agent_id: otherAgentId }))

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'forbidden' })
  })

  // =========================================================================
  // summary.pendingEarningsUsdc
  // =========================================================================
  it('incluye summary.pendingEarningsUsdc desde el profile', async () => {
    setupOneAgentMock({ profile: PROFILE })

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.summary.pendingEarningsUsdc).toBe('12.50')
  })

  // =========================================================================
  // onchainEarningsUsdc = null cuando wallet_address es null
  // =========================================================================
  it('retorna onchainEarningsUsdc: null cuando wallet_address es null', async () => {
    setupOneAgentMock({ profile: PROFILE_NO_WALLET })

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.summary.onchainEarningsUsdc).toBeNull()
    // readContract NO debe haber sido llamado
    expect(mocks.readContract).not.toHaveBeenCalled()
  })

  // =========================================================================
  // dailySeries tiene exactamente 30 entradas (con agentes)
  // =========================================================================
  it('dailySeries tiene exactamente 30 entradas cuando hay agentes', async () => {
    setupOneAgentMock()

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.dailySeries).toHaveLength(30)
  })

  // =========================================================================
  // Días sin llamadas tienen calls: 0 (no se omiten)
  // =========================================================================
  it('días sin llamadas tienen calls: 0 (no se omiten de la serie)', async () => {
    // rawSeries vacío → todos los días deben ser 0
    setupOneAgentMock({ rawSeries: [] })

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.dailySeries).toHaveLength(30)
    const zeroDay = body.dailySeries.find((d: { calls: number }) => d.calls === 0)
    expect(zeroDay).toBeDefined()
    // Todos deben ser 0 si no hay rawSeries
    for (const entry of body.dailySeries) {
      expect(entry.calls).toBe(0)
    }
  })

  it('días con llamadas suman correctamente en la serie', async () => {
    const today = new Date().toISOString().slice(0, 10) + 'T10:00:00.000Z'
    setupOneAgentMock({
      rawSeries: [
        { called_at: today },
        { called_at: today },
        { called_at: today },
      ],
    })

    const res = await GET(makeRequest())
    const body = await res.json()

    const todayKey = new Date().toISOString().slice(0, 10)
    const todayEntry = body.dailySeries.find((d: { date: string }) => d.date === todayKey)
    expect(todayEntry?.calls).toBe(3)
  })
})
