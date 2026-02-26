/**
 * Tests para GET y POST /api/v1/agents/[slug]/trial
 * HU-3.1: Free Trial
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// vi.hoisted — variables disponibles ANTES de los vi.mock()
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getUser:             vi.fn(),
  validateEndpointUrl: vi.fn(),
  limitFn:             vi.fn(),
  fetchFn:             vi.fn(),
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

vi.mock('@/lib/security/validateEndpointUrl', () => ({
  validateEndpointUrl: mocks.validateEndpointUrl,
}))

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: Object.assign(
    vi.fn().mockImplementation(() => ({
      limit: mocks.limitFn,
    })),
    { slidingWindow: vi.fn().mockReturnValue('mock-sliding-window') },
  ),
}))

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn().mockImplementation(() => ({})),
}))

vi.stubGlobal('fetch', mocks.fetchFn)

// ---------------------------------------------------------------------------
// Supabase service mock — mockSvcFrom configurado por test
// ---------------------------------------------------------------------------

// Debe declararse ANTES del vi.mock (es referenciada dentro de la factory)
// pero vi.mock es hoisted. Usamos una variable mutable external.
const mockSvcFrom = vi.fn()

// ---------------------------------------------------------------------------
// Import bajo test (DESPUÉS de los mocks)
// ---------------------------------------------------------------------------

import { GET, POST } from '@/app/api/v1/agents/[slug]/trial/route'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const TEST_USER = { id: 'user-abc-123' }
const AGENT     = { id: 'agent-uuid', endpoint_url: 'https://example.com/invoke', name: 'Test Agent' }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeParams(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

function makePostRequest(slug: string, body: unknown) {
  return new NextRequest(`http://localhost/api/v1/agents/${slug}/trial`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    body:    JSON.stringify(body),
  })
}

function makeGetRequest(slug: string) {
  return new NextRequest(`http://localhost/api/v1/agents/${slug}/trial`, {
    method:  'GET',
    headers: { 'x-forwarded-for': '1.2.3.4' },
  })
}

/**
 * Crea un builder chainable donde `single()` resuelve al valor dado,
 * y `insert()`/`upsert()` resuelven directamente (no usan single).
 */
function makeChain(singleResult: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  const methods = ['select', 'eq', 'gte', 'lte', 'in', 'order', 'limit', 'ilike', 'neq', 'not', 'or', 'maybeSingle']
  methods.forEach(m => { chain[m] = vi.fn().mockReturnValue(chain) })
  chain['single'] = vi.fn().mockResolvedValue(singleResult)
  chain['insert'] = vi.fn().mockResolvedValue({ data: null, error: null })
  chain['upsert'] = vi.fn().mockResolvedValue({ data: null, error: null })
  chain['update'] = vi.fn().mockResolvedValue({ data: null, error: null })
  chain['delete'] = vi.fn().mockResolvedValue({ data: null, error: null })
  return chain
}

// ---------------------------------------------------------------------------
// Setup común
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  // Limpiar la cola de mockReturnValueOnce (no lo hace clearAllMocks)
  mockSvcFrom.mockReset()

  // Usuario autenticado por defecto
  mocks.getUser.mockResolvedValue({ data: { user: TEST_USER } })

  // Rate limit OK por defecto
  mocks.limitFn.mockResolvedValue({ success: true, limit: 3, reset: Date.now() + 3600000 })

  // validateEndpointUrl no lanza (URL válida) por defecto
  mocks.validateEndpointUrl.mockReturnValue(undefined)

  // fetch OK por defecto
  mocks.fetchFn.mockResolvedValue({
    status: 200,
    ok: true,
    text: vi.fn().mockResolvedValue('{"result":"ok"}'),
  } as unknown as Response)
})

// ===========================================================================
// GET /api/v1/agents/[slug]/trial
// ===========================================================================

