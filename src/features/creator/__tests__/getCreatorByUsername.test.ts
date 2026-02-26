/**
 * Tests para getCreatorByUsername()
 * HU-1.5: Perfil Público del Creator
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks de módulos
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({ from: mockSvcFrom })),
}))

// ---------------------------------------------------------------------------
// Supabase service mock
// ---------------------------------------------------------------------------

const mockSvcFrom = vi.fn()

// ---------------------------------------------------------------------------
// Import bajo test (DESPUÉS de los mocks)
// ---------------------------------------------------------------------------

import { getCreatorByUsername } from '@/features/creator/lib/getCreatorByUsername'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const PROFILE_ROW = {
  id:         'creator-id-1',
  username:   'san_creator',
  bio:        'Builder Web3/AI desde Honduras.',
  created_at: '2026-01-15T00:00:00.000Z',
  // Campos privados que NO deben aparecer en la respuesta
  email:          'san@example.com',
  wallet_address: '0xabc123def456',
}

const AGENT_ROW_1 = {
  id:              'agent-1',
  slug:            'agente-uno',
  name:            'Agente Uno',
  description:     'Descripción del agente uno',
  price_per_call:  0.05,
  category:        'productivity',
  cover_image:     'https://cdn.example.com/img1.png',
  total_calls:     100,
}

const AGENT_ROW_2 = {
  id:              'agent-2',
  slug:            'agente-dos',
  name:            'Agente Dos',
  description:     null,
  price_per_call:  0.10,
  category:        'automation',
  cover_image:     null,
  total_calls:     50,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Chain chainable con `single()` thenable.
 * También soporta await directo (para count queries sin .single()).
 */
function makeChain(resolveWith: unknown) {
  const chain: Record<string, unknown> = {}

  // Thenable — permite await directo
  chain['then'] = (
    onFulfilled: (v: unknown) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => Promise.resolve(resolveWith).then(onFulfilled, onRejected)
  chain['catch'] = (fn: (e: unknown) => unknown) =>
    Promise.resolve(resolveWith).catch(fn)
  chain['finally'] = (fn: () => void) =>
    Promise.resolve(resolveWith).finally(fn)

  const methods = [
    'select', 'eq', 'neq', 'gte', 'lte', 'in', 'order', 'limit',
    'ilike', 'not', 'or', 'maybeSingle', 'insert', 'update', 'upsert',
  ]
  methods.forEach(m => {
    chain[m] = vi.fn().mockReturnValue(chain)
  })

  chain['single'] = vi.fn().mockResolvedValue(resolveWith)

  return chain
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  // Limpiar la cola de mockReturnValueOnce (no lo hace clearAllMocks)
  mockSvcFrom.mockReset()
})

// ===========================================================================
// Tests
// ===========================================================================

