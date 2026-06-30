/**
 * V-12/V-13 (audit 2026-06-29): POST /api/v1/internal/escrow/release-expired
 * must verify the INTERNAL_API_SECRET bearer in constant time (timingSafeEqual
 * via safeBearerEqual). It fails-closed with 500 when the secret is unset and
 * 401 on mismatch — those response codes are preserved.
 *
 * The auth gate runs before any DB / on-chain access, so a rejected request
 * must never reach createServiceClient().
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  releaseExpiredOnChain: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: mocks.createServiceClient,
}))

vi.mock('@/lib/contracts/escrow', () => ({
  releaseExpiredOnChain: mocks.releaseExpiredOnChain,
}))

import { POST } from '@/app/api/v1/internal/escrow/release-expired/route'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('V-12/V-13: POST /api/v1/internal/escrow/release-expired INTERNAL_API_SECRET auth', () => {
  it('fails closed (500) when INTERNAL_API_SECRET is unset', async () => {
    vi.stubEnv('INTERNAL_API_SECRET', '')
    const request = new NextRequest('http://localhost/api/v1/internal/escrow/release-expired', {
      method: 'POST',
      headers: { Authorization: 'Bearer undefined' },
    })
    const res = await POST(request)
    expect(res.status).toBe(500)
    expect(mocks.createServiceClient).not.toHaveBeenCalled()
  })

  it('rejects (401) a wrong secret', async () => {
    vi.stubEnv('INTERNAL_API_SECRET', 'right-secret')
    const request = new NextRequest('http://localhost/api/v1/internal/escrow/release-expired', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-secret' },
    })
    const res = await POST(request)
    expect(res.status).toBe(401)
    expect(mocks.createServiceClient).not.toHaveBeenCalled()
  })

  it('rejects (401) a missing Authorization header', async () => {
    vi.stubEnv('INTERNAL_API_SECRET', 'right-secret')
    const request = new NextRequest('http://localhost/api/v1/internal/escrow/release-expired', {
      method: 'POST',
    })
    const res = await POST(request)
    expect(res.status).toBe(401)
    expect(mocks.createServiceClient).not.toHaveBeenCalled()
  })

  it('passes the auth gate on the exact Bearer <secret> (reaches DB layer)', async () => {
    vi.stubEnv('INTERNAL_API_SECRET', 'right-secret')
    // No expired escrows → handler returns { released: 0 } after the gate,
    // proving the constant-time compare matched.
    mocks.createServiceClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            lt: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    })
    const request = new NextRequest('http://localhost/api/v1/internal/escrow/release-expired', {
      method: 'POST',
      headers: { Authorization: 'Bearer right-secret' },
    })
    const res = await POST(request)
    expect(res.status).toBe(200)
    expect(mocks.createServiceClient).toHaveBeenCalledOnce()
    expect(mocks.releaseExpiredOnChain).not.toHaveBeenCalled()
  })
})
