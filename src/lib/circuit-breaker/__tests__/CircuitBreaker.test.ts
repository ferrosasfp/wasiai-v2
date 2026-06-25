/**
 * CircuitBreaker behavioural tests (audit 2026-06-25, P2 — orphaned defence-in-depth).
 * Redis (@upstash/redis) is mocked; the state-machine logic runs for real:
 *  - threshold trip (closed → open at 5 failures)
 *  - open blocks calls (wrapWithCircuitBreaker throws without invoking fn)
 *  - recovery timeout transitions open → half-open
 *  - Redis-down → fail-open (getState returns 'closed', never throws)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const redisMock = vi.hoisted(() => ({
  get:    vi.fn(),
  set:    vi.fn(),
  del:    vi.fn(),
  incr:   vi.fn(),
  expire: vi.fn(),
}))

vi.mock('@upstash/redis', () => ({
  Redis: { fromEnv: () => redisMock },
}))
vi.mock('@/lib/webhooks/triggerCircuitOpen', () => ({ triggerCircuitOpen: vi.fn() }))

import { getState, recordFailure, wrapWithCircuitBreaker } from '../CircuitBreaker'

beforeEach(() => {
  vi.clearAllMocks()
  redisMock.get.mockResolvedValue(null)
  redisMock.set.mockResolvedValue('OK')
  redisMock.del.mockResolvedValue(1)
  redisMock.incr.mockResolvedValue(1)
  redisMock.expire.mockResolvedValue(1)
})

describe('getState', () => {
  it('no stored state → closed', async () => {
    expect(await getState('prov')).toBe('closed')
  })

  it('open + recovery timeout elapsed → transitions to half-open', async () => {
    const longAgo = Math.floor(Date.now() / 1000) - 60 // > RECOVERY_TIMEOUT (30s)
    redisMock.get.mockImplementation((key: string) =>
      key.endsWith(':state') ? Promise.resolve('open') : Promise.resolve(longAgo),
    )
    expect(await getState('prov')).toBe('half-open')
    expect(redisMock.set).toHaveBeenCalledWith(
      expect.stringContaining(':state'), 'half-open', expect.objectContaining({ ex: 300 }),
    )
  })

  it('open + within recovery window → stays open', async () => {
    const recent = Math.floor(Date.now() / 1000) - 5 // < 30s
    redisMock.get.mockImplementation((key: string) =>
      key.endsWith(':state') ? Promise.resolve('open') : Promise.resolve(recent),
    )
    expect(await getState('prov')).toBe('open')
  })

  it('Redis down → fail-open (closed), never throws', async () => {
    redisMock.get.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(getState('prov')).resolves.toBe('closed')
  })
})

describe('recordFailure threshold', () => {
  it('5th failure trips the breaker open', async () => {
    redisMock.incr.mockResolvedValue(5) // FAILURE_THRESHOLD
    await recordFailure('prov', 'creator-1')
    expect(redisMock.set).toHaveBeenCalledWith(
      expect.stringContaining(':state'), 'open', expect.objectContaining({ ex: 300 }),
    )
  })

  it('below threshold does NOT open', async () => {
    redisMock.incr.mockResolvedValue(3)
    await recordFailure('prov')
    expect(redisMock.set).not.toHaveBeenCalledWith(
      expect.stringContaining(':state'), 'open', expect.anything(),
    )
  })
})

describe('wrapWithCircuitBreaker', () => {
  it('open state → throws WITHOUT invoking fn (request shed)', async () => {
    redisMock.get.mockImplementation((key: string) =>
      key.endsWith(':state') ? Promise.resolve('open') : Promise.resolve(Math.floor(Date.now() / 1000)),
    )
    const fn = vi.fn()
    await expect(wrapWithCircuitBreaker('prov', fn)).rejects.toThrow(/currently unavailable/)
    expect(fn).not.toHaveBeenCalled()
  })

  it('closed + fn succeeds → returns result and records success (clears state)', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await wrapWithCircuitBreaker('prov', fn)
    expect(result).toBe('ok')
    // recordSuccess clears the three keys
    expect(redisMock.del).toHaveBeenCalledWith(expect.stringContaining(':state'))
  })

  it('closed + fn throws → records failure and re-throws original error', async () => {
    const boom = new Error('upstream boom')
    const fn = vi.fn().mockRejectedValue(boom)
    await expect(wrapWithCircuitBreaker('prov', fn)).rejects.toBe(boom)
    expect(redisMock.incr).toHaveBeenCalledWith(expect.stringContaining(':failures'))
  })
})
