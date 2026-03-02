import { Redis } from '@upstash/redis'
import { triggerCircuitOpen } from '@/lib/webhooks/triggerCircuitOpen'

const redis = Redis.fromEnv()

export type CBState = 'closed' | 'open' | 'half-open'

const FAILURE_THRESHOLD = 5
const RECOVERY_TIMEOUT  = 30 // seconds
const WINDOW_SECONDS    = 120

function keys(providerId: string) {
  return {
    state:       `cb:provider:${providerId}:state`,
    failures:    `cb:provider:${providerId}:failures`,
    lastFailure: `cb:provider:${providerId}:last_failure`,
  }
}

export async function getState(providerId: string): Promise<CBState> {
  try {
    const k = keys(providerId)
    const state = await redis.get<CBState>(k.state)
    if (!state) return 'closed'

    if (state === 'open') {
      const lastFailure = await redis.get<number>(k.lastFailure)
      if (lastFailure && Date.now() / 1000 - lastFailure >= RECOVERY_TIMEOUT) {
        await redis.set(k.state, 'half-open', { ex: 300 })
        return 'half-open'
      }
    }
    return state
  } catch {
    // B-02: Redis down → fail-open (treat as closed, allow traffic)
    return 'closed'
  }
}

export async function recordSuccess(providerId: string): Promise<void> {
  try {
    const k = keys(providerId)
    await redis.del(k.state)
    await redis.del(k.failures)
    await redis.del(k.lastFailure)
  } catch {
    // B-02: Redis down → no-op, fail-open
  }
}

export async function recordFailure(providerId: string, creatorId?: string): Promise<void> {
  try {
    const k = keys(providerId)
    const failures = await redis.incr(k.failures)
    await redis.set(k.lastFailure, Math.floor(Date.now() / 1000))
    await redis.expire(k.failures, WINDOW_SECONDS)

    if (failures >= FAILURE_THRESHOLD) {
      await redis.set(k.state, 'open', { ex: 300 }) // max 5min safety TTL
      await redis.set(k.lastFailure, Math.floor(Date.now() / 1000))
      if (creatorId) void triggerCircuitOpen(providerId, creatorId)
    }
  } catch {
    // B-02: Redis down → no-op, fail-open
  }
}

export async function resetCircuit(providerId: string): Promise<void> {
  try {
    const k = keys(providerId)
    await redis.del(k.state)
    await redis.del(k.failures)
    await redis.del(k.lastFailure)
  } catch {
    // B-02: Redis down → no-op, fail-open
  }
}

export async function wrapWithCircuitBreaker<T>(
  providerId: string,
  fn: () => Promise<T>,
  creatorId?: string
): Promise<T> {
  const state = await getState(providerId)

  if (state === 'open') {
    throw new Error(`Provider ${providerId} is currently unavailable. Try again shortly.`)
  }

  try {
    const result = await fn()
    await recordSuccess(providerId)
    return result
  } catch (err) {
    await recordFailure(providerId, creatorId)
    throw err
  }
}
