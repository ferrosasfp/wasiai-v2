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
