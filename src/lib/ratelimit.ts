/**
 * Rate limiting via Upstash Redis + @upstash/ratelimit
 *
 * Limiters:
 *  - invoke:   60 req/min per agent key | 10 req/min per IP (anonymous)
 *  - register: 5 req/hour per IP
 *  - keys:     10 req/hour per user
 *  - upload:   20 req/hour per user
 *  - api:      100 req/min per IP (general API)
 */
import { Ratelimit } from '@upstash/ratelimit'
import { Redis }     from '@upstash/redis'
import { NextRequest, NextResponse } from 'next/server'

function makeRedis() {
  return new Redis({
    url:   process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
}

// Lazy singletons — not constructed until first use
let _invoke:   Ratelimit | null = null
let _register: Ratelimit | null = null
let _keys:     Ratelimit | null = null
let _upload:   Ratelimit | null = null

export function getInvokeLimit()   { return _invoke   ??= new Ratelimit({ redis: makeRedis(), limiter: Ratelimit.slidingWindow(60, '1 m'),  prefix: 'rl:invoke' }) }
export function getRegisterLimit() { return _register ??= new Ratelimit({ redis: makeRedis(), limiter: Ratelimit.slidingWindow(5,  '1 h'),  prefix: 'rl:register' }) }
export function getKeysLimit()     { return _keys     ??= new Ratelimit({ redis: makeRedis(), limiter: Ratelimit.slidingWindow(10, '1 h'),  prefix: 'rl:keys' }) }
export function getUploadLimit()   { return _upload   ??= new Ratelimit({ redis: makeRedis(), limiter: Ratelimit.slidingWindow(20, '1 h'),  prefix: 'rl:upload' }) }

/** Extract the best available identifier from a request */
export function getIdentifier(request: NextRequest, userId?: string): string {
  if (userId) return `user:${userId}`
  const agentKey = request.headers.get('x-agent-key')
  if (agentKey) return `key:${agentKey.substring(0, 24)}`
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'anonymous'
  )
}

/** Returns a 429 response if rate limited, null if OK */
export async function checkRateLimit(
  limiter: Ratelimit,
  identifier: string,
): Promise<NextResponse | null> {
  const { success, limit, reset } = await limiter.limit(identifier)

  if (!success) {
    return NextResponse.json(
      {
        error:   'Rate limit exceeded',
        code:    'rate_limited',
        limit,
        remaining: 0,
        reset_at: new Date(reset).toISOString(),
      },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit':     String(limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset':     String(reset),
          'Retry-After':           String(Math.ceil((reset - Date.now()) / 1000)),
        },
      },
    )
  }

  return null
}
