/**
 * verifyCronSecret.ts — constant-time CRON_SECRET bearer verification.
 *
 * V-07 / V-12-V-13 (audit 2026-06-25): several cron routes compared the
 * Authorization header against `Bearer ${process.env.CRON_SECRET}` with a plain
 * `!==`, which is a timing side-channel and, worse, would AUTHORIZE a request
 * carrying the literal header `Bearer undefined` when CRON_SECRET is unset.
 *
 * This module centralizes the same constant-time pattern already used inline by
 * `cron/process-refunds/route.ts:13-22`:
 *   - reject (fail-closed) when CRON_SECRET is unset/blank,
 *   - compare with `timingSafeEqual` (length-guarded, since it requires equal-
 *     length buffers).
 */
import { timingSafeEqual } from 'crypto'

/**
 * Constant-time comparison of the raw Authorization header against the expected
 * `Bearer <secret>` value. Length guard required because timingSafeEqual throws
 * on unequal-length buffers.
 */
export function safeBearerEqual(authHeader: string, expected: string): boolean {
  const a = Buffer.from(authHeader)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 500; error: string }

/**
 * Verify a cron request's Authorization header against CRON_SECRET in
 * constant time, failing closed when the secret is not configured.
 *
 * @param authHeader the raw `Authorization` header value (may be null).
 */
export function verifyCronAuth(authHeader: string | null): CronAuthResult {
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (!cronSecret) {
    return { ok: false, status: 500, error: 'CRON_SECRET not configured' }
  }
  if (!safeBearerEqual(authHeader ?? '', `Bearer ${cronSecret}`)) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }
  return { ok: true }
}
