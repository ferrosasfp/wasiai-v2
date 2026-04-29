/**
 * proxy.test.ts — TD-LIGHT (CR Nit-5) explicit unit tests for /api/v1/orchestrate.
 *
 * Antes de este archivo, la cobertura de orchestrate venía indirecta vía el
 * helper compose.test.ts. Este test cubre el flag de delegación específico de
 * orchestrate (AC-13) + el forward al endpoint /orchestrate del upstream.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/env', () => ({
  env: {
    WASIAI_A2A_BASE_URL: 'http://a2a.local',
    WASIAI_V2_FORWARD_KEY: 'test-forward-key-1234567890abcd',
    V2_DELEGATE_TO_A2A: '',
  },
}))

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
  return new NextRequest('http://v2.local/api/v1/orchestrate', init as RequestInit)
}

describe('POST /api/v1/orchestrate — proxy mode', () => {
  beforeEach(() => {
    mockForwardRequest.mockReset()
    mockIsDelegated.mockReset()
  })

  it('returns 503 ORCHESTRATE_DISABLED when flag omits orchestrate (AC-1 analog)', async () => {
    mockIsDelegated.mockReturnValue(false)
    const req = makePost(JSON.stringify({ goal: 'hi' }))
    const res = await POST(req)
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('ORCHESTRATE_DISABLED')
    expect(mockForwardRequest).not.toHaveBeenCalled()
  })

  it('forwards to a2a /orchestrate when delegated', async () => {
    mockIsDelegated.mockReturnValue(true)
    const fakeResp = new Response('{"plan":[]}', { status: 200 })
    mockForwardRequest.mockResolvedValue(fakeResp)
    const req = makePost(JSON.stringify({ goal: 'analyze BTC' }))
    await POST(req)
    expect(mockForwardRequest).toHaveBeenCalledOnce()
    const [, upstreamUrl] = mockForwardRequest.mock.calls[0]
    expect(upstreamUrl).toBe('http://a2a.local/orchestrate')
  })

  it('isDelegated guard receives the orchestrate token (not compose)', async () => {
    mockIsDelegated.mockReturnValue(true)
    mockForwardRequest.mockResolvedValue(new Response('', { status: 200 }))
    const req = makePost(JSON.stringify({ goal: 'x' }))
    await POST(req)
    expect(mockIsDelegated).toHaveBeenCalledWith('orchestrate')
  })
})
