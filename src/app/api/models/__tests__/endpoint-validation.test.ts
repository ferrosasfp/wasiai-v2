/**
 * V-10 (audit 2026-06-25): POST /api/models persists endpoint_url, so it must
 * use the DNS-aware async validator (validateEndpointUrlAsync) — which resolves
 * the hostname and rejects private/internal IPs — rather than the sync
 * validator that only blocks literal IPs/hostnames. A rejection → 422 and the
 * row is never inserted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  validateEndpointUrl: vi.fn(),
  validateEndpointUrlAsync: vi.fn(),
  insert: vi.fn(),
  ensureCreatorProfile: vi.fn(),
  validateCsrf: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: vi.fn(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: () => mocks.insert(),
        })),
      })),
    })),
  })),
}))

vi.mock('@/lib/security/validateEndpointUrl', () => ({
  validateEndpointUrl: mocks.validateEndpointUrl,
  validateEndpointUrlAsync: mocks.validateEndpointUrlAsync,
}))

vi.mock('@/lib/security/csrf', () => ({
  validateCsrf: (...a: unknown[]) => mocks.validateCsrf(...a),
}))

vi.mock('@/lib/ensureCreatorProfile', () => ({
  ensureCreatorProfile: (...a: unknown[]) => mocks.ensureCreatorProfile(...a),
}))

import { POST } from '@/app/api/models/route'

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const VALID_BODY = {
  name: 'My Agent',
  category: 'nlp',
  endpoint_url: 'https://agent.example.com/invoke',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.validateCsrf.mockReturnValue(null)
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  mocks.ensureCreatorProfile.mockResolvedValue(undefined)
  mocks.insert.mockResolvedValue({ data: { id: 'agent-1', slug: 'my-agent' }, error: null })
})

describe('V-10: POST /api/models endpoint_url validation', () => {
  it('uses the async DNS-aware validator (not the sync one) and inserts on success', async () => {
    mocks.validateEndpointUrlAsync.mockResolvedValue('203.0.113.10') // public IP
    const res = await POST(makeReq(VALID_BODY))
    expect(res.status).toBe(201)
    expect(mocks.validateEndpointUrlAsync).toHaveBeenCalledWith(VALID_BODY.endpoint_url)
    expect(mocks.validateEndpointUrl).not.toHaveBeenCalled()
  })

  it('rejects (422) when the hostname resolves to a private IP — row NOT inserted', async () => {
    mocks.validateEndpointUrlAsync.mockRejectedValue(new Error('resolves to private IP 10.0.0.5'))
    const res = await POST(makeReq(VALID_BODY))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body).toMatchObject({ code: 'invalid_endpoint_url' })
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})
