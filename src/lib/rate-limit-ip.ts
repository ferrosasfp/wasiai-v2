/**
 * IP-based daily rate limiter via Upstash Redis
 * Usage: const { success, remaining } = await checkIpLimit(ip, prefix, maxCalls)
 */
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

const limiters = new Map<string, Ratelimit>()

export function getIpLimiter(prefix: string, maxCalls: number): Ratelimit {
  const key = `${prefix}:${maxCalls}`
  if (!limiters.has(key)) {
    limiters.set(key, new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(maxCalls, '1 d'),
      prefix: `rl:${prefix}`,
    }))
  }
  return limiters.get(key)!
}

export async function checkIpLimit(
  ip: string,
  prefix: string,
  maxCalls: number,
): Promise<{ success: boolean; remaining: number; reset: number }> {
  const rl = getIpLimiter(prefix, maxCalls)
  const { success, remaining, reset } = await rl.limit(ip)
  return { success, remaining, reset }
}
