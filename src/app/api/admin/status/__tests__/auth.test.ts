/**
 * V-08 (audit 2026-06-25): GET /api/admin/status must require an EIP-712 admin
 * signature. The handler previously had NO auth despite a JSDoc claiming it did,
 * exposing operator AVAX balance + settlement failure counts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyAdminSignature: vi.fn(),
  serviceFrom: vi.fn(),
  getPublicClient: vi.fn(),
}))

vi.mock('@/lib/admin/verifyAdminSignature', () => ({
  verifyAdminSignature: mocks.verifyAdminSignature,
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({ from: mocks.serviceFrom })),
}))

vi.mock('@/shared/lib/web3/client', () => ({
  getPublicClient: mocks.getPublicClient,
}))

import { GET } from '@/app/api/admin/status/route'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('V-08: GET /api/admin/status EIP-712 auth', () => {
  it('returns 401 without EIP-712 signature headers (verifyAdminSignature not even called)', async () => {
    const request = new NextRequest('http://localhost/api/admin/status')
    const res = await GET(request)
    expect(res.status).toBe(401)
    expect(mocks.verifyAdminSignature).not.toHaveBeenCalled()
    // No DB / on-chain access happened on the rejected path.
    expect(mocks.serviceFrom).not.toHaveBeenCalled()
    expect(mocks.getPublicClient).not.toHaveBeenCalled()
  })

  it('returns 401 when verifyAdminSignature rejects the signature', async () => {
    mocks.verifyAdminSignature.mockResolvedValue({ ok: false, reason: 'not_authorized' })
    const request = new NextRequest('http://localhost/api/admin/status', {
      headers: {
        'x-admin-signature': '0x' + 'a'.repeat(130),
        'x-admin-nonce':     '0x' + '0'.repeat(64),
        'x-admin-timestamp': String(Math.floor(Date.now() / 1000)),
      },
    })
    const res = await GET(request)
    expect(res.status).toBe(401)
    expect(mocks.verifyAdminSignature).toHaveBeenCalledOnce()
    expect(mocks.serviceFrom).not.toHaveBeenCalled()
  })
})
