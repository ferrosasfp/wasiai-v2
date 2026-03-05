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
import { validateEndpointUrlAsync } from '@/lib/security/validateEndpointUrl'
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

  // SSRF protection + NG-005 DNS probe
  try {
    await validateEndpointUrlAsync(endpoint_url)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 })
  }

  // Probe the endpoint
  const controller = new AbortController()
  const timeoutId  = setTimeout(() => controller.abort(), 5000)
  const t0 = Date.now()

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (auth_header) headers['Authorization'] = auth_header

    const res = await fetch(endpoint_url, {
      method:  'POST',
      headers,
      body:    JSON.stringify({ input: 'test' }),
      signal:  controller.signal,
    })

    const latencyMs = Date.now() - t0
    // DO NOT forward the response body — security risk + not needed
    return NextResponse.json({
      ok:        res.status < 400,
      status:    res.status,
      latencyMs,
    })
  } catch (err: unknown) {
    const latencyMs = Date.now() - t0
    const isTimeout = err instanceof Error && err.name === 'AbortError'
    return NextResponse.json({
      ok:        false,
      error:     isTimeout ? 'timeout' : 'unreachable',
      latencyMs,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}
