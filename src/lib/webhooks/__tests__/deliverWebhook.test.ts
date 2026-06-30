/**
 * deliverWebhook.test.ts — V-06 (audit 2026-06-25)
 *
 * `deliverWebhook` POSTed to a DB-stored URL with a plain `fetch` and no
 * delivery-time SSRF validation (followed redirects to internal IPs). The fix
 * routes delivery through `fetchPinned`, which validates the URL at delivery
 * time and connects to the validated IP with the hostname pinned (no DNS
 * re-resolution, no redirect-follow). These tests assert delivery goes through
 * fetchPinned and that an SSRF rejection fails closed (no exception leaks).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ fetchPinnedFn: vi.fn(), fetchFn: vi.fn() }))

vi.mock('@/lib/security/fetchPinned', () => {
  class EndpointValidationError extends Error {
    constructor(message: string) { super(message); this.name = 'EndpointValidationError' }
  }
  return {
    fetchPinned: (...args: unknown[]) => mocks.fetchPinnedFn(...args),
    EndpointValidationError,
  }
})

vi.stubGlobal('fetch', mocks.fetchFn)

import { deliverWebhook } from '@/lib/webhooks/deliverWebhook'
import { EndpointValidationError } from '@/lib/security/fetchPinned'

const PAYLOAD = { event: 'agent.created', timestamp: '2026-06-25T00:00:00Z', data: { id: 'a1' } }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('V-06 deliverWebhook SSRF hardening', () => {
  it('delivers via fetchPinned (IP-pinned), never via global fetch', async () => {
    mocks.fetchPinnedFn.mockResolvedValueOnce({ ok: true, status: 200 } as Response)

    const res = await deliverWebhook('https://hooks.example.com/wh', 'secret', PAYLOAD)

    expect(res).toEqual({ success: true, statusCode: 200 })
    expect(mocks.fetchPinnedFn).toHaveBeenCalledTimes(1)
    expect(mocks.fetchPinnedFn).toHaveBeenCalledWith(
      'https://hooks.example.com/wh',
      expect.objectContaining({ method: 'POST', timeoutMs: 10_000 }),
    )
    // HMAC signature header is computed and forwarded.
    const init = mocks.fetchPinnedFn.mock.calls[0][1] as { headers: Record<string, string> }
    expect(init.headers['X-WasiAI-Signature']).toMatch(/^sha256=/)
    expect(mocks.fetchFn).not.toHaveBeenCalled()
  })

  it('fails closed on SSRF rejection (EndpointValidationError → success:false, no throw)', async () => {
    mocks.fetchPinnedFn.mockRejectedValueOnce(
      new EndpointValidationError('resolved to private IP 169.254.169.254'),
    )

    const res = await deliverWebhook('https://rebind.example.com', 'secret', PAYLOAD)

    expect(res.success).toBe(false)
    expect(res.error).toContain('private IP')
    expect(res.statusCode).toBeUndefined()
    expect(mocks.fetchFn).not.toHaveBeenCalled()
  })

  it('reports a non-ok upstream status without throwing', async () => {
    mocks.fetchPinnedFn.mockResolvedValueOnce({ ok: false, status: 503 } as Response)

    const res = await deliverWebhook('https://hooks.example.com/wh', 'secret', PAYLOAD)

    expect(res).toEqual({ success: false, statusCode: 503 })
  })
})