describe('getCreatorByUsername()', () => {
  // =========================================================================
  // Username inexistente
  // =========================================================================
  it('retorna null si el username no existe', async () => {
    mockSvcFrom.mockReturnValueOnce(makeChain({ data: null, error: null }))

    const result = await getCreatorByUsername('username-que-no-existe')

    expect(result).toBeNull()
  })

  // =========================================================================
  // Username existente — campos correctos
  // =========================================================================
  it('retorna CreatorProfile con campos correctos cuando existe', async () => {
    mockSvcFrom
      .mockReturnValueOnce(makeChain({ data: PROFILE_ROW, error: null }))    // creator_profiles
      .mockReturnValueOnce(makeChain({ data: [AGENT_ROW_1], error: null }))  // agents
      .mockReturnValueOnce(makeChain({ count: 100, data: null, error: null })) // agent_calls count

    const result = await getCreatorByUsername('san_creator')

    expect(result).not.toBeNull()
    expect(result?.username).toBe('san_creator')
    expect(result?.displayName).toBe('san_creator')
    expect(result?.bio).toBe('Builder Web3/AI desde Honduras.')
    expect(result?.memberSince).toBe('2026-01-15T00:00:00.000Z')
    expect(result?.agentCount).toBe(1)
    expect(result?.agents).toHaveLength(1)
  })

  // =========================================================================
  // NO retorna email
  // =========================================================================
  it('NO incluye email en la respuesta', async () => {
    mockSvcFrom
      .mockReturnValueOnce(makeChain({ data: PROFILE_ROW, error: null }))
      .mockReturnValueOnce(makeChain({ data: [AGENT_ROW_1], error: null }))
      .mockReturnValueOnce(makeChain({ count: 100, data: null, error: null }))

    const result = await getCreatorByUsername('san_creator')

    expect(result).not.toHaveProperty('email')
    // Verificar que ninguna clave del resultado contiene "email"
    const keys = Object.keys(result ?? {})
    const hasEmail = keys.some(k => k.toLowerCase().includes('email'))
    expect(hasEmail).toBe(false)
  })

  // =========================================================================
  // NO retorna wallet_address
  // =========================================================================
  it('NO incluye wallet_address en la respuesta', async () => {
    mockSvcFrom
      .mockReturnValueOnce(makeChain({ data: PROFILE_ROW, error: null }))
      .mockReturnValueOnce(makeChain({ data: [AGENT_ROW_1], error: null }))
      .mockReturnValueOnce(makeChain({ count: 100, data: null, error: null }))

    const result = await getCreatorByUsername('san_creator')

    expect(result).not.toHaveProperty('wallet_address')
    expect(result).not.toHaveProperty('walletAddress')
  })

  // =========================================================================
  // Creator sin agentes
  // =========================================================================
  it('retorna agents: [] y agentCount: 0 cuando el creator no tiene agentes', async () => {
    mockSvcFrom
      .mockReturnValueOnce(makeChain({ data: PROFILE_ROW, error: null })) // creator_profiles
      .mockReturnValueOnce(makeChain({ data: [],           error: null })) // agents vacíos
    // No hay agent_calls query cuando agentIds está vacío

    const result = await getCreatorByUsername('san_creator')

    expect(result).not.toBeNull()
    expect(result?.agents).toEqual([])
    expect(result?.agentCount).toBe(0)
    expect(result?.totalCalls).toBe(0)
  })

  // =========================================================================
  // totalCalls = suma de llamadas de todos los agentes
  // =========================================================================
  it('totalCalls es la suma de llamadas de todos sus agentes', async () => {
    mockSvcFrom
      .mockReturnValueOnce(makeChain({ data: PROFILE_ROW, error: null }))
      .mockReturnValueOnce(makeChain({ data: [AGENT_ROW_1, AGENT_ROW_2], error: null }))
      .mockReturnValueOnce(makeChain({ count: 150, data: null, error: null })) // count de agent_calls

    const result = await getCreatorByUsername('san_creator')

    // totalCalls debe venir del count de la query, no de los total_calls individuales
    expect(result?.totalCalls).toBe(150)
    expect(result?.agentCount).toBe(2)
  })

  // =========================================================================
  // bio null
  // =========================================================================
  it('retorna bio: null (no undefined) cuando el creator no tiene bio', async () => {
    const profileNoBio = { ...PROFILE_ROW, bio: null }

    mockSvcFrom
      .mockReturnValueOnce(makeChain({ data: profileNoBio, error: null }))
      .mockReturnValueOnce(makeChain({ data: [],           error: null }))

    const result = await getCreatorByUsername('san_creator')

    expect(result).not.toBeNull()
    // Debe ser null, no undefined
    expect(result?.bio).toBeNull()
    expect(result?.bio).not.toBeUndefined()
  })

  // =========================================================================
  // Estructura de agentes en la respuesta
  // =========================================================================
  it('los agentes en la respuesta tienen los campos públicos correctos', async () => {
    mockSvcFrom
      .mockReturnValueOnce(makeChain({ data: PROFILE_ROW, error: null }))
      .mockReturnValueOnce(makeChain({ data: [AGENT_ROW_1], error: null }))
      .mockReturnValueOnce(makeChain({ count: 100, data: null, error: null }))

    const result = await getCreatorByUsername('san_creator')
    const agent = result?.agents[0]

    expect(agent).toMatchObject({
      id:             'agent-1',
      slug:           'agente-uno',
      name:           'Agente Uno',
      price_per_call: 0.05,
      category:       'productivity',
      total_calls:    100,
    })

    // No debe exponer endpoint_url ni auth_header
    expect(agent).not.toHaveProperty('endpoint_url')
    expect(agent).not.toHaveProperty('auth_header')
  })
})
