/**
 * V-09 (audit 2026-06-25): POST /api/admin/upload must require an EIP-712 admin
 * signature (was: any authenticated user) and must reject arbitrary buckets
 * (the bucket name arrived from untrusted formData).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyAdminSignature: vi.fn(),
  upload: vi.fn(),
  getPublicUrl: vi.fn(),
}))

vi.mock('@/lib/admin/verifyAdminSignature', () => ({
  verifyAdminSignature: mocks.verifyAdminSignature,
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: mocks.upload,
        getPublicUrl: mocks.getPublicUrl,
      })),
    },
  })),
}))

import { POST } from '@/app/api/admin/upload/route'

function signedHeaders(): Record<string, string> {
  return {
    'x-admin-signature': '0x' + 'a'.repeat(130),
    'x-admin-nonce':     '0x' + '0'.repeat(64),
    'x-admin-timestamp': String(Math.floor(Date.now() / 1000)),
  }
}

function makeReq(headers: Record<string, string>, fields: Record<string, string | File>): NextRequest {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  // jsdom/undici can't parse a multipart body via request.formData() here, so we
  // build a header-only NextRequest and stub formData() to return the FormData.
  const req = new NextRequest('http://localhost/api/admin/upload', { method: 'POST', headers })
  Object.defineProperty(req, 'formData', { value: async () => fd, configurable: true })
  return req
}

function pngFile(): File {
  return new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.upload.mockResolvedValue({ error: null })
  mocks.getPublicUrl.mockReturnValue({ data: { publicUrl: 'https://cdn/x.png' } })
})

describe('V-09: POST /api/admin/upload', () => {
  it('returns 401 without EIP-712 signature (no upload happens)', async () => {
    const res = await POST(makeReq({}, { file: pngFile() }))
    expect(res.status).toBe(401)
    expect(mocks.verifyAdminSignature).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('rejects an arbitrary bucket (400) even with a valid signature', async () => {
    mocks.verifyAdminSignature.mockResolvedValue({ ok: true })
    const res = await POST(makeReq(signedHeaders(), { file: pngFile(), bucket: 'secrets' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'Invalid bucket' })
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('accepts an allow-listed bucket with a valid signature', async () => {
    mocks.verifyAdminSignature.mockResolvedValue({ ok: true })
    const res = await POST(makeReq(signedHeaders(), { file: pngFile(), bucket: 'collections' }))
    expect(res.status).toBe(200)
    expect(mocks.upload).toHaveBeenCalledOnce()
  })
})
