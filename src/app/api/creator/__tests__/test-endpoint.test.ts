import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// vi.hoisted — variables disponibles ANTES que los vi.mock() hoisted
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getUser:              vi.fn(),
  validateEndpointUrl:  vi.fn(),
  checkRateLimit:       vi.fn(),
  getIdentifier:        vi.fn(),
  fetch:                vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mocks de módulos
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mocks.getUser },
    }),
  ),
}))

vi.mock('@/lib/security/validateEndpointUrl', () => ({
  validateEndpointUrl:      mocks.validateEndpointUrl,
  validateEndpointUrlAsync: mocks.validateEndpointUrl, // mismo mock — test solo verifica sincrónico
}))

vi.mock('@/lib/ratelimit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  getIdentifier:  mocks.getIdentifier,
}))

// Prevent real Upstash connections — el route instancia Ratelimit/Redis internamente
vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: Object.assign(
    vi.fn().mockImplementation(() => ({
      limit: vi.fn().mockResolvedValue({ success: true, limit: 5, reset: Date.now() + 60000 }),
    })),
    {
      // slidingWindow es método ESTÁTICO — se llama como Ratelimit.slidingWindow(n, '1 m')
      slidingWindow: vi.fn().mockReturnValue('mock-sliding-window'),
    }
  ),
}))

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn().mockImplementation(() => ({})),
}))

// Stub fetch global
vi.stubGlobal('fetch', mocks.fetch)

// ---------------------------------------------------------------------------
// Import bajo test (DESPUÉS de los mocks)
// ---------------------------------------------------------------------------

import { POST } from '../test-endpoint/route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER = { id: 'user-abc-123' }

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/creator/test-endpoint', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

/** Mock respuesta exitosa del endpoint externo */
function mockExternalOk(status: number) {
  mocks.fetch.mockResolvedValueOnce({ status, ok: status < 400 } as Response)
}

/** Simula AbortError (timeout por AbortController) */
function mockFetchTimeout() {
  const err = new Error('The operation was aborted')
  err.name = 'AbortError'
  mocks.fetch.mockRejectedValueOnce(err)
}