describe('GET /api/v1/agents/[slug]/trial', () => {
  it('retorna 401 si no hay sesión', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } })

    const res = await GET(makeGetRequest('test-agent'), makeParams('test-agent'))

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'unauthorized' })
  })

  it('retorna 404 si el agente no existe', async () => {
    mockSvcFrom
      .mockReturnValueOnce(makeChain({ data: null, error: null })) // agents → not found
      .mockReturnValueOnce(makeChain({ data: null, error: null })) // agent_trials (no se llega)

    const res = await GET(makeGetRequest('no-existe'), makeParams('no-existe'))

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'not_found' })
  })

  it('retorna { used: false, usedAt: null } cuando el usuario no tiene trial previo', async () => {
    mockSvcFrom
      .mockReturnValueOnce(makeChain({ data: AGENT, error: null }))       // agents → found
      .mockReturnValueOnce(makeChain({ data: null, error: null }))        // agent_trials → null

    const res = await GET(makeGetRequest('test-agent'), makeParams('test-agent'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ used: false, usedAt: null })
  })

  it('retorna { used: true, usedAt: timestamp } cuando el usuario ya usó el trial', async () => {
    const usedAt = '2026-02-25T10:00:00.000Z'
    mockSvcFrom
      .mockReturnValueOnce(makeChain({ data: AGENT, error: null }))
      .mockReturnValueOnce(makeChain({ data: { used_at: usedAt }, error: null }))

    const res = await GET(makeGetRequest('test-agent'), makeParams('test-agent'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ used: true, usedAt })
  })
})

// ===========================================================================
// POST /api/v1/agents/[slug]/trial
// ===========================================================================

