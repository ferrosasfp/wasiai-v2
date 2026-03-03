/**
 * Tests — NA-004: Rate limiter fail-closed when Upstash unavailable
 * Verifica que checkRateLimit y checkCreatorRateLimits retornan 503
 * cuando Upstash no está disponible, en lugar de fail-open.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @upstash/ratelimit y @upstash/redis ANTES de importar ratelimit.ts
// ---------------------------------------------------------------------------
const mockLimit = vi.fn()

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: Object.assign(
    vi.fn().mockImplementation(() => ({ limit: mockLimit })),
    { slidingWindow: vi.fn().mockReturnValue('sliding-window') },
  ),
}))

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn().mockImplementation(() => ({})),
}))

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

// ---------------------------------------------------------------------------
// Import DESPUÉS de mocks
// ---------------------------------------------------------------------------
import { checkRateLimit, checkCreatorRateLimits, getInvokeLimit, getCreatorRpmLimit, getCreatorRpdLimit } from '@/lib/ratelimit'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeNextResponse(status: number, headers?: Record<string, string>) {
  // Simular NextResponse — en tests retorna objeto plano mockeado
  return { status, headers: headers ?? {} }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkRateLimit — fail-closed (NA-004)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('AC2: retorna 503 + Retry-After:60 cuando Upstash lanza excepción', async () => {
    mockLimit.mockRejectedValueOnce(new Error('Upstash connection refused'))
    const limiter = getInvokeLimit()
    const response = await checkRateLimit(limiter, 'test-identifier')

    expect(response).not.toBeNull()
    const json = await response!.json()
    expect(response!.status).toBe(503)
    expect(json.code).toBe('rate_limit_unavailable')
    expect(response!.headers.get('Retry-After')).toBe('60')
  })

  it('AC3: retorna null cuando Upstash está disponible y no excede límite', async () => {
    mockLimit.mockResolvedValueOnce({ success: true, limit: 60, reset: Date.now() + 60000, remaining: 59 })
    const limiter = getInvokeLimit()
    const response = await checkRateLimit(limiter, 'test-identifier')
    expect(response).toBeNull()
  })

  it('AC3: retorna 429 cuando excede límite (no regresión)', async () => {
    const reset = Date.now() + 30000
    mockLimit.mockResolvedValueOnce({ success: false, limit: 60, reset, remaining: 0 })
    const limiter = getInvokeLimit()
    const response = await checkRateLimit(limiter, 'test-identifier')

    expect(response).not.toBeNull()
    expect(response!.status).toBe(429)
    const json = await response!.json()
    expect(json.code).toBe('rate_limited')
  })
})

describe('checkCreatorRateLimits — fail-closed (NA-004)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('AC1: retorna 503 + Retry-After:60 cuando Upstash lanza excepción en RPM', async () => {
    mockLimit.mockRejectedValueOnce(new Error('Redis timeout'))
    const response = await checkCreatorRateLimits('test-slug', 60, 1000, 'test-slug:key123')

    expect(response).not.toBeNull()
    expect(response!.status).toBe(503)
    const json = await response!.json()
    expect(json.code).toBe('rate_limit_unavailable')
    expect(response!.headers.get('Retry-After')).toBe('60')
  })

  it('AC3: retorna null cuando RPM y RPD están OK (no regresión)', async () => {
    const reset = Date.now() + 60000
    mockLimit
      .mockResolvedValueOnce({ success: true, limit: 60,   reset, remaining: 59 }) // RPM
      .mockResolvedValueOnce({ success: true, limit: 1000, reset, remaining: 999 }) // RPD
    const response = await checkCreatorRateLimits('test-slug', 60, 1000, 'test-slug:key123')
    expect(response).toBeNull()
  })

  it('AC3: retorna 429 cuando excede RPM (no regresión)', async () => {
    const reset = Date.now() + 30000
    mockLimit.mockResolvedValueOnce({ success: false, limit: 60, reset, remaining: 0 })
    const response = await checkCreatorRateLimits('test-slug', 60, 1000, 'test-slug:key123')

    expect(response).not.toBeNull()
    expect(response!.status).toBe(429)
    const json = await response!.json()
    expect(json.code).toBe('rate_limited')
  })
})
