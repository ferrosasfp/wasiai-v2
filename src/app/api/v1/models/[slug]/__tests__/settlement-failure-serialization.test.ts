/**
 * S6-01 fix: Verify settlement_failures.error_reason is serialized correctly.
 *
 * Bug: String(result.data) produced "[object Object]" for non-string data,
 * losing the actual error info. Fix uses JSON.stringify for objects.
 *
 * This test validates the serialization logic in isolation — no DB, no network.
 */
import { describe, it, expect } from 'vitest'

/**
 * Mirrors the fixed serialization logic from invoke/route.ts S6-01 block:
 *   (typeof data === 'string' ? data : JSON.stringify(data ?? 'upstream_error')).slice(0, 500)
 */
function serializeErrorReason(data: unknown): string {
  return (
    typeof data === 'string'
      ? data
      : JSON.stringify(data ?? 'upstream_error')
  ).slice(0, 500)
}

describe('S6-01: settlement failure error_reason serialization', () => {
  it('serializes object data as JSON (the bug fix)', () => {
    const data = { error: 'model_timeout', details: { latency: 30000 } }
    const result = serializeErrorReason(data)
    expect(result).toBe('{"error":"model_timeout","details":{"latency":30000}}')
  })

  it('preserves string data as-is', () => {
    expect(serializeErrorReason('upstream_error')).toBe('upstream_error')
  })

  it('handles null/undefined → defaults to "upstream_error"', () => {
    expect(serializeErrorReason(null)).toBe('"upstream_error"')
    expect(serializeErrorReason(undefined)).toBe('"upstream_error"')
  })

  it('truncates to 500 chars', () => {
    const longObj = { error: 'x'.repeat(600) }
    const result = serializeErrorReason(longObj)
    expect(result.length).toBe(500)
  })

  it('handles nested error responses from providers', () => {
    const data = {
      error: { message: 'Rate limit exceeded', type: 'rate_limit_error', code: 429 },
      status: 'error',
    }
    const result = serializeErrorReason(data)
    expect(result).toContain('rate_limit_error')
    expect(result).toContain('429')
    const parsed = JSON.parse(result)
    expect(parsed.error.code).toBe(429)
  })

  it('handles array responses', () => {
    const data = [{ error: 'fail1' }, { error: 'fail2' }]
    const result = serializeErrorReason(data)
    expect(result).toContain('fail1')
    const parsed = JSON.parse(result)
    expect(parsed).toHaveLength(2)
  })

  it('REGRESSION: never produces "[object Object]"', () => {
    const testCases = [
      { a: 1 },
      { error: 'test' },
      [1, 2, 3],
      { nested: { deep: { value: true } } },
      new Error('boom'),
    ]
    for (const data of testCases) {
      const result = serializeErrorReason(data)
      expect(result).not.toBe('[object Object]')
      expect(result).not.toContain('[object Object]')
    }
  })
})
