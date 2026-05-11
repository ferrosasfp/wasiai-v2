/**
 * WAS-V2-1 W1 — tests for x402-facilitator-config.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

describe('getFacilitatorUrl — WAS-V2-1 W1', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.X402_FACILITATOR_URL
  })

  it('AC-1 supporting: returns null when env var unset', async () => {
    const { getFacilitatorUrl } = await import('@/lib/contracts/x402-facilitator-config')
    expect(getFacilitatorUrl()).toBeNull()
  })

  it('AC-2 supporting: returns sanitized URL when set to valid URL', async () => {
    process.env.X402_FACILITATOR_URL = 'https://wasiai-facilitator-production.up.railway.app/'
    const { getFacilitatorUrl } = await import('@/lib/contracts/x402-facilitator-config')
    expect(getFacilitatorUrl()).toBe('https://wasiai-facilitator-production.up.railway.app')
  })

  it('CD-NEW-SDD-4: returns null + warns on malformed URL', async () => {
    process.env.X402_FACILITATOR_URL = 'not-a-url'
    const { logger } = await import('@/lib/logger')
    const { getFacilitatorUrl } = await import('@/lib/contracts/x402-facilitator-config')
    expect(getFacilitatorUrl()).toBeNull()
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('CD-NEW-SDD-2: caches result across multiple calls (no re-read of env)', async () => {
    process.env.X402_FACILITATOR_URL = 'https://example.com'
    const { getFacilitatorUrl } = await import('@/lib/contracts/x402-facilitator-config')
    const a = getFacilitatorUrl()
    delete process.env.X402_FACILITATOR_URL // mutate after first call
    const b = getFacilitatorUrl()
    expect(a).toBe(b) // returns cached value
  })
})

// ─── WAS-V2-2 W0 — isWasiaiFacilitatorPrimary + getWasiaiFacilitatorUrl ──────

describe('isWasiaiFacilitatorPrimary — WAS-V2-2 W0', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.WASIAI_FACILITATOR_AS_PRIMARY
  })

  it('AC-1 supporting: returns false when env var unset', async () => {
    const { isWasiaiFacilitatorPrimary } = await import('@/lib/contracts/x402-facilitator-config')
    expect(isWasiaiFacilitatorPrimary()).toBe(false)
  })

  it('AC-1 supporting: returns false when env var = "false"', async () => {
    process.env.WASIAI_FACILITATOR_AS_PRIMARY = 'false'
    const { isWasiaiFacilitatorPrimary } = await import('@/lib/contracts/x402-facilitator-config')
    expect(isWasiaiFacilitatorPrimary()).toBe(false)
  })

  it('AC-1 supporting: returns false when env var = "FALSE" (case-insensitive)', async () => {
    process.env.WASIAI_FACILITATOR_AS_PRIMARY = 'FALSE'
    const { isWasiaiFacilitatorPrimary } = await import('@/lib/contracts/x402-facilitator-config')
    expect(isWasiaiFacilitatorPrimary()).toBe(false)
  })

  it('AC-3 supporting: returns true when env var = "true"', async () => {
    process.env.WASIAI_FACILITATOR_AS_PRIMARY = 'true'
    const { isWasiaiFacilitatorPrimary } = await import('@/lib/contracts/x402-facilitator-config')
    expect(isWasiaiFacilitatorPrimary()).toBe(true)
  })

  it('AC-3 supporting: returns true when env var = "TRUE" (case-insensitive)', async () => {
    process.env.WASIAI_FACILITATOR_AS_PRIMARY = 'TRUE'
    const { isWasiaiFacilitatorPrimary } = await import('@/lib/contracts/x402-facilitator-config')
    expect(isWasiaiFacilitatorPrimary()).toBe(true)
  })

  it('AC-2 supporting: malformed value (maybe) → false, logger.warn called once', async () => {
    process.env.WASIAI_FACILITATOR_AS_PRIMARY = 'maybe'
    const { logger } = await import('@/lib/logger')
    const { isWasiaiFacilitatorPrimary } = await import('@/lib/contracts/x402-facilitator-config')
    expect(isWasiaiFacilitatorPrimary()).toBe(false)
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('AC-2 supporting: second malformed call does NOT log again (warn-once)', async () => {
    process.env.WASIAI_FACILITATOR_AS_PRIMARY = 'maybe'
    const { logger } = await import('@/lib/logger')
    const { isWasiaiFacilitatorPrimary } = await import('@/lib/contracts/x402-facilitator-config')
    isWasiaiFacilitatorPrimary()
    isWasiaiFacilitatorPrimary()
    isWasiaiFacilitatorPrimary()
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })
})

describe('WASIAI_CHAIN_ALLOWLIST — WAS-V2-2 W0', () => {
  it('AC-12: WASIAI_CHAIN_ALLOWLIST is exported and contains the 4 expected chains', async () => {
    const { WASIAI_CHAIN_ALLOWLIST } = await import('@/lib/contracts/x402-facilitator-config')
    expect(WASIAI_CHAIN_ALLOWLIST.has('eip155:2366')).toBe(true)
    expect(WASIAI_CHAIN_ALLOWLIST.has('eip155:2368')).toBe(true)
    expect(WASIAI_CHAIN_ALLOWLIST.has('eip155:43113')).toBe(true)
    expect(WASIAI_CHAIN_ALLOWLIST.has('eip155:43114')).toBe(true)
    expect(WASIAI_CHAIN_ALLOWLIST.size).toBe(4)
  })

  it('AC-12: WASIAI_CHAIN_ALLOWLIST is a ReadonlySet', async () => {
    const { WASIAI_CHAIN_ALLOWLIST } = await import('@/lib/contracts/x402-facilitator-config')
    // ReadonlySet is a TypeScript-only contract; at runtime it's a Set.
    expect(WASIAI_CHAIN_ALLOWLIST).toBeInstanceOf(Set)
    // Chain NOT in allowlist returns false (defensive check).
    expect(WASIAI_CHAIN_ALLOWLIST.has('eip155:1')).toBe(false)
  })
})

describe('getWasiaiFacilitatorUrl — WAS-V2-2 W0', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.WASIAI_FACILITATOR_URL
  })

  it('DT-H supporting: returns default URL when env var unset', async () => {
    const { getWasiaiFacilitatorUrl } = await import('@/lib/contracts/x402-facilitator-config')
    expect(getWasiaiFacilitatorUrl()).toBe('https://wasiai-facilitator-production.up.railway.app')
  })

  it('DT-H supporting: returns sanitized URL when env var set (strips trailing slash)', async () => {
    process.env.WASIAI_FACILITATOR_URL = 'https://staging-wasiai.test/'
    const { getWasiaiFacilitatorUrl } = await import('@/lib/contracts/x402-facilitator-config')
    expect(getWasiaiFacilitatorUrl()).toBe('https://staging-wasiai.test')
  })

  it('DT-H supporting: returns default + warns on malformed URL', async () => {
    process.env.WASIAI_FACILITATOR_URL = 'not-a-url'
    const { logger } = await import('@/lib/logger')
    const { getWasiaiFacilitatorUrl } = await import('@/lib/contracts/x402-facilitator-config')
    expect(getWasiaiFacilitatorUrl()).toBe('https://wasiai-facilitator-production.up.railway.app')
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })
})
