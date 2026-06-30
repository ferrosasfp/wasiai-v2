/**
 * verifyCronSecret.test.ts — V-07 / V-12 / V-13 (audit 2026-06-25)
 *
 * Proves the constant-time cron auth helper:
 *  - rejects (500) when CRON_SECRET is unset/blank (fail-closed),
 *  - rejects (401) on a wrong/missing/`Bearer undefined` header,
 *  - accepts (ok) only on the exact `Bearer <secret>` value,
 *  - uses a length guard so timingSafeEqual never throws on unequal lengths.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { verifyCronAuth, safeBearerEqual } from '@/lib/cron/verifyCronSecret'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('verifyCronAuth', () => {
  it('fails closed (500) when CRON_SECRET is unset', () => {
    vi.stubEnv('CRON_SECRET', '')
    const r = verifyCronAuth('Bearer anything')
    expect(r).toEqual({ ok: false, status: 500, error: 'CRON_SECRET not configured' })
  })

  it('does NOT authorize a literal "Bearer undefined" header when secret is unset', () => {
    vi.stubEnv('CRON_SECRET', '')
    // The old `authHeader !== \`Bearer ${process.env.CRON_SECRET}\`` would match
    // "Bearer undefined" here. The guard prevents that (500, not ok).
    const r = verifyCronAuth('Bearer undefined')
    expect(r.ok).toBe(false)
    expect((r as { status: number }).status).toBe(500)
  })

  it('rejects (401) a wrong secret', () => {
    vi.stubEnv('CRON_SECRET', 'right-secret')
    expect(verifyCronAuth('Bearer wrong-secret')).toEqual({ ok: false, status: 401, error: 'Unauthorized' })
  })

  it('rejects (401) a missing header', () => {
    vi.stubEnv('CRON_SECRET', 'right-secret')
    expect(verifyCronAuth(null)).toEqual({ ok: false, status: 401, error: 'Unauthorized' })
  })

  it('rejects (401) when the prefix is missing', () => {
    vi.stubEnv('CRON_SECRET', 'right-secret')
    expect(verifyCronAuth('right-secret').ok).toBe(false)
  })

  it('accepts the exact Bearer <secret>', () => {
    vi.stubEnv('CRON_SECRET', 'right-secret')
    expect(verifyCronAuth('Bearer right-secret')).toEqual({ ok: true })
  })

  it('trims surrounding whitespace in the configured secret', () => {
    vi.stubEnv('CRON_SECRET', '  padded  ')
    expect(verifyCronAuth('Bearer padded')).toEqual({ ok: true })
  })
})

describe('safeBearerEqual', () => {
  it('is length-guarded (different lengths → false, no throw)', () => {
    expect(safeBearerEqual('short', 'a-much-longer-value')).toBe(false)
  })

  it('returns true on exact match', () => {
    expect(safeBearerEqual('Bearer abc', 'Bearer abc')).toBe(true)
  })

  it('returns false on equal-length mismatch', () => {
    expect(safeBearerEqual('Bearer aaa', 'Bearer bbb')).toBe(false)
  })
})
