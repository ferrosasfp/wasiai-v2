/**
 * V-12/V-13 (audit 2026-06-29): POST /api/v1/jobs/process/[id] must verify the
 * JOB_PROCESSOR_SECRET bearer in constant time (timingSafeEqual via
 * safeBearerEqual) and fail-closed (401) when the secret is unset.
 *
 * The auth gate runs before any DB access, so a rejected request must never
 * reach createServiceClient().
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: mocks.createServiceClient,
}))

vi.mock('@/lib/webhooks/triggerAgentEvent', () => ({
  triggerAgentEvent: vi.fn(),
}))

vi.mock('@/lib/security/validateEndpointUrl', () => ({
  validateEndpointUrlAsync: vi.fn(),
}))

import { POST } from '@/app/api/v1/jobs/process/[id]/route'

const params = Promise.resolve({ id: 'job-1' })

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('V-12/V-13: POST /api/v1/jobs/process/[id] JOB_PROCESSOR_SECRET auth', () => {
  it('fails closed (401) when JOB_PROCESSOR_SECRET is unset — even with a "Bearer undefined" header', async () => {
    vi.stubEnv('JOB_PROCESSOR_SECRET', '')
    const request = new NextRequest('http://localhost/api/v1/jobs/process/job-1', {
      method: 'POST',
      headers: { authorization: 'Bearer undefined' },
    })
    const res = await POST(request, { params })
    expect(res.status).toBe(401)
    // No DB access on the rejected path.
    expect(mocks.createServiceClient).not.toHaveBeenCalled()
  })

  it('rejects (401) a wrong secret', async () => {
    vi.stubEnv('JOB_PROCESSOR_SECRET', 'right-secret')
    const request = new NextRequest('http://localhost/api/v1/jobs/process/job-1', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong-secret' },
    })
    const res = await POST(request, { params })
    expect(res.status).toBe(401)
    expect(mocks.createServiceClient).not.toHaveBeenCalled()
  })

  it('rejects (401) a missing Authorization header', async () => {
    vi.stubEnv('JOB_PROCESSOR_SECRET', 'right-secret')
    const request = new NextRequest('http://localhost/api/v1/jobs/process/job-1', {
      method: 'POST',
    })
    const res = await POST(request, { params })
    expect(res.status).toBe(401)
    expect(mocks.createServiceClient).not.toHaveBeenCalled()
  })

  it('passes the auth gate on the exact Bearer <secret> (reaches DB layer)', async () => {
    vi.stubEnv('JOB_PROCESSOR_SECRET', 'right-secret')
    // Make the job lookup return not-found so the handler short-circuits at 404,
    // proving the constant-time compare matched and the gate was cleared.
    mocks.createServiceClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: null, error: { message: 'not found' } }),
          }),
        }),
      }),
    })
    const request = new NextRequest('http://localhost/api/v1/jobs/process/job-1', {
      method: 'POST',
      headers: { authorization: 'Bearer right-secret' },
    })
    const res = await POST(request, { params })
    expect(res.status).toBe(404)
    expect(mocks.createServiceClient).toHaveBeenCalledOnce()
  })
})
