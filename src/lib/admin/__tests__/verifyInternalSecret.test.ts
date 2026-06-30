/**
 * verifyInternalSecret.test.ts — V-12 (audit 2026-06-25)
 *
 * The provided header used to be compared with `provided !== secret` (timing
 * side-channel). The fix uses a length-guarded timingSafeEqual. These tests
 * lock the auth contract: 500 when unset, 401 on wrong/missing, null on match.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { verifyInternalSecret } from '@/lib/admin/verifyInternalSecret'

afterEach(() => {
  vi.unstubAllEnvs()
})

function req(secretHeader?: string): NextRequest {
  const headers: Record<string, string> = {}
  if (secretHeader !== undefined) headers['x-internal-secret'] = secretHeader
  return new NextRequest('http://localhost/api/v1/agents-internal/x', { headers })
}

describe('verifyInternalSecret (V-12 constant-time)', () => {
  it('returns 500 when INTERNAL_API_SECRET is unset', async () => {
    vi.stubEnv('INTERNAL_API_SECRET', '')
    const res = verifyInternalSecret(req('whatever'))
    expect(res?.status).toBe(500)
  })

  it('returns 401 on a wrong secret', async () => {
    vi.stubEnv('INTERNAL_API_SECRET', 'right')
    const res = verifyInternalSecret(req('wrong'))
    expect(res?.status).toBe(401)
  })

  it('returns 401 on a missing header', async () => {
    vi.stubEnv('INTERNAL_API_SECRET', 'right')
    const res = verifyInternalSecret(req())
    expect(res?.status).toBe(401)
  })

  it('returns 401 on equal-length mismatch (length guard path)', async () => {
    vi.stubEnv('INTERNAL_API_SECRET', 'aaaaa')
    const res = verifyInternalSecret(req('bbbbb'))
    expect(res?.status).toBe(401)
  })

  it('returns null (authorized) on exact match', async () => {
    vi.stubEnv('INTERNAL_API_SECRET', 'right-secret')
    const res = verifyInternalSecret(req('right-secret'))
    expect(res).toBeNull()
  })
})