describe('POST /api/v1/agents/[slug]/trial', () => {
  // =========================================================================
  // Auth
  // =========================================================================
  it('retorna 401 si no hay sesión', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } })

    const res = await POST(makePostRequest('test-agent', { input: 'hola' }), makeParams('test-agent'))

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'unauthorized' })
  })

  // =========================================================================
  // Rate limit
  // =========================================================================
  it('retorna 429 { error: "rate_limited" } cuando se excede el rate limit', async () => {
    mocks.limitFn.mockResolvedValueOnce({ success: false, limit: 3, reset: Date.now() + 3600000 })

    const res = await POST(makePostRequest('test-agent', { input: 'hola' }), makeParams('test-agent'))

    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'rate_limited' })
  })

  // =========================================================================
  // Validación de body
  // =========================================================================
  it('retorna 400 si el body tiene input vacío', async () => {
    const res = await POST(makePostRequest('test-agent', { input: '' }), makeParams('test-agent'))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'invalid_input' })
  })

  it('retorna 400 si el body no tiene input', async () => {
    const res = await POST(makePostRequest('test-agent', {}), makeParams('test-agent'))

    expect(res.status).toBe(400)
  })

  // =========================================================================
  // Agente no encontrado
  // =========================================================================
  it('retorna 404 si el agente no existe', async () => {
    mockSvcFrom.mockReturnValue(makeChain({ data: null, error: null }))

    const res = await POST(makePostRequest('no-existe', { input: 'test' }), makeParams('no-existe'))

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'not_found' })
  })

  // =========================================================================
  // SSRF
  // =========================================================================
  it('retorna 400 { error: "invalid_endpoint" } cuando SSRF es bloqueado', async () => {
    mockSvcFrom
      .mockReturnValueOnce(makeChain({ data: AGENT, error: null })) // agents → found

    mocks.validateEndpointUrl.mockImplementationOnce(() => {
      throw new Error('Private or internal endpoint URLs are not allowed')
    })

    const res = await POST(makePostRequest('test-agent', { input: 'test' }), makeParams('test-agent'))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'invalid_endpoint' })
  })

  // =========================================================================
  // Trial ya usado
  // =========================================================================
  it('retorna 409 { error: "already_used" } si el trial ya fue utilizado', async () => {
    mockSvcFrom
      .mockReturnValueOnce(makeChain({ data: AGENT, error: null }))                    // agents
      .mockReturnValueOnce(makeChain({ data: { id: 'trial-id' }, error: null }))      // agent_trials → existing

    const res = await POST(makePostRequest('test-agent', { input: 'test' }), makeParams('test-agent'))

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'already_used' })
  })

  // =========================================================================
  // Éxito — agente responde 200
  // =========================================================================
  it('retorna { output, latencyMs } cuando el agente responde 200', async () => {
    mockSvcFrom
      .mockReturnValueOnce(makeChain({ data: AGENT, error: null }))    // agents
      .mockReturnValueOnce(makeChain({ data: null, error: null }))     // agent_trials check
      .mockReturnValueOnce(makeChain({ data: null, error: null }))     // agent_trials upsert (from chain)
      .mockReturnValueOnce(makeChain({ data: null, error: null }))     // agent_calls insert

    mocks.fetchFn.mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: vi.fn().mockResolvedValue('respuesta del agente'),
    } as unknown as Response)

    const res = await POST(makePostRequest('test-agent', { input: 'test' }), makeParams('test-agent'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('output', 'respuesta del agente')
    expect(body).toHaveProperty('latencyMs')
    expect(typeof body.latencyMs).toBe('number')
    expect(body.latencyMs).toBeGreaterThanOrEqual(0)
  })

  // =========================================================================
  // Agente responde 500
  // =========================================================================
  it('retorna 502 { error: "agent_error" } cuando el agente responde 500', async () => {
    mockSvcFrom
      .mockReturnValueOnce(makeChain({ data: AGENT, error: null }))   // agents
      .mockReturnValueOnce(makeChain({ data: null, error: null }))    // agent_trials check
      .mockReturnValueOnce(makeChain({ data: null, error: null }))    // agent_trials upsert
      .mockReturnValueOnce(makeChain({ data: null, error: null }))    // agent_calls insert

    mocks.fetchFn.mockResolvedValueOnce({
      status: 500,
      ok: false,
      text: vi.fn().mockResolvedValue('Internal Server Error'),
    } as unknown as Response)

    const res = await POST(makePostRequest('test-agent', { input: 'test' }), makeParams('test-agent'))

    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'agent_error' })
  })

  // =========================================================================
  // Timeout (AbortError)
  // =========================================================================
  it('retorna 504 { error: "timeout" } cuando el agente no responde a tiempo', async () => {
    mockSvcFrom
      .mockReturnValueOnce(makeChain({ data: AGENT, error: null }))   // agents
      .mockReturnValueOnce(makeChain({ data: null, error: null }))    // agent_trials check
      .mockReturnValueOnce(makeChain({ data: null, error: null }))    // agent_trials upsert
      .mockReturnValueOnce(makeChain({ data: null, error: null }))    // agent_calls insert

    const abortError = new Error('The operation was aborted')
    abortError.name = 'AbortError'
    mocks.fetchFn.mockRejectedValueOnce(abortError)

    const res = await POST(makePostRequest('test-agent', { input: 'test' }), makeParams('test-agent'))

    expect(res.status).toBe(504)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'timeout' })
  })

  // =========================================================================
  // Seguridad — no exponer body del agente en errores
  // =========================================================================
  it('NO expone el body del agente en respuestas de error (seguridad)', async () => {
    mockSvcFrom
      .mockReturnValueOnce(makeChain({ data: AGENT, error: null }))   // agents
      .mockReturnValueOnce(makeChain({ data: null, error: null }))    // agent_trials check
      .mockReturnValueOnce(makeChain({ data: null, error: null }))    // agent_trials upsert
      .mockReturnValueOnce(makeChain({ data: null, error: null }))    // agent_calls insert

    mocks.fetchFn.mockResolvedValueOnce({
      status: 500,
      ok: false,
      text: vi.fn().mockResolvedValue('{"internal_secret": "super-secret", "stack_trace": "..."}'),
    } as unknown as Response)

    const res = await POST(makePostRequest('test-agent', { input: 'test' }), makeParams('test-agent'))
    const body = await res.json()

    expect(body).not.toHaveProperty('internal_secret')
    expect(body).not.toHaveProperty('stack_trace')
    // Solo debe contener claves de error controladas
    expect(Object.keys(body)).not.toContain('output')
  })
})
