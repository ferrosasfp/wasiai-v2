/**
 * POST /api/creator/test-endpoint
 *
 * Prueba un endpoint externo desde el backend de WasiAI.
 * Incluye SSRF protection, auth, rate limiting (5 req/min) y timeout 5s.
 * El body del endpoint externo NO se reenvía al cliente — solo status + latency.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { jsonError } from '@/lib/api/jsonError'
import { fetchPinned, EndpointValidationError } from '@/lib/security/fetchPinned'
import { validateCsrf } from '@/lib/security/csrf'
import { logger } from '@/lib/logger'
import { checkRateLimit, getIdentifier } from '@/lib/ratelimit'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const bodySchema = z.object({
  endpoint_url: z.string().url('URL inválida'),
  auth_header:  z.string().optional(),
})

// 5 req/min — más restrictivo que otros endpoints
let _testLimit: Ratelimit | null = null
function getTestLimit(): Ratelimit {
  return (_testLimit ??= new Ratelimit({
    redis: new Redis({
      url:   (process.env.UPSTASH_REDIS_REST_URL  ?? '').trim(),
      token: (process.env.UPSTASH_REDIS_REST_TOKEN ?? '').trim(),
    }),
    limiter: Ratelimit.slidingWindow(5, '1 m'),
    prefix:  'wasiai:test-endpoint',
  }))
}

export async function POST(req: NextRequest) {
  // CSRF (H6): match the sibling creator routes — reject cross-origin form posts.
  const csrfError = validateCsrf(req)
  if (csrfError) return csrfError

  // Auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Rate limit
  const identifier = getIdentifier(req, user.id)
  const rateLimitResponse = await checkRateLimit(getTestLimit(), identifier)
  if (rateLimitResponse) return rateLimitResponse

  // Validate body
  const body = await req.json().catch(() => ({}))
  const result = bodySchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json({ error: result.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  const { endpoint_url, auth_header } = result.data

  // H6: relaying a caller-chosen Authorization header to an arbitrary URL is a
  // credential-relay vector. It stays behind auth + the 5/min rate limit above;
  // log every use (with only the target host, never the secret) for abuse review.
  if (auth_header) {
    let host = 'invalid'
    try { host = new URL(endpoint_url).host } catch { /* keep 'invalid' */ }
    logger.warn('[test-endpoint] relaying caller-supplied Authorization header', {
      userId: user.id,
      host,
    })
  }

  // Probe the endpoint via a pinned request (H6: fetchPinned validates the URL
  // and connects to THAT exact resolved IP with Host/TLS-SNI pinned, closing the
  // DNS-rebinding TOCTOU window the previous validate()+fetch() left open — the
  // outbound Authorization would otherwise land on an internal/rebound host).
  const t0 = Date.now()

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (auth_header) headers['Authorization'] = auth_header

    const res = await fetchPinned(endpoint_url, {
      method:    'POST',
      headers,
      body:      JSON.stringify({ input: 'test' }),
      timeoutMs: 5000,
    })

    const latencyMs = Date.now() - t0
    // DO NOT forward the response body — security risk + not needed
    return NextResponse.json({
      ok:        res.status < 400,
      status:    res.status,
      latencyMs,
    })
  } catch (err: unknown) {
    // SSRF/validation rejection → hard 400 (same as the old validateEndpointUrlAsync).
    if (err instanceof EndpointValidationError) {
      return jsonError('invalid_endpoint_url', 'Endpoint URL is not allowed', 400, { logDetail: err })
    }
    const latencyMs = Date.now() - t0
    const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    return NextResponse.json({
      ok:        false,
      error:     isTimeout ? 'timeout' : 'unreachable',
      latencyMs,
    })
  }
}
