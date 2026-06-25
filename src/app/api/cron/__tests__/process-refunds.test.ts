/**
 * V6 — process-refunds cron auth + delegation tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  runRefunds: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({})),
}))
vi.mock('@/lib/settlement/runRefunds', () => ({ runRefunds: mocks.runRefunds }))
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { GET } from '../process-refunds/route'

const CRON_SECRET = 'test-cron-secret'

function makeRequest(authHeader?: string): NextRequest {
  return new NextRequest('http://localhost/api/cron/process-refunds', {
    method:  'GET',
    headers: authHeader ? { authorization: authHeader } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = CRON_SECRET
  mocks.runRefunds.mockResolvedValue({ refunded: 0, results: [] })
})

describe('process-refunds cron', () => {
  it('401 when CRON_SECRET mismatches', async () => {
    const res = await GET(makeRequest('Bearer wrong'))
    expect(res.status).toBe(401)
    expect(mocks.runRefunds).not.toHaveBeenCalled()
  })

  it('401 when no auth header', async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('500 when CRON_SECRET not configured', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`))
    expect(res.status).toBe(500)
  })

  it('200 ok and delegates to runRefunds when authorized', async () => {
    mocks.runRefunds.mockResolvedValue({
      refunded: 2,
      results: [
        { id: 'r1', refundTxHash: '0xa' },
        { id: 'r2', refundTxHash: '0xb' },
      ],
    })
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.refunded).toBe(2)
    expect(mocks.runRefunds).toHaveBeenCalledTimes(1)
  })
})
