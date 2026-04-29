/**
 * proxy.test.ts — WKH-66 W3 unit tests for /api/v1/compose route.
 *
 * Cubre AC-1 (503 disabled), AC-11 (422 retry-mode), AC-2 (forward when delegated).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock env BEFORE importing route module (env is read at module load).
vi.mock('@/lib/env', () => ({
  env: {
    WASIAI_A2A_BASE_URL: 'http://a2a.local',
    WASIAI_V2_FORWARD_KEY: 'test-forward-key-1234567890abcd',
    V2_DELEGATE_TO_A2A: '',
  },
}))

// Mock forward-handler so we can flip the delegation flag per test.
const mockForwardRequest = vi.fn()
const mockIsDelegated = vi.fn<(_e: 'compose' | 'orchestrate' | 'capabilities' | 'mcp') => boolean>()

vi.mock('@/lib/proxy/forward-handler', () => ({
  isDelegated: (e: 'compose' | 'orchestrate' | 'capabilities' | 'mcp') => mockIsDelegated(e),
  forwardRequest: (...args: unknown[]) => mockForwardRequest(...args),
}))

import { POST } from '../route'

function makePost(body: string, contentType = 'application/json'): NextRequest {
  const init: RequestInit & { duplex?: 'half' } = {
    method: 'POST',
    headers: new Headers({ 'content-type': contentType }),
    body,
    duplex: 'half',
  }
  return new NextRequest('http://v2.local/api/v1/compose', init as RequestInit)
}

describe('POST /api/v1/compose — proxy mode', () => {
  beforeEach(() => {
    mockForwardRequest.mockReset()
    mockIsDelegated.mockReset()
  })

  it('AC-1: returns 503 COMPOSE_DISABLED when flag omits compose', async () => {
    mockIsDelegated.mockReturnValue(false)
    const req = makePost('{"steps":[]}')
    const res = await POST(req)
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('COMPOSE_DISABLED')
    expect(mockForwardRequest).not.toHaveBeenCalled()
  })

  it('AC-11: returns 422 RETRY_MODE_NOT_SUPPORTED when body has start_from_step', async () => {
    mockIsDelegated.mockReturnValue(true)
    const req = makePost(JSON.stringify({ steps: [], start_from_step: 2 }))
    const res = await POST(req)
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('RETRY_MODE_NOT_SUPPORTED')
    expect(mockForwardRequest).not.toHaveBeenCalled()
  })

  it('AC-2: forwards to a2a /compose when delegated and body has no retry mode', async () => {
    mockIsDelegated.mockReturnValue(true)
    const fakeResp = new Response('{"ok":true}', { status: 200 })
    mockForwardRequest.mockResolvedValue(fakeResp)
    const req = makePost(JSON.stringify({ steps: [{ agent_slug: 'foo' }] }))
    await POST(req)
    expect(mockForwardRequest).toHaveBeenCalledOnce()
    const [, upstreamUrl] = mockForwardRequest.mock.calls[0]
    expect(upstreamUrl).toBe('http://a2a.local/compose')
  })

  it('AC-11 boundary: explicit start_from_step=0 still triggers 422', async () => {
    mockIsDelegated.mockReturnValue(true)
    const req = makePost(JSON.stringify({ start_from_step: 0 }))
    const res = await POST(req)
    expect(res.status).toBe(422)
    expect(mockForwardRequest).not.toHaveBeenCalled()
  })

  it('non-JSON body still forwards (no false positive on retry detect)', async () => {
    mockIsDelegated.mockReturnValue(true)
    const fakeResp = new Response('', { status: 200 })
    mockForwardRequest.mockResolvedValue(fakeResp)
    const req = makePost('not json at all', 'text/plain')
    await POST(req)
    expect(mockForwardRequest).toHaveBeenCalledOnce()
  })
})
