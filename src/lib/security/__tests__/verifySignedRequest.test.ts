/**
 * TB-03 (audit 2026-06-30): unit tests for the HMAC signed-request replay
 * protection helper. Covers fail-closed paths (no secret, no Redis), timestamp
 * skew, signature/method/path binding, and single-use nonce.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const redisStore = new Map<string, string>()
const mocks = vi.hoisted(() => ({ redisSet: vi.fn() }))

vi.mock('@upstash/redis', () => ({
  Redis: class {
    set = mocks.redisSet
  },
}))

import {
  verifySignedRequest,
  signInternalRequest,
  SIGNED_REQUEST_HEADERS,
} from '@/lib/security/verifySignedRequest'

const SECRET = 'shared-internal-secret'
const PATH = '/api/v1/internal/escrow/release-expired'

function headersFrom(map: Record<string, string>) {
  return { get: (name: string) => map[name.toLowerCase()] ?? map[name] ?? null }
}

beforeEach(() => {
  vi.clearAllMocks()
  redisStore.clear()
  vi.stubEnv('INTERNAL_API_SECRET', SECRET)
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example')
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token')
  mocks.redisSet.mockImplementation((key: string, val: string, opts?: { nx?: boolean }) => {
    if (opts?.nx && redisStore.has(key)) return Promise.resolve(null)
    redisStore.set(key, val)
    return Promise.resolve('OK')
  })
})

afterEach(() => vi.unstubAllEnvs())

describe('verifySignedRequest', () => {
  it('fails closed (500) when INTERNAL_API_SECRET is unset', async () => {
    vi.stubEnv('INTERNAL_API_SECRET', '')
    const h = signInternalRequest('POST', PATH, SECRET)
    const res = await verifySignedRequest('POST', PATH, headersFrom(h))
    expect(res).toEqual({ ok: false, status: 500, reason: 'server_misconfigured' })
  })

  it('rejects (401) missing signed headers', async () => {
    const res = await verifySignedRequest('POST', PATH, headersFrom({}))
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe(401)
      expect(res.reason).toBe('missing_signed_headers')
    }
  })

  it('accepts a freshly signed request', async () => {
    const h = signInternalRequest('POST', PATH, SECRET)
    const res = await verifySignedRequest('POST', PATH, headersFrom(h))
    expect(res).toEqual({ ok: true })
  })

  it('rejects (401) an expired timestamp', async () => {
    const h = signInternalRequest('POST', PATH, SECRET)
    h[SIGNED_REQUEST_HEADERS.timestamp] = String(Math.floor(Date.now() / 1000) - 99_999)
    const res = await verifySignedRequest('POST', PATH, headersFrom(h))
    if (!res.ok) expect(res.reason).toBe('request_expired')
    else throw new Error('expected rejection')
  })

  it('rejects (401) a signature bound to a different path', async () => {
    const h = signInternalRequest('POST', '/api/other', SECRET)
    const res = await verifySignedRequest('POST', PATH, headersFrom(h))
    if (!res.ok) expect(res.reason).toBe('invalid_signature')
    else throw new Error('expected rejection')
  })

  it('rejects (401) a signature bound to a different method', async () => {
    const h = signInternalRequest('GET', PATH, SECRET)
    const res = await verifySignedRequest('POST', PATH, headersFrom(h))
    if (!res.ok) expect(res.reason).toBe('invalid_signature')
    else throw new Error('expected rejection')
  })

  it('burns the nonce: a replay of the same headers is rejected (401)', async () => {
    const h = signInternalRequest('POST', PATH, SECRET)
    const first = await verifySignedRequest('POST', PATH, headersFrom(h))
    expect(first).toEqual({ ok: true })
    const replay = await verifySignedRequest('POST', PATH, headersFrom(h))
    if (!replay.ok) expect(replay.reason).toBe('nonce_already_used')
    else throw new Error('expected replay rejection')
  })

  it('fails closed (500) when the nonce store (Redis) is unavailable', async () => {
    // Reset module state so the Redis singleton isn't reused from earlier tests.
    vi.resetModules()
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
    const fresh = await import('@/lib/security/verifySignedRequest')
    const h = fresh.signInternalRequest('POST', PATH, SECRET)
    const res = await fresh.verifySignedRequest('POST', PATH, headersFrom(h))
    if (!res.ok) expect(res.status).toBe(500)
    else throw new Error('expected fail-closed')
  })
})
