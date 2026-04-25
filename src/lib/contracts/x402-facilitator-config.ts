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

/** Test-only — reset cache between tests. NOT exported in barrel/index. */
export function __resetFacilitatorUrlCacheForTesting(): void {
  cached = undefined
  warnedOnce = false
}
