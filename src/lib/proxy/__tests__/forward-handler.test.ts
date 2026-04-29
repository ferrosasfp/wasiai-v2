/**
 * forward-handler.test.ts — WKH-66 W1 unit tests.
 * Cubre AC-2, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-13.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock env BEFORE importing the helper (helper reads env at module load)
vi.mock('@/lib/env', () => ({
  env: {
    WASIAI_A2A_BASE_URL: 'http://a2a.local',
    WASIAI_V2_FORWARD_KEY: 'test-forward-key-1234567890abcd',
    V2_DELEGATE_TO_A2A: 'compose,orchestrate,capabilities',
    NODE_ENV: 'test',
  },
}))

import { forwardRequest, isDelegated, parseDelegatedEndpoints } from '../forward-handler'

describe('parseDelegatedEndpoints', () => {
  it('returns empty Set when raw is undefined or blank', () => {
    expect(parseDelegatedEndpoints(undefined).size).toBe(0)
    expect(parseDelegatedEndpoints('').size).toBe(0)
    expect(parseDelegatedEndpoints('   ').size).toBe(0)
  })

  it('trims and lowercases entries', () => {
    const out = parseDelegatedEndpoints('  Compose ,orchestrate  ')
    expect(out.has('compose')).toBe(true)
    expect(out.has('orchestrate')).toBe(true)
    expect(out.size).toBe(2)
  })

  it('drops empty tokens caused by trailing commas', () => {
    const out = parseDelegatedEndpoints('compose,,orchestrate,')
    expect(out.size).toBe(2)
  })
})

describe('isDelegated', () => {
  it('returns true for endpoints in flag', () => {
    expect(isDelegated('compose')).toBe(true)
    expect(isDelegated('orchestrate')).toBe(true)
    expect(isDelegated('capabilities')).toBe(true)
  })
  it('AC-13: returns false for endpoints not in flag (mcp omitted)', () => {
    expect(isDelegated('mcp')).toBe(false)
  })
})

describe('forwardRequest', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function makeReq(
    method: 'GET' | 'POST',
    headers: Record<string, string> = {},
    body?: string,
    url = 'http://v2.local/api/v1/compose',
  ): NextRequest {
    const init: RequestInit & { duplex?: string } = {
      method,
      headers: new Headers(headers),
    }
    if (body !== undefined) {
      init.body = body
      init.duplex = 'half'
    }
    return new NextRequest(url, init as RequestInit)
  }

  it('AC-2: forwards POST to upstream with method preserved', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }) as unknown as Response,
    )
    const req = makeReq('POST', { 'content-type': 'application/json' }, '{"a":1}')
    const res = await forwardRequest(req, 'http://a2a.local/compose')
    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, opts] = fetchSpy.mock.calls[0]
    expect(url).toBe('http://a2a.local/compose')
    expect((opts as RequestInit).method).toBe('POST')
  })

  it('AC-5: injects x-wasiai-forward-key + x-wasiai-source', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 200 }) as unknown as Response,
    )
    const req = makeReq('POST', { 'content-type': 'application/json' })
    await forwardRequest(req, 'http://a2a.local/compose')
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['x-wasiai-forward-key']).toBe('test-forward-key-1234567890abcd')
    expect(headers['x-wasiai-source']).toBe('v2-proxy')
  })

  it('AC-6: passes through whitelist headers when present', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 200 }) as unknown as Response,
    )
    const req = makeReq('POST', {
      'x-payment': 'sig-abc',
      'x-a2a-key': 'k-xyz',
      'authorization': 'Bearer foo',
    })
    await forwardRequest(req, 'http://a2a.local/compose')
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['x-payment']).toBe('sig-abc')
    expect(headers['x-a2a-key']).toBe('k-xyz')
    expect(headers['authorization']).toBe('Bearer foo')
  })

  // AR MNR-1 (TD-LIGHT): el lookup del whitelist usa NextRequest.headers.get
  // que es case-insensitive por la spec de Fetch Headers. Este test paramétrico
  // garantiza que cualquier casing del cliente se propaga al upstream con el
  // nombre canónico (lowercase) que la whitelist usa.
  it.each([
    ['lowercase', 'x-payment'],
    ['TitleCase', 'X-Payment'],
    ['UPPERCASE', 'X-PAYMENT'],
  ])('AR MNR-1: header casing %s — x-payment is forwarded regardless of casing', async (_label, headerName) => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 200 }) as unknown as Response,
    )
    const req = makeReq('POST', { [headerName]: 'sig-from-client' })
    await forwardRequest(req, 'http://a2a.local/compose')
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['x-payment']).toBe('sig-from-client')
  })

  it('AC-7: does NOT forward host/origin/cookie', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('', { status: 200 }) as unknown as Response,
    )
    const req = makeReq('POST', {
      host: 'attacker.com',
      origin: 'https://evil.test',
      cookie: 'sess=abc',
    })
    await forwardRequest(req, 'http://a2a.local/compose')
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['host']).toBeUndefined()
    expect(headers['origin']).toBeUndefined()
    expect(headers['cookie']).toBeUndefined()
  })

  it('AC-8: 402 passthrough body intact', async () => {
    const upstreamBody = '{"x402":{"price":"0.10"}}'
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(upstreamBody, {
        status: 402,
        headers: { 'content-type': 'application/json' },
      }) as unknown as Response,
    )
    const req = makeReq('POST')
    const res = await forwardRequest(req, 'http://a2a.local/compose')
    expect(res.status).toBe(402)
    expect(await res.text()).toBe(upstreamBody)
  })

  it('AC-9: 5xx upstream maps to 502 UPSTREAM_ERROR', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"error":"db down"}', {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }) as unknown as Response,
    )
    const req = makeReq('POST')
    const res = await forwardRequest(req, 'http://a2a.local/compose')
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: string; detail: string }
    expect(body.error).toBe('UPSTREAM_ERROR')
    expect(body.detail).toBe('db down')
  })

  it('AC-10: timeout returns 504 GATEWAY_TIMEOUT and clearTimeout fires', async () => {
    vi.useFakeTimers()
    const clearSpy = vi.spyOn(global, 'clearTimeout')
    vi.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      return new Promise<Response>((_, reject) => {
        const sig = (init as RequestInit | undefined)?.signal
        sig?.addEventListener('abort', () => {
          const e = new DOMException('aborted', 'AbortError')
          reject(e)
        })
      })
    })

    const req = makeReq('POST')
    const promise = forwardRequest(req, 'http://a2a.local/compose', { timeoutMs: 100 })
    await vi.advanceTimersByTimeAsync(150)
    const res = await promise
    expect(res.status).toBe(504)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('GATEWAY_TIMEOUT')
    expect(clearSpy).toHaveBeenCalled()
  })

  it('AC-4: GET capabilities forwards query params', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"agents":[]}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }) as unknown as Response,
    )
    const req = new NextRequest('http://v2.local/api/v1/capabilities?tag=defi&limit=5', {
      method: 'GET',
    })
    await forwardRequest(req, 'http://a2a.local/discover')
    const url = fetchSpy.mock.calls[0][0] as string
    expect(url).toContain('tag=defi')
    expect(url).toContain('limit=5')
  })

  it('non-AbortError exceptions still return 502 and clearTimeout fires', async () => {
    const clearSpy = vi.spyOn(global, 'clearTimeout')
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    const req = makeReq('POST')
    const res = await forwardRequest(req, 'http://a2a.local/compose')
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: string; detail: string }
    expect(body.error).toBe('UPSTREAM_ERROR')
    expect(clearSpy).toHaveBeenCalled()
  })

  // AR MNR-4 (TD-LIGHT): en NODE_ENV=test/dev exponemos String(err) para debug.
  // En production retornamos detail genérico. Como el módulo env se importa
  // una sola vez, mutamos el campo NODE_ENV del mock en runtime.
  it('AR MNR-4: in production NODE_ENV, error detail is generic (no leak)', async () => {
    const envMod = await import('@/lib/env')
    const original = envMod.env.NODE_ENV
    ;(envMod.env as { NODE_ENV: string }).NODE_ENV = 'production'
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5:6543'))
      const req = makeReq('POST')
      const res = await forwardRequest(req, 'http://a2a.local/compose')
      expect(res.status).toBe(502)
      const body = (await res.json()) as { error: string; detail: string }
      expect(body.error).toBe('UPSTREAM_ERROR')
      expect(body.detail).toBe('upstream connection failed')
      expect(body.detail).not.toContain('ECONNREFUSED')
      expect(body.detail).not.toContain('10.0.0.5')
      expect(consoleSpy).toHaveBeenCalled()
    } finally {
      ;(envMod.env as { NODE_ENV: string | undefined }).NODE_ENV = original
      consoleSpy.mockRestore()
    }
  })
})
