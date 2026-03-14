/**
 * Tests para POST /api/v1/auth/agent-signup
 * WAS-214: Agent Signup programático
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// ---------------------------------------------------------------------------
// vi.hoisted — variables disponibles ANTES de los vi.mock()
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  createUser:    vi.fn(),
  deleteUser:    vi.fn(),
  fromInsert:    vi.fn(),
  getIdentifier: vi.fn(),
  checkRateLimit: vi.fn(),
  getAgentSignupLimit: vi.fn(),
  generateApiKey: vi.fn(),
  agentSignupKey: undefined as string | undefined,
}))

// ---------------------------------------------------------------------------
// Mocks de módulos
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({
    auth: {
      admin: {
        createUser: mocks.createUser,
        deleteUser: mocks.deleteUser,
      },
    },
    from: (table: string) => ({
      insert: (data: unknown) => mocks.fromInsert(table, data),
    }),
  })),
}))

vi.mock('@/lib/ratelimit', () => ({
  getAgentSignupLimit: () => mocks.getAgentSignupLimit(),
  getIdentifier: (req: unknown) => mocks.getIdentifier(req),
  checkRateLimit: (limit: unknown, identifier: unknown) => mocks.checkRateLimit(limit, identifier),
}))

vi.mock('@/lib/env', () => ({
  get env() {
    return { AGENT_SIGNUP_KEY: mocks.agentSignupKey }
  },
}))

vi.mock('@/features/agent-api/services/agent-keys.service', () => ({
  generateApiKey: () => mocks.generateApiKey(),
}))

// ---------------------------------------------------------------------------
// Import bajo test (DESPUÉS de los mocks)
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/v1/auth/agent-signup/route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/v1/auth/agent-signup', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function makeInvalidJsonRequest() {
  return new NextRequest('http://localhost/api/v1/auth/agent-signup', {
    method: 'POST',
    body: 'not-valid-json{{{',
    headers: { 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// Setup común
// ---------------------------------------------------------------------------

const FAKE_USER_ID = 'user-uuid-1234'
const FAKE_RAW_KEY = 'wai_testapikey123'
const FAKE_HASH    = 'hashed_key_abc'

beforeEach(() => {
  vi.clearAllMocks()

  // Por defecto: sin signup key
  mocks.agentSignupKey = undefined

  // Rate limit OK
  mocks.getAgentSignupLimit.mockReturnValue('mock-limit')
  mocks.getIdentifier.mockReturnValue('127.0.0.1')
  mocks.checkRateLimit.mockResolvedValue(null) // null = no rate limited

  // createUser OK
  mocks.createUser.mockResolvedValue({
    data: { user: { id: FAKE_USER_ID } },
    error: null,
  })

  // deleteUser OK
  mocks.deleteUser.mockResolvedValue({ error: null })

  // insert agent_keys OK
  mocks.fromInsert.mockResolvedValue({ data: null, error: null })

  // generateApiKey OK
  mocks.generateApiKey.mockReturnValue({ raw: FAKE_RAW_KEY, hash: FAKE_HASH })
})

// ===========================================================================
// AC1 — Happy path (endpoint abierto, sin AGENT_SIGNUP_KEY)
// ===========================================================================

describe('AC1 — Happy path (endpoint abierto)', () => {
  it('POST con email válido, sin AGENT_SIGNUP_KEY → 201 con agent_key', async () => {
    const res = await POST(makeRequest({ email: 'bot@example.com' }))

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toHaveProperty('agent_key', FAKE_RAW_KEY)
    expect(body).toHaveProperty('user_id', FAKE_USER_ID)
    expect(body).toHaveProperty('agent_key_warning')
    expect(body).toHaveProperty('next_steps')
  })
})

// ===========================================================================
// AC1b — Happy path con x-signup-key correcto
// ===========================================================================

describe('AC1b — Happy path con x-signup-key correcto', () => {
  it('POST con email válido + x-signup-key correcto → 201', async () => {
    mocks.agentSignupKey = 'my-secret-key'

    const res = await POST(makeRequest({ email: 'bot@example.com' }, { 'x-signup-key': 'my-secret-key' }))

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toHaveProperty('agent_key', FAKE_RAW_KEY)
  })
})

// ===========================================================================
// AC2 — Email duplicado
// ===========================================================================

describe('AC2 — Email duplicado', () => {
  it('Supabase retorna "User already registered" → 409 { error: "Email already registered" }', async () => {
    mocks.createUser.mockResolvedValue({
      data: null,
      error: { message: 'User already registered' },
    })

    const res = await POST(makeRequest({ email: 'existing@example.com' }))

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'Email already registered' })
  })
})

// ===========================================================================
// AC3 — x-signup-key inválida
// ===========================================================================

describe('AC3 — x-signup-key inválida', () => {
  it('AGENT_SIGNUP_KEY seteada, header ausente → 401', async () => {
    mocks.agentSignupKey = 'my-secret-key'

    const res = await POST(makeRequest({ email: 'bot@example.com' }))

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'Authentication required' })
  })

  it('AGENT_SIGNUP_KEY seteada, header incorrecto → 401', async () => {
    mocks.agentSignupKey = 'my-secret-key'

    const res = await POST(makeRequest({ email: 'bot@example.com' }, { 'x-signup-key': 'wrong-key' }))

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'Authentication required' })
  })
})

// ===========================================================================
// AC4 — Rate limit 429
// ===========================================================================

describe('AC4 — Rate limit', () => {
  it('checkRateLimit retorna NextResponse 429 → el endpoint lo retorna directamente', async () => {
    const rateLimitedResponse = NextResponse.json({ error: 'rate_limited' }, { status: 429 })
    mocks.checkRateLimit.mockResolvedValue(rateLimitedResponse)

    const res = await POST(makeRequest({ email: 'bot@example.com' }))

    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'rate_limited' })
  })
})

// ===========================================================================
// AC5 — No inserta en creator_profiles
// ===========================================================================

describe('AC5 — No inserta en creator_profiles', () => {
  it('NO llama .from("creator_profiles").insert()', async () => {
    await POST(makeRequest({ email: 'bot@example.com' }))

    const creatorProfileCalls = mocks.fromInsert.mock.calls.filter(
      ([table]) => table === 'creator_profiles',
    )
    expect(creatorProfileCalls).toHaveLength(0)
  })
})

// ===========================================================================
// AC6 — agent_keys insertado correctamente
// ===========================================================================

describe('AC6 — agent_keys insertado correctamente', () => {
  it('insert se llama con is_active: true, budget_usdc: 0, spent_usdc: 0', async () => {
    await POST(makeRequest({ email: 'bot@example.com' }))

    const agentKeyCalls = mocks.fromInsert.mock.calls.filter(([table]) => table === 'agent_keys')
    expect(agentKeyCalls).toHaveLength(1)

    const insertData = agentKeyCalls[0][1]
    expect(insertData).toMatchObject({
      is_active: true,
      budget_usdc: 0,
      spent_usdc: 0,
      owner_id: FAKE_USER_ID,
      key_hash: FAKE_HASH,
    })
  })
})

// ===========================================================================
// AC7 — Endpoint abierto si AGENT_SIGNUP_KEY vacío
// ===========================================================================

describe('AC7 — Endpoint abierto si AGENT_SIGNUP_KEY vacío', () => {
  it('env.AGENT_SIGNUP_KEY = "" → no requiere header', async () => {
    mocks.agentSignupKey = ''

    const res = await POST(makeRequest({ email: 'bot@example.com' }))

    expect(res.status).toBe(201)
  })
})

// ===========================================================================
// AC8 — Email inválido
// ===========================================================================

describe('AC8 — Email inválido', () => {
  it('body sin email → 422', async () => {
    const res = await POST(makeRequest({}))

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'Invalid email format' })
  })

  it('email malformado → 422', async () => {
    const res = await POST(makeRequest({ email: 'not-an-email' }))

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'Invalid email format' })
  })

  it('body JSON inválido → 422', async () => {
    const res = await POST(makeInvalidJsonRequest())

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'Invalid email format' })
  })
})

// ===========================================================================
// AC9 — Nombre auto-generado
// ===========================================================================

describe('AC9 — Nombre auto-generado para agent_keys', () => {
  it('email = "mybot@example.com" → name = "agent-mybot"', async () => {
    await POST(makeRequest({ email: 'mybot@example.com' }))

    const agentKeyCalls = mocks.fromInsert.mock.calls.filter(([table]) => table === 'agent_keys')
    expect(agentKeyCalls[0][1]).toMatchObject({ name: 'agent-mybot' })
  })

  it('local-part largo (>50 chars) → nombre truncado a "agent-" + 50 chars', async () => {
    const longLocal = 'a'.repeat(60)
    await POST(makeRequest({ email: `${longLocal}@example.com` }))

    const agentKeyCalls = mocks.fromInsert.mock.calls.filter(([table]) => table === 'agent_keys')
    const name: string = agentKeyCalls[0][1].name
    expect(name).toBe(`agent-${'a'.repeat(50)}`)
  })
})

// ===========================================================================
// AC10 — Rollback compensatorio
// ===========================================================================

describe('AC10 — Rollback compensatorio', () => {
  it('createUser OK, insert agent_keys falla → deleteUser llamado → 500', async () => {
    mocks.fromInsert.mockResolvedValue({ data: null, error: { message: 'DB error' } })

    const res = await POST(makeRequest({ email: 'bot@example.com' }))

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'Failed to create agent key' })
    expect(mocks.deleteUser).toHaveBeenCalledWith(FAKE_USER_ID)
  })

  it('createUser OK, insert falla, deleteUser también falla → log zombie user → 500', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.fromInsert.mockResolvedValue({ data: null, error: { message: 'DB error' } })
    mocks.deleteUser.mockResolvedValue({ error: { message: 'Delete failed' } })

    const res = await POST(makeRequest({ email: 'bot@example.com' }))

    expect(res.status).toBe(500)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('ZOMBIE USER'),
      expect.anything(),
    )
    consoleSpy.mockRestore()
  })
})

// ===========================================================================
// AC11 — Redis down (503)
// ===========================================================================

describe('AC11 — Redis down (503)', () => {
  it('checkRateLimit retorna NextResponse 503 → el endpoint lo retorna', async () => {
    const serviceUnavailable = NextResponse.json({ error: 'service_unavailable' }, { status: 503 })
    mocks.checkRateLimit.mockResolvedValue(serviceUnavailable)

    const res = await POST(makeRequest({ email: 'bot@example.com' }))

    expect(res.status).toBe(503)
  })
})

// ===========================================================================
// Auth check ANTES que rate limit
// ===========================================================================

describe('Auth check ANTES que rate limit', () => {
  it('Con AGENT_SIGNUP_KEY seteada y key inválida: checkRateLimit NO debe ser llamado', async () => {
    mocks.agentSignupKey = 'my-secret-key'

    await POST(makeRequest({ email: 'bot@example.com' }, { 'x-signup-key': 'wrong-key' }))

    expect(mocks.checkRateLimit).not.toHaveBeenCalled()
  })
})
