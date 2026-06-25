/**
 * V3 (audit 2026-06-25) — DNS-rebinding TOCTOU.
 *
 * fetchPinned must:
 *   1. Resolve+validate the hostname (fail-closed on private/internal IPs).
 *   2. Connect to the VALIDATED IP — never re-resolve DNS at connect time —
 *      so an attacker cannot return a public IP at validation and 127.0.0.1 at
 *      connect to leak the Authorization bearer.
 *   3. Pin the original hostname as the Host header + TLS servername.
 *
 * We mock node:dns/promises (what validateResolvedIPs sees) and node:https
 * (to capture the host actually connected to + assert no bearer leak).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  dnsLookup:    vi.fn(),
  httpsRequest: vi.fn(),
}))

vi.mock('node:dns/promises', () => ({
  default: { lookup: mocks.dnsLookup },
  lookup:  mocks.dnsLookup,
}))

vi.mock('node:https', () => ({
  default: { request: mocks.httpsRequest },
  request: mocks.httpsRequest,
}))

import { fetchPinned, EndpointValidationError } from '@/lib/security/fetchPinned'

/**
 * Fake https.request that immediately returns a 200 with an empty body and
 * records the options it was called with.
 */
function fakeHttpsRequest(statusCode = 200) {
  return (options: unknown, cb: (res: unknown) => void) => {
    const res = {
      statusCode,
      headers: { 'content-type': 'application/json' },
      on(event: string, handler: (arg?: unknown) => void) {
        if (event === 'end') queueMicrotask(() => handler())
        return res
      },
    }
    queueMicrotask(() => cb(res))
    const req = {
      setTimeout: vi.fn(),
      on:         vi.fn(),
      write:      vi.fn(),
      end:        vi.fn(),
      destroy:    vi.fn(),
    }
    return req
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('V3 — fetchPinned DNS-rebinding protection', () => {
  it('public host: connects to the VALIDATED IP, pins hostname as Host + servername, sends the bearer', async () => {
    // Validation resolves to a public IP.
    mocks.dnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    mocks.httpsRequest.mockImplementation(fakeHttpsRequest(200))

    const res = await fetchPinned('https://agent.example.com/invoke', {
      method:  'POST',
      headers: { Authorization: 'Bearer super-secret', 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ping: true }),
    })

    expect(res.status).toBe(200)
    expect(mocks.httpsRequest).toHaveBeenCalledTimes(1)

    const opts = mocks.httpsRequest.mock.calls[0][0] as {
      host: string; servername: string; path: string; headers: Record<string, string>
    }
    // Connected to the validated IP, NOT re-resolved.
    expect(opts.host).toBe('93.184.216.34')
    // Hostname pinned for routing + TLS verification.
    expect(opts.headers.Host).toBe('agent.example.com')
    expect(opts.servername).toBe('agent.example.com')
    expect(opts.path).toBe('/invoke')
    // Bearer was sent to the legit host.
    expect(opts.headers.Authorization).toBe('Bearer super-secret')
  })

  it('DNS rebinding: host resolves to a private/internal IP → EndpointValidationError, NO connection, bearer NOT leaked', async () => {
    // Attacker's low-TTL DNS now returns the loopback / metadata IP.
    mocks.dnsLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    mocks.httpsRequest.mockImplementation(fakeHttpsRequest(200))

    await expect(
      fetchPinned('https://evil.example.com/invoke', {
        method:  'POST',
        headers: { Authorization: 'Bearer super-secret' },
        body:    JSON.stringify({ ping: true }),
      }),
    ).rejects.toBeInstanceOf(EndpointValidationError)

    // The fetch never happened → no bearer leaked to the internal host.
    expect(mocks.httpsRequest).not.toHaveBeenCalled()
  })

  it('cloud metadata IP (169.254.169.254) → EndpointValidationError, NO connection', async () => {
    mocks.dnsLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }])
    mocks.httpsRequest.mockImplementation(fakeHttpsRequest(200))

    await expect(
      fetchPinned('https://metadata-rebind.example.com/x', {
        headers: { Authorization: 'Bearer super-secret' },
      }),
    ).rejects.toBeInstanceOf(EndpointValidationError)
    expect(mocks.httpsRequest).not.toHaveBeenCalled()
  })

  it('non-HTTPS URL → EndpointValidationError before any DNS/connection', async () => {
    await expect(
      fetchPinned('http://agent.example.com/invoke', {}),
    ).rejects.toBeInstanceOf(EndpointValidationError)
    expect(mocks.dnsLookup).not.toHaveBeenCalled()
    expect(mocks.httpsRequest).not.toHaveBeenCalled()
  })
})
