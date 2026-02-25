import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// vi.hoisted — variables disponibles ANTES que los vi.mock() hoisted
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  rpc:              vi.fn(),
  settleKeyBatch:   vi.fn(),
  serviceClientFrom: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mocks de módulos
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({
    from: mocks.serviceClientFrom,
    rpc:  mocks.rpc,
  })),
}))

vi.mock('@/lib/contracts/marketplaceClient', () => ({
  settleKeyBatchOnChain: mocks.settleKeyBatch,
}))

vi.mock('@/lib/settlement/immediateSettlement', () => ({
  PENDING_WALLET_SENTINEL: 'PENDING_WALLET',
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Import bajo test (DESPUÉS de los mocks)
// ---------------------------------------------------------------------------

import { GET } from '../settle-key-batches/route'

// ---------------------------------------------------------------------------
// Helpers — chainable query builder
// ---------------------------------------------------------------------------

/**
 * Crea un builder de consulta Supabase encadenable.
 * Cada método devuelve `self` para que cadenas como `.select().not().eq().order()` funcionen.
 * El objeto es thenable (Promise-like) así que `await builder` resuelve a `terminalResult`.
 * `.single()` y `.maybeSingle()` también resuelven a `terminalResult`.
 */
function makeQueryBuilder(terminalResult: unknown) {
  const self = {} as Record<string, unknown>

  const chainMethods = [
    'select', 'insert', 'update', 'upsert', 'not',
    'is', 'eq', 'neq', 'in', 'gte', 'lte',
    'order', 'filter', 'limit', 'range', 'ilike',
  ]
  for (const method of chainMethods) {
    self[method] = vi.fn(() => self)
  }

  self.single      = vi.fn(() => Promise.resolve(terminalResult))
  self.maybeSingle = vi.fn(() => Promise.resolve(terminalResult))

  // Thenable para que `await builder.someChainMethod()` funcione
  Object.defineProperty(self, 'then', {
    configurable: true,
    enumerable:   false,
    get() {
      return (
        resolve: (value: unknown) => unknown,
        reject?: (reason?: unknown) => unknown,
      ) => Promise.resolve(terminalResult).then(resolve, reject)
    },
  })

  return self
}

// ---------------------------------------------------------------------------
// Estado de DB configurable por test
// ---------------------------------------------------------------------------

type AgentCall = {
  id: string
  key_id: string
  agent_slug: string
  amount_paid: string
}

type TableState = {
  agentCalls:           { data: AgentCall[] | null; error: string | null }
  agents:               { data: unknown[] | null }
  creatorProfiles:      { data: unknown[] | null }
  agentKeys:            { data: unknown; error: string | null }
  keyBatchSettlements:  { data: unknown }
}

const tableState: TableState = {
  agentCalls:           { data: [], error: null },
  agents:               { data: [] },
  creatorProfiles:      { data: [] },
  agentKeys:            { data: null, error: null },
  keyBatchSettlements:  { data: { id: 'batch-1' } },
}

function resetTableState() {
  tableState.agentCalls           = { data: [], error: null }
  tableState.agents               = { data: [] }
  tableState.creatorProfiles      = { data: [] }
  tableState.agentKeys            = { data: null, error: null }
  tableState.keyBatchSettlements  = { data: { id: 'batch-1' } }
}

function setupFromMock() {
  mocks.serviceClientFrom.mockImplementation((table: string) => {
    switch (table) {
      case 'agent_calls':         return makeQueryBuilder(tableState.agentCalls)
      case 'agents':              return makeQueryBuilder(tableState.agents)
      case 'creator_profiles':    return makeQueryBuilder(tableState.creatorProfiles)
      case 'agent_keys':          return makeQueryBuilder(tableState.agentKeys)
      case 'key_batch_settlements': return makeQueryBuilder(tableState.keyBatchSettlements)
      default:                    return makeQueryBuilder({ data: null, error: null })
    }
  })
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleCall: AgentCall = {
  id:           'call-1',
  key_id:       'key-1',
  agent_slug:   'test-agent',
  amount_paid:  '5.000000',
}

const sampleAgent = { slug: 'test-agent', creator_id: 'creator-1' }
const sampleKeyRow = { key_hash: '0xkeyhash' }

const CRON_SECRET = 'test-cron-secret'

function makeRequest(authHeader?: string): NextRequest {
  return new NextRequest('http://localhost/api/cron/settle-key-batches', {
    method:  'GET',
    headers: authHeader ? { authorization: authHeader } : {},
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('settle-key-batches cron', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
    resetTableState()
    setupFromMock()
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    mocks.settleKeyBatch.mockResolvedValue('0xtxhash')
  })

  // =========================================================================
  // Auth del cron
  // =========================================================================
  describe('auth del cron', () => {
    it('retorna 401 si CRON_SECRET no coincide', async () => {
      // Arrange
      const req = makeRequest('Bearer wrong-secret')

      // Act
      const res = await GET(req)

      // Assert
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body).toMatchObject({ error: 'Unauthorized' })
    })

    it('retorna 401 si no hay header de autorización', async () => {
      // Arrange
      const req = makeRequest()

      // Act
      const res = await GET(req)

      // Assert
      expect(res.status).toBe(401)
    })

    it('retorna 500 si CRON_SECRET no está configurado', async () => {
      // Arrange
      delete process.env.CRON_SECRET
      const req = makeRequest(`Bearer ${CRON_SECRET}`)

      // Act
      const res = await GET(req)

      // Assert
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error).toContain('CRON_SECRET')
    })

    it('procede si CRON_SECRET coincide (retorna 200 con ok:true)', async () => {
      // Arrange — sin llamadas pendientes → sale limpio
      tableState.agentCalls = { data: [], error: null }
      const req = makeRequest(`Bearer ${CRON_SECRET}`)

      // Act
      const res = await GET(req)
      const body = await res.json()

      // Assert
      expect(res.status).toBe(200)
      expect(body.ok).toBe(true)
    })
  })

  // =========================================================================
  // Creator sin wallet
  // =========================================================================
  describe('creator sin wallet', () => {
    beforeEach(() => {
      tableState.agentCalls      = { data: [sampleCall], error: null }
      tableState.agents          = { data: [sampleAgent] }
      tableState.creatorProfiles = { data: [{ id: 'creator-1', wallet_address: null }] }
      tableState.agentKeys       = { data: sampleKeyRow, error: null }
      setupFromMock()
    })

    it('skippea el settlement on-chain cuando creator no tiene wallet', async () => {
      // Arrange
      const req = makeRequest(`Bearer ${CRON_SECRET}`)

      // Act
      await GET(req)

      // Assert — settleKeyBatchOnChain nunca debe llamarse
      expect(mocks.settleKeyBatch).not.toHaveBeenCalled()
    })

    it('no llama a settleKeyBatch si creator no tiene wallet', async () => {
      // Arrange
      const req = makeRequest(`Bearer ${CRON_SECRET}`)

      // Act
      await GET(req)

      // Assert
      expect(mocks.settleKeyBatch).toHaveBeenCalledTimes(0)
    })

    it('llama a increment_pending_earnings con el amount correcto', async () => {
      // Arrange
      const req = makeRequest(`Bearer ${CRON_SECRET}`)

      // Act
      await GET(req)

      // Assert
      expect(mocks.rpc).toHaveBeenCalledWith('increment_pending_earnings', {
        p_user_id: 'creator-1',
        p_amount:  Number(sampleCall.amount_paid), // 5
      })
    })

    it('retorna ok:true con settled:0 (nada liquidado on-chain)', async () => {
      // Arrange
      const req = makeRequest(`Bearer ${CRON_SECRET}`)

      // Act
      const res = await GET(req)
      const body = await res.json()

      // Assert
      expect(res.status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.settled).toBe(0)
    })
  })

  // =========================================================================
  // Creator con wallet
  // =========================================================================
  describe('creator con wallet', () => {
    const WALLET = '0x742d35cc6634c0532925a3b844bc9e7595f2bd18'

    beforeEach(() => {
      tableState.agentCalls      = { data: [sampleCall], error: null }
      tableState.agents          = { data: [sampleAgent] }
      tableState.creatorProfiles = { data: [{ id: 'creator-1', wallet_address: WALLET }] }
      tableState.agentKeys       = { data: sampleKeyRow, error: null }
      tableState.keyBatchSettlements = { data: { id: 'batch-1' } }
      setupFromMock()
    })

    it('procede con settlement on-chain cuando creator tiene wallet', async () => {
      // Arrange
      const req = makeRequest(`Bearer ${CRON_SECRET}`)

      // Act
      await GET(req)

      // Assert
      expect(mocks.settleKeyBatch).toHaveBeenCalledTimes(1)
      expect(mocks.settleKeyBatch).toHaveBeenCalledWith(
        sampleKeyRow.key_hash,
        [sampleCall.agent_slug],
        [Number(sampleCall.amount_paid)],
      )
    })

    it('no incrementa pending_earnings_usdc cuando creator tiene wallet', async () => {
      // Arrange
      const req = makeRequest(`Bearer ${CRON_SECRET}`)

      // Act
      await GET(req)

      // Assert — rpc increment_pending_earnings NO debe llamarse
      expect(mocks.rpc).not.toHaveBeenCalledWith(
        'increment_pending_earnings',
        expect.anything(),
      )
    })

    it('retorna settled > 0 en la respuesta', async () => {
      // Arrange
      const req = makeRequest(`Bearer ${CRON_SECRET}`)

      // Act
      const res = await GET(req)
      const body = await res.json()

      // Assert
      expect(res.status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.settled).toBeGreaterThan(0)
    })
  })

  // =========================================================================
  // Edge: sin llamadas pendientes
  // =========================================================================
  describe('sin llamadas pendientes', () => {
    it('retorna ok:true con settled:0 si no hay llamadas', async () => {
      // Arrange — tableState.agentCalls.data = [] por defecto en beforeEach
      const req = makeRequest(`Bearer ${CRON_SECRET}`)

      // Act
      const res = await GET(req)
      const body = await res.json()

      // Assert
      expect(res.status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.settled).toBe(0)
    })
  })
})
