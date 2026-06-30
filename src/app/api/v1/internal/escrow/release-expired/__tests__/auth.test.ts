/**
 * TB-03 (audit 2026-06-30): POST /api/v1/internal/escrow/release-expired
 * triggers an operator-signed on-chain action (releaseExpired). It must be
 * gated by an HMAC signed request with a fresh timestamp + single-use nonce
 * (replay protection), NOT a replayable static bearer.
 *
 * These tests assert:
 *  - fail-closed 500 when INTERNAL_API_SECRET is unset,
 *  - 401 on missing signed headers,
 *  - 401 on an expired timestamp,
 *  - 401 on a REPLAYED nonce (the core replay-protection guarantee),
 *  - 200 on a fresh valid signed request (reaches the DB layer).
 *
 * The auth gate runs before any DB / on-chain access, so a rejected request
 * must never reach createServiceClient().
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { signInternalRequest } from '@/lib/security/verifySignedRequest'

const ROUTE_PATH = '/api/v1/internal/escrow/release-expired'
const SECRET = 'right-secret'

// In-memory Redis stub implementing SET NX EX semantics used by verifySignedRequest.
const redisStore = new Map<string, string>()
const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  releaseExpiredOnChain: vi.fn(),
  redisSet: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: mocks.createServiceClient,
}))
vi.mock('@/lib/contracts/escrow', () => ({
  releaseExpiredOnChain: mocks.releaseExpiredOnChain,
}))
vi.mock('@upstash/redis', () => ({
  Redis: class {
    set = mocks.redisSet
  },
}))

import { POST } from '@/app/api/v1/internal/escrow/release-expired/route'

function makeSignedRequest(headers: Record<string, string>): NextRequest {
  return new NextRequest(`http://localhost${ROUTE_PATH}`, {
    method: 'POST',
    headers,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  redisStore.clear()
  vi.stubEnv('INTERNAL_API_SECRET', SECRET)
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example')
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token')
  // SET NX EX: claim the key only if absent; return null if it already exists.
  mocks.redisSet.mockImplementation((key: string, val: string, opts?: { nx?: boolean }) => {
    if (opts?.nx && redisStore.has(key)) return Promise.resolve(null)
    redisStore.set(key, val)
    return Promise.resolve('OK')
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('TB-03: release-expired signed-request replay protection', () => {
  it('fails closed (500) when INTERNAL_API_SECRET is unset', async () => {
    vi.stubEnv('INTERNAL_API_SECRET', '')
    const res = await POST(makeSignedRequest({}))
    expect(res.status).toBe(500)
    expect(mocks.createServiceClient).not.toHaveBeenCalled()
  })

  it('rejects (401) a request with no signed headers', async () => {
    const res = await POST(makeSignedRequest({}))
    expect(res.status).toBe(401)
    expect(mocks.createServiceClient).not.toHaveBeenCalled()
  })

  it('rejects (401) an expired timestamp', async () => {
    const headers = signInternalRequest('POST', ROUTE_PATH, SECRET)
    headers['x-internal-timestamp'] = String(Math.floor(Date.now() / 1000) - 10_000)
    const res = await POST(makeSignedRequest(headers))
    expect(res.status).toBe(401)
    expect(mocks.createServiceClient).not.toHaveBeenCalled()
  })

  it('rejects (401) a tampered signature', async () => {
    const headers = signInternalRequest('POST', ROUTE_PATH, SECRET)
    headers['x-internal-signature'] = 'deadbeef'.repeat(8)
    const res = await POST(makeSignedRequest(headers))
    expect(res.status).toBe(401)
    expect(mocks.createServiceClient).not.toHaveBeenCalled()
  })

  it('rejects (401) a REPLAYED request (same nonce twice)', async () => {
    mocks.createServiceClient.mockReturnValue({
      from: () => ({
        select: () => ({ eq: () => ({ lt: () => Promise.resolve({ data: [], error: null }) }) }),
      }),
    })
    const headers = signInternalRequest('POST', ROUTE_PATH, SECRET)

    const first = await POST(makeSignedRequest(headers))
    expect(first.status).toBe(200)

    // Exact same headers (captured request) replayed → nonce already used.
    const replay = await POST(makeSignedRequest(headers))
    expect(replay.status).toBe(401)
  })

  it('accepts (200) a fresh valid signed request and reaches the DB layer', async () => {
    mocks.createServiceClient.mockReturnValue({
      from: () => ({
        select: () => ({ eq: () => ({ lt: () => Promise.resolve({ data: [], error: null }) }) }),
      }),
    })
    const headers = signInternalRequest('POST', ROUTE_PATH, SECRET)
    const res = await POST(makeSignedRequest(headers))
    expect(res.status).toBe(200)
    expect(mocks.createServiceClient).toHaveBeenCalledOnce()
    expect(mocks.releaseExpiredOnChain).not.toHaveBeenCalled()
  })
})
