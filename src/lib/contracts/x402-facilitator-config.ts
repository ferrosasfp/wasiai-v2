/**
 * WAS-V2-1: lazy-init reader of X402_FACILITATOR_URL env var.
 *
 * Tri-state cache:
 *   undefined → not yet read
 *   null      → unset OR malformed (graceful degradation per CD-NEW-SDD-4)
 *   string    → valid URL (trailing slash stripped)
 *
 * CD-NEW-SDD-2: única source of truth para esta env var.
 * CD-NEW-SDD-5: no `await` module-level — lazy reads only.
 * CD-6: no `throw` module-level — app must boot without the env var.
 */
import { logger } from '@/lib/logger'

/**
 * Module-scope cache. Safe under Node.js single-threaded event loop:
 * concurrent calls to getFacilitatorUrl() see the first writer's value.
 * If we ever move to Worker threads / multi-isolate runtimes this
 * invariant breaks and the cache must be reworked (e.g. AsyncLocalStorage).
 */
let cached: string | null | undefined = undefined
let warnedOnce = false

export function getFacilitatorUrl(): string | null {
  if (cached !== undefined) return cached
  const raw = process.env.X402_FACILITATOR_URL?.trim()
  if (!raw) {
    cached = null
    return null
  }
  try {
    const url = new URL(raw)
    cached = url.toString().replace(/\/$/, '')
    return cached
  } catch {
    if (!warnedOnce) {
      logger.warn(
        '[x402-facilitator-config] X402_FACILITATOR_URL malformed; falling back to internal settler',
        { raw_redacted: raw.slice(0, 16) + '...' },
      )
      warnedOnce = true
    }
    cached = null
    return null
  }
}

// ─── WAS-V2-2: Wasiai-as-primary toggle + chain allowlist ────────────────────

/**
 * Hardcoded list of chain identifiers (canonical x402 v2 form `eip155:<chainId>`)
 * that the wasiai-facilitator is authorized to settle on. Forward-compat with
 * Kite chains (2366/2368); current ctx.network only matches 43113/43114.
 *
 * DT-A (humano): immutable list.
 */
export const WASIAI_CHAIN_ALLOWLIST: ReadonlySet<string> = new Set([
  'eip155:2366',
  'eip155:2368',
  'eip155:43113',
  'eip155:43114',
])

/**
 * Default URL of the wasiai-facilitator Railway deployment.
 * Override via WASIAI_FACILITATOR_URL only for staging/testing.
 * DT-H: never null — fallback default keeps operator surface minimal.
 */
const WASIAI_FACILITATOR_DEFAULT_URL =
  'https://wasiai-facilitator-production.up.railway.app'

// Tri-state caches (same pattern as getFacilitatorUrl).
let wasiaiPrimaryCached: boolean | undefined = undefined
let wasiaiPrimaryWarnedOnce = false
let wasiaiUrlCached: string | undefined = undefined
let wasiaiUrlWarnedOnce = false
// WAS-V2-INT: tri-state cache for the wasiai-facilitator API key.
//   undefined → not yet read
//   null      → unset OR empty (graceful — header simply not sent)
//   string    → trimmed, non-empty key
let wasiaiApiKeyCached: string | null | undefined = undefined

/**
 * Reads WASIAI_FACILITATOR_AS_PRIMARY env var. Returns true ONLY when
 * the raw value (trimmed, lowercased) === 'true'. Any other value → false.
 *
 * AC-2: malformed value (e.g. 'mAyBe') → returns false + warns ONCE at
 * first call time. Never throws.
 *
 * CD-13: this is the only place the env var is read.
 */
export function isWasiaiFacilitatorPrimary(): boolean {
  if (wasiaiPrimaryCached !== undefined) return wasiaiPrimaryCached
  const raw = process.env.WASIAI_FACILITATOR_AS_PRIMARY?.trim()
  if (raw === undefined || raw === '') {
    wasiaiPrimaryCached = false
    return false
  }
  const lower = raw.toLowerCase()
  if (lower === 'true') {
    wasiaiPrimaryCached = true
    return true
  }
  if (lower === 'false') {
    wasiaiPrimaryCached = false
    return false
  }
  // Malformed.
  if (!wasiaiPrimaryWarnedOnce) {
    logger.warn(
      '[x402-facilitator-config] WASIAI_FACILITATOR_AS_PRIMARY malformed; defaulting to false',
      { raw_redacted: raw.slice(0, 16) + '...' },
    )
    wasiaiPrimaryWarnedOnce = true
  }
  wasiaiPrimaryCached = false
  return false
}

/**
 * Returns the wasiai-facilitator URL.
 * - If WASIAI_FACILITATOR_URL env var is set and a valid URL → returns it (sanitized).
 * - Else → returns WASIAI_FACILITATOR_DEFAULT_URL.
 *
 * DT-H: never returns null — operator surface minimal.
 */
export function getWasiaiFacilitatorUrl(): string {
  if (wasiaiUrlCached !== undefined) return wasiaiUrlCached
  const raw = process.env.WASIAI_FACILITATOR_URL?.trim()
  if (!raw) {
    wasiaiUrlCached = WASIAI_FACILITATOR_DEFAULT_URL
    return wasiaiUrlCached
  }
  try {
    const url = new URL(raw)
    wasiaiUrlCached = url.toString().replace(/\/$/, '')
    return wasiaiUrlCached
  } catch {
    if (!wasiaiUrlWarnedOnce) {
      logger.warn(
        '[x402-facilitator-config] WASIAI_FACILITATOR_URL malformed; using default',
        { raw_redacted: raw.slice(0, 16) + '...' },
      )
      wasiaiUrlWarnedOnce = true
    }
    wasiaiUrlCached = WASIAI_FACILITATOR_DEFAULT_URL
    return wasiaiUrlCached
  }
}

/**
 * WAS-V2-INT: Reads FACILITATOR_API_KEY env var (shared bearer token expected
 * by wasiai-facilitator on /verify + /settle).
 *
 * Returns null when unset OR empty (graceful — caller omits the Authorization
 * header). Returns the trimmed key otherwise. Never throws, never reads at
 * module level (lazy), mirroring getFacilitatorUrl's tri-state pattern.
 *
 * SECURITY: this key is sent ONLY to the wasiai-facilitator branch (CASE C in
 * facilitator-router). It MUST NEVER be threaded into the UVD branch
 * (getFacilitatorUrl) nor the internal direct path — UVD is a third-party.
 */
export function getWasiaiFacilitatorApiKey(): string | null {
  if (wasiaiApiKeyCached !== undefined) return wasiaiApiKeyCached
  const raw = process.env.FACILITATOR_API_KEY?.trim()
  if (!raw) {
    wasiaiApiKeyCached = null
    return null
  }
  wasiaiApiKeyCached = raw
  return wasiaiApiKeyCached
}

/** Test-only — reset cache between tests. NOT exported in barrel/index. */
export function __resetFacilitatorUrlCacheForTesting(): void {
  cached = undefined
  warnedOnce = false
  // WAS-V2-2: also reset the new caches added in this HU.
  wasiaiPrimaryCached = undefined
  wasiaiPrimaryWarnedOnce = false
  wasiaiUrlCached = undefined
  wasiaiUrlWarnedOnce = false
  // WAS-V2-INT: reset the API key cache too.
  wasiaiApiKeyCached = undefined
}
