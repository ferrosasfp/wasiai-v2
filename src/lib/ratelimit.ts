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
import { logger } from '@/lib/logger'

// SEC-003 / PERF-003: Shared Redis singleton — single connection for all limiters
let _redis: Redis | null = null
function getRedis(): Redis {
  return _redis ??= new Redis({
    url:   process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
}

/** Shared Redis singleton for external consumers (e.g., pricing overhead cache) */
export function getSharedRedis(): Redis {
  return getRedis()
}

// Lazy singletons — not constructed until first use
let _invoke:   Ratelimit | null = null
let _register: Ratelimit | null = null
let _keys:     Ratelimit | null = null
let _upload:   Ratelimit | null = null

let _search: Ratelimit | null = null

export function getInvokeLimit()   { return _invoke   ??= new Ratelimit({ redis: getRedis(), limiter: Ratelimit.slidingWindow(60, '1 m'),  prefix: 'rl:invoke' }) }
export function getRegisterLimit() { return _register ??= new Ratelimit({ redis: getRedis(), limiter: Ratelimit.slidingWindow(5,  '1 h'),  prefix: 'rl:register' }) }
export function getKeysLimit()     { return _keys     ??= new Ratelimit({ redis: getRedis(), limiter: Ratelimit.slidingWindow(10, '1 h'),  prefix: 'rl:keys' }) }
export function getUploadLimit()   { return _upload   ??= new Ratelimit({ redis: getRedis(), limiter: Ratelimit.slidingWindow(20, '1 h'),  prefix: 'rl:upload' }) }
export function getSearchLimit()   { return _search   ??= new Ratelimit({ redis: getRedis(), limiter: Ratelimit.slidingWindow(30, '1 m'),  prefix: 'rl:search' }) }

// ── Compose rate limiter — HU-5.1
let _compose: Ratelimit | null = null
export function getComposeLimit()  { return _compose  ??= new Ratelimit({ redis: getRedis(), limiter: Ratelimit.slidingWindow(10, '1 m'),  prefix: 'rl:compose' }) }

// ── HU-8.4: Creator-configurable rate limits (dynamic, cached by slug:maxValue)
// SEC-003: Use Map cache to avoid creating new Redis connections per request
const _creatorRpmCache = new Map<string, Ratelimit>()
const _creatorRpdCache = new Map<string, Ratelimit>()

/** RPM limiter per agent per API key consumer */
export function getCreatorRpmLimit(slug: string, maxRpm: number): Ratelimit {
  const key = `${slug}:${maxRpm}`
  if (!_creatorRpmCache.has(key)) {
    _creatorRpmCache.set(key, new Ratelimit({
      redis:   getRedis(),
      limiter: Ratelimit.slidingWindow(maxRpm, '1 m'),
      prefix:  `rl:creator:${slug}:rpm`,
    }))
  }
  return _creatorRpmCache.get(key)!
}

/** RPD limiter per agent per API key consumer */
export function getCreatorRpdLimit(slug: string, maxRpd: number): Ratelimit {
  const key = `${slug}:${maxRpd}`
  if (!_creatorRpdCache.has(key)) {
    _creatorRpdCache.set(key, new Ratelimit({
      redis:   getRedis(),
      limiter: Ratelimit.slidingWindow(maxRpd, '1 d'),
      prefix:  `rl:creator:${slug}:rpd`,
    }))
  }
  return _creatorRpdCache.get(key)!
}

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
  try {
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
  } catch (err) {
    // NA-004: fail-closed — Upstash unavailable → 503 instead of fail-open
    logger.warn('[rate-limit] upstash-unavailable', { identifier, err })
    return NextResponse.json(
      { error: 'Service temporarily unavailable', code: 'rate_limit_unavailable' },
      { status: 503, headers: { 'Retry-After': '60' } },
    )
  }
}

/**
 * Verifica RPM + RPD del creator para un slug+consumer dado.
 * Retorna NextResponse 429 si excede algún límite, null si OK.
 * NA-004: Fail-closed — si Upstash no está disponible, retorna 503 + Retry-After:60.
 */
export async function checkCreatorRateLimits(
  slug:       string,
  maxRpm:     number,
  maxRpd:     number,
  identifier: string, // formato: `slug:consumer_key_prefix`
): Promise<NextResponse | null> {
  try {
    const rpmResult = await getCreatorRpmLimit(slug, maxRpm).limit(identifier)
    if (!rpmResult.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', code: 'rate_limited' },
        // NG-011: No exponer headers internos de Upstash — solo Retry-After estándar
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rpmResult.reset - Date.now()) / 1000)) } },
      )
    }
    const rpdResult = await getCreatorRpdLimit(slug, maxRpd).limit(identifier)
    if (!rpdResult.success) {
      return NextResponse.json(
        { error: 'Daily limit reached', code: 'daily_limit_reached' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rpdResult.reset - Date.now()) / 1000)) } },
      )
    }
  } catch (err) {
    // NA-004: fail-closed — Upstash unavailable → 503 instead of fail-open
    logger.warn('[rate-limit] upstash-unavailable', { slug, err })
    return NextResponse.json(
      { error: 'Service temporarily unavailable', code: 'rate_limit_unavailable' },
      { status: 503, headers: { 'Retry-After': '60' } },
    )
  }
  return null
}
