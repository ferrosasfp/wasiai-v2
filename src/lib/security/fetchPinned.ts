/**
 * V3 (audit 2026-06-25) — DNS-rebinding TOCTOU hardening.
 *
 * `validateEndpointUrlAsync(url)` resolves the hostname and validates that the
 * resolved IP is public, but a subsequent `fetch(url)` re-resolves DNS at
 * connection time. An attacker controlling a low-TTL record can return a public
 * IP during validation and `127.0.0.1` / `169.254.169.254` at connect time,
 * causing the request (which carries `Authorization: Bearer ${webhook_secret}`)
 * to hit an internal/attacker host.
 *
 * `fetchPinned` closes the gap: it validates the hostname's resolved IP and then
 * connects to THAT EXACT IP, pinning the original hostname as the `Host` header
 * and TLS SNI/`servername` so certificate verification still runs against the
 * hostname. There is no second DNS lookup, so the validated IP is the one we
 * connect to.
 *
 * Pattern lifted from `lib/agents/health-probe.ts` (`httpsProbe`), generalized
 * to support arbitrary method/headers/body and to return a standard `Response`.
 */
import https from 'node:https'
import { validateEndpointUrlAsync } from '@/lib/security/validateEndpointUrl'

export interface FetchPinnedInit {
  method?:  string
  headers?: Record<string, string>
  /** Stringified request body (e.g. JSON.stringify(...)). */
  body?:    string
  /** Total timeout in ms. Defaults to 10_000. */
  timeoutMs?: number
}

/**
 * Thrown when the endpoint URL fails SSRF/DNS validation. Callers should treat
 * this exactly like the previous `validateEndpointUrlAsync` rejection.
 */
export class EndpointValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EndpointValidationError'
  }
}

/**
 * fetch-like helper that connects to the validated IP with the hostname pinned.
 *
 * - Resolves + validates the URL via `validateEndpointUrlAsync` (fail-closed).
 * - Connects to the returned IP directly (no re-resolution at connect time).
 * - Sets the `Host` header and TLS `servername` to the original hostname so the
 *   server routes correctly and the certificate is verified against the hostname.
 * - Returns a standard `Response` (so `.ok`, `.status`, `.json()`, `.text()`
 *   all behave as with global `fetch`).
 *
 * If `validateEndpointUrlAsync` returns an empty string (Edge runtime where the
 * DNS module is unavailable), we fall back to a normal `fetch(url, init)` — the
 * pinning optimization is Node-only, and the synchronous blocklist still ran.
 *
 * @throws {EndpointValidationError} when validation rejects the URL.
 */
export async function fetchPinned(rawUrl: string, init: FetchPinnedInit = {}): Promise<Response> {
  let validatedIp: string
  try {
    validatedIp = await validateEndpointUrlAsync(rawUrl)
  } catch (err) {
    throw new EndpointValidationError(err instanceof Error ? err.message : String(err))
  }

  const url       = new URL(rawUrl)
  const method    = init.method ?? 'POST'
  const headers   = init.headers ?? {}
  const body      = init.body
  const timeoutMs = init.timeoutMs ?? 10_000

  // Edge runtime / DNS unavailable: no pinned IP to use. Fall back to fetch.
  // The synchronous blocklist (validateEndpointUrl) already ran inside
  // validateEndpointUrlAsync, so this is no worse than before for Edge.
  if (!validatedIp) {
    return fetch(rawUrl, {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    })
  }

  const port = url.port ? Number(url.port) : 443
  // node:https only speaks HTTPS — validateEndpointUrl already enforces https:.

  return new Promise<Response>((resolve, reject) => {
    const reqOptions: https.RequestOptions = {
      // Connect to the VALIDATED IP — no DNS re-resolution. Bracket IPv6.
      host:       validatedIp.includes(':') ? `[${validatedIp}]` : validatedIp,
      port,
      path:       url.pathname + url.search,
      method,
      headers: {
        ...headers,
        // Pin the original hostname so virtual-hosted servers route correctly.
        Host: url.host,
        ...(body !== undefined ? { 'Content-Length': Buffer.byteLength(body).toString() } : {}),
      },
      // TLS SNI + certificate verification against the original hostname.
      servername: url.hostname,
    }

    const req = https.request(reqOptions, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        const buf = Buffer.concat(chunks)
        // Build a standard Response so callers can use .ok/.status/.json()/.text().
        const resHeaders = new Headers()
        for (const [k, v] of Object.entries(res.headers)) {
          if (v === undefined) continue
          resHeaders.set(k, Array.isArray(v) ? v.join(', ') : v)
        }
        const status = res.statusCode ?? 0
        // Response forbids a body for 204/304 — pass null in that case.
        const responseBody = status === 204 || status === 304 ? null : buf
        resolve(new Response(responseBody, { status, headers: resHeaders }))
      })
      res.on('error', reject)
    })

    req.setTimeout(timeoutMs, () => {
      // Mirror fetch(AbortSignal.timeout()) which rejects with a TimeoutError.
      req.destroy(Object.assign(new DOMException('The operation timed out.', 'TimeoutError')))
    })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}
