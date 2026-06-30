/**
 * verifySignedRequest.ts — HMAC signed-request replay protection for privileged
 * operator/internal routes that trigger on-chain actions.
 *
 * TB-03 (audit 2026-06-30): privileged internal routes (escrow release, payouts)
 * were gated ONLY by a static bearer. A captured request is infinitely
 * replayable — there is no timestamp and no nonce, so an attacker who observes
 * one authorized call can re-fire the operator-signed on-chain action at will.
 *
 * This module mirrors the admin-fee endpoint's nonce+expiry hardening
 * (`src/lib/admin/verifyAdminSignature.ts`), but for shared-secret callers
 * (our own operator / upkeep-listener code) instead of an EVM key:
 *
 *   - the caller signs `METHOD\nPATH\nTIMESTAMP\nNONCE` with HMAC-SHA256 over the
 *     shared secret and sends it as `x-internal-signature`,
 *   - `x-internal-timestamp` must be within MAX_SKEW_SECONDS (anti-replay window),
 *   - `x-internal-nonce` is single-use, burned in Redis with a TTL ≥ the skew
 *     window so a replay inside the window is rejected as `nonce_already_used`,
 *   - fail-closed: a missing secret, missing headers, Redis unavailability, or a
 *     mismatching signature all reject.
 *
 * Use `signInternalRequest` (below) from our own callers to produce the headers.
 *
 * NOTE (Vercel Cron): Vercel Cron can only send a STATIC `Authorization: Bearer`
 * header — it cannot compute a per-request HMAC. Cron-triggered GET routes
 * therefore cannot adopt this scheme without an infra change (signed cron proxy
 * / QStash). See the route-level DEFER-TO-HU notes.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { Redis } from '@upstash/redis'

/** Anti-replay window: a signed request older than this is rejected. */
export const MAX_SKEW_SECONDS = 300 // 5 minutes (matches admin-fee MAX_AGE)

/** Nonce TTL in Redis — must be ≥ the skew window so a replay can't outlive it. */
const NONCE_TTL_SECONDS = MAX_SKEW_SECONDS + 60

export const SIGNED_REQUEST_HEADERS = {
  signature: 'x-internal-signature',
  timestamp: 'x-internal-timestamp',
  nonce:     'x-internal-nonce',
} as const

let _redis: Redis | null = null
function getRedis(): Redis | null {
  if (_redis) return _redis
  const url   = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return _redis = new Redis({ url, token })
}

/**
 * Canonical message that both signer and verifier HMAC over. Binding method +
 * path prevents a captured signature from being replayed against a different
 * route or verb.
 */
function canonicalMessage(method: string, path: string, timestamp: string, nonce: string): string {
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}`
}

function safeHexEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  try {
    return timingSafeEqual(ba, bb)
  } catch {
    return false
  }
}

export type SignedRequestResult =
  | { ok: true }
  | { ok: false; status: 401 | 500; reason: string }

/**
 * Verify an HMAC signed request against INTERNAL_API_SECRET, enforcing a fresh
 * timestamp and a single-use nonce. Fail-closed on every error path.
 *
 * @param method  HTTP method of the request (e.g. 'POST').
 * @param path    request pathname (e.g. '/api/v1/internal/escrow/release-expired').
 * @param headers a Headers-like with `.get(name)`.
 */
export async function verifySignedRequest(
  method: string,
  path: string,
  headers: { get(name: string): string | null },
): Promise<SignedRequestResult> {
  const secret = process.env.INTERNAL_API_SECRET?.trim()
  if (!secret) {
    return { ok: false, status: 500, reason: 'server_misconfigured' }
  }

  const signature = headers.get(SIGNED_REQUEST_HEADERS.signature)?.trim()
  const timestamp = headers.get(SIGNED_REQUEST_HEADERS.timestamp)?.trim()
  const nonce     = headers.get(SIGNED_REQUEST_HEADERS.nonce)?.trim()

  if (!signature || !timestamp || !nonce) {
    return { ok: false, status: 401, reason: 'missing_signed_headers' }
  }

  // Anti-replay: timestamp must be a recent integer (seconds since epoch).
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || !Number.isInteger(ts)) {
    return { ok: false, status: 401, reason: 'invalid_timestamp' }
  }
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > MAX_SKEW_SECONDS) {
    return { ok: false, status: 401, reason: 'request_expired' }
  }

  // Constant-time HMAC check.
  const expected = createHmac('sha256', secret)
    .update(canonicalMessage(method, path, timestamp, nonce))
    .digest('hex')
  if (!safeHexEqual(signature, expected)) {
    return { ok: false, status: 401, reason: 'invalid_signature' }
  }

  // Single-use nonce. Fail-closed if Redis is unavailable — without a nonce
  // store there is no replay protection, so we must reject.
  const redis = getRedis()
  if (!redis) {
    return { ok: false, status: 500, reason: 'nonce_store_unavailable' }
  }

  const nonceKey = `internal-nonce:${nonce}`
  try {
    // SET NX EX — atomic claim. Returns null if the key already existed.
    const claimed = await redis.set(nonceKey, '1', { nx: true, ex: NONCE_TTL_SECONDS })
    if (claimed === null) {
      return { ok: false, status: 401, reason: 'nonce_already_used' }
    }
  } catch {
    return { ok: false, status: 500, reason: 'nonce_store_unavailable' }
  }

  return { ok: true }
}

/**
 * Produce the signed-request headers for an internal/operator caller. Use this
 * from our own code (operator scripts, upkeep-listener) so the request carries a
 * fresh timestamp + nonce + HMAC.
 *
 * @param method HTTP method.
 * @param path   request pathname (must match what the route verifies).
 * @param secret the shared INTERNAL_API_SECRET.
 */
export function signInternalRequest(
  method: string,
  path: string,
  secret: string,
): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce     = randomBytes(16).toString('hex')
  const signature = createHmac('sha256', secret)
    .update(canonicalMessage(method, path, timestamp, nonce))
    .digest('hex')
  return {
    [SIGNED_REQUEST_HEADERS.timestamp]: timestamp,
    [SIGNED_REQUEST_HEADERS.nonce]:     nonce,
    [SIGNED_REQUEST_HEADERS.signature]: signature,
  }
}