/** Simula error de red genérico */
function mockFetchUnreachable() {
  mocks.fetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/creator/test-endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Usuario autenticado por defecto
    mocks.getUser.mockResolvedValue({ data: { user: TEST_USER } })

    // Sin rate limit por defecto
    mocks.checkRateLimit.mockResolvedValue(null)
    mocks.getIdentifier.mockReturnValue(`user:${TEST_USER.id}`)

    // validateEndpointUrl no lanza (URL válida) por defecto
    mocks.validateEndpointUrl.mockReturnValue(undefined)
  })

  // =========================================================================
  // Auth
  // =========================================================================
  describe('auth', () => {
    it('retorna 401 si no hay sesión', async () => {
      // Arrange
      mocks.getUser.mockResolvedValue({ data: { user: null } })
      const req = makeRequest({ endpoint_url: 'https://example.com/api' })

      // Act
      const res = await POST(req)

      // Assert
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body).toMatchObject({ error: 'Unauthorized' })
    })

    it('procede si hay sesión válida (no retorna 401)', async () => {
      // Arrange
      mockExternalOk(200)
      const req = makeRequest({ endpoint_url: 'https://example.com/api' })

      // Act
      const res = await POST(req)

      // Assert
      expect(res.status).not.toBe(401)
    })
  })

  // =========================================================================
  // SSRF protection
  // =========================================================================
  describe('SSRF protection', () => {
    it('retorna 400 si la URL es una IP privada (192.168.x.x)', async () => {
      // Arrange — validateEndpointUrl lanza para IPs privadas
      mocks.validateEndpointUrl.mockImplementationOnce(() => {
        throw new Error('Private or internal endpoint URLs are not allowed')
      })
      const req = makeRequest({ endpoint_url: 'https://192.168.1.100/api' })

      // Act
      const res = await POST(req)

      // Assert
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/not allowed/i)
    })

    it('retorna 400 si la URL apunta a localhost', async () => {
      // Arrange
      mocks.validateEndpointUrl.mockImplementationOnce(() => {
        throw new Error('Private or internal endpoint URLs are not allowed')
      })
      const req = makeRequest({ endpoint_url: 'https://localhost/api' })

      // Act
      const res = await POST(req)

      // Assert
      expect(res.status).toBe(400)
    })

    it('permite URLs públicas válidas (validateEndpointUrl no lanza)', async () => {
      // Arrange
      mocks.validateEndpointUrl.mockReturnValueOnce(undefined)
      mockExternalOk(200)
      const req = makeRequest({ endpoint_url: 'https://api.example.com/v1/agent' })

      // Act
      const res = await POST(req)

      // Assert — no es 400 por SSRF
      expect(res.status).not.toBe(400)
      expect(mocks.validateEndpointUrl).toHaveBeenCalledWith('https://api.example.com/v1/agent')
    })

    it('retorna 400 si endpoint_url no es una URL válida (Zod)', async () => {
      // Arrange — Zod rechaza antes de llegar a SSRF check
      const req = makeRequest({ endpoint_url: 'not-a-url' })

      // Act
      const res = await POST(req)

      // Assert
      expect(res.status).toBe(400)
    })
  })

  // =========================================================================
  // Resultados del probe
  // =========================================================================
  describe('resultados del probe', () => {
    it('retorna { ok: true, status: 200, latencyMs } cuando el endpoint responde 200', async () => {
      // Arrange
      mockExternalOk(200)
      const req = makeRequest({ endpoint_url: 'https://api.example.com/agent' })

      // Act
      const res = await POST(req)
      const body = await res.json()

      // Assert
      expect(res.status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.status).toBe(200)
      expect(typeof body.latencyMs).toBe('number')
      expect(body.latencyMs).toBeGreaterThanOrEqual(0)
    })

    it('retorna { ok: false, status: 500 } cuando el endpoint responde 500', async () => {
      // Arrange
      mockExternalOk(500)
      const req = makeRequest({ endpoint_url: 'https://api.example.com/agent' })

      // Act
      const res = await POST(req)
      const body = await res.json()

      // Assert
      expect(res.status).toBe(200)          // nuestra API responde 200
      expect(body.ok).toBe(false)
      expect(body.status).toBe(500)
    })

    it('retorna { ok: false, status: 404 } cuando el endpoint responde 404', async () => {
      // Arrange
      mockExternalOk(404)
      const req = makeRequest({ endpoint_url: 'https://api.example.com/agent' })

      // Act
      const res = await POST(req)
      const body = await res.json()

      // Assert
      expect(body.ok).toBe(false)
      expect(body.status).toBe(404)
    })

    it('retorna { ok: false, error: "timeout" } cuando el fetch excede 5s', async () => {
      // Arrange — AbortError simula AbortController timeout
      mockFetchTimeout()
      const req = makeRequest({ endpoint_url: 'https://api.example.com/agent' })

      // Act
      const res = await POST(req)
      const body = await res.json()

      // Assert
      expect(res.status).toBe(200)
      expect(body.ok).toBe(false)
      expect(body.error).toBe('timeout')
    })

    it('retorna { ok: false, error: "unreachable" } cuando el fetch falla con error de red', async () => {
      // Arrange
      mockFetchUnreachable()
      const req = makeRequest({ endpoint_url: 'https://api.example.com/agent' })

      // Act
      const res = await POST(req)
      const body = await res.json()

      // Assert
      expect(res.status).toBe(200)
      expect(body.ok).toBe(false)
      expect(body.error).toBe('unreachable')
    })

    it('incluye latencyMs en respuestas de error de red', async () => {
      // Arrange
      mockFetchUnreachable()
      const req = makeRequest({ endpoint_url: 'https://api.example.com/agent' })

      // Act
      const res = await POST(req)
      const body = await res.json()

      // Assert
      expect(typeof body.latencyMs).toBe('number')
    })
  })

  // =========================================================================
  // Seguridad
  // =========================================================================
  describe('seguridad', () => {
    it('NO reenvía el body del endpoint externo en la respuesta', async () => {
      // Arrange — el endpoint externo devuelve datos "sensibles"
      mocks.fetch.mockResolvedValueOnce({
        status: 200,
        ok:     true,
        json:   vi.fn().mockResolvedValue({ secret_key: 'super-secret', data: 'sensitive' }),
        text:   vi.fn().mockResolvedValue('{"secret_key":"super-secret"}'),
      } as unknown as Response)

      const req = makeRequest({ endpoint_url: 'https://api.example.com/agent' })

      // Act
      const res = await POST(req)
      const body = await res.json()

      // Assert — solo claves permitidas en la respuesta
      expect(body).not.toHaveProperty('secret_key')
      expect(body).not.toHaveProperty('data')
      const allowedKeys = new Set(['ok', 'status', 'latencyMs', 'error'])
      for (const key of Object.keys(body)) {
        expect(allowedKeys).toContain(key)
      }
    })

    it('incluye Authorization header en la llamada al endpoint externo si auth_header está configurado', async () => {
      // Arrange
      const customAuthHeader = 'Bearer my-secret-api-key'
      mockExternalOk(200)
      const req = makeRequest({
        endpoint_url: 'https://api.example.com/agent',
        auth_header:  customAuthHeader,
      })

      // Act
      await POST(req)

      // Assert — fetch llamado con el Authorization header correcto
      expect(mocks.fetch).toHaveBeenCalledWith(
        'https://api.example.com/agent',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: customAuthHeader,
          }),
        }),
      )
    })

    it('NO incluye Authorization header si auth_header no está en el request', async () => {
      // Arrange
      mockExternalOk(200)
      const req = makeRequest({ endpoint_url: 'https://api.example.com/agent' })

      // Act
      await POST(req)

      // Assert
      const [, fetchOptions] = mocks.fetch.mock.calls[0] as [string, RequestInit & { headers?: Record<string, string> }]
      expect(fetchOptions?.headers).not.toHaveProperty('Authorization')
    })

    it('envía body { input: "test" } al endpoint externo (mismo patrón que invocación real)', async () => {
      // Arrange
      mockExternalOk(200)
      const req = makeRequest({ endpoint_url: 'https://api.example.com/agent' })

      // Act
      await POST(req)

      // Assert
      expect(mocks.fetch).toHaveBeenCalledWith(
        'https://api.example.com/agent',
        expect.objectContaining({
          method: 'POST',
          body:   JSON.stringify({ input: 'test' }),
        }),
      )
    })
  })

  // =========================================================================
  // Validación de body
  // =========================================================================
  describe('validación de body', () => {
    it('retorna 400 si endpoint_url está ausente', async () => {
      // Arrange
      const req = makeRequest({})

      // Act
      const res = await POST(req)

      // Assert
      expect(res.status).toBe(400)
    })

    it('retorna 400 si body no es JSON válido', async () => {
      // Arrange
      const req = new NextRequest('http://localhost/api/creator/test-endpoint', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    'not-json{{{',
      })

      // Act
      const res = await POST(req)

      // Assert
      expect(res.status).toBe(400)
    })
  })
})
