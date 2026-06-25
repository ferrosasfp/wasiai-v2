/**
 * V6 — transferUsdc guard tests (no chain interaction).
 *
 * Full on-chain transfer is covered by the runRefunds processor test (transfer
 * mocked at the boundary). Here we assert the cheap guards that run before any
 * RPC / wallet setup.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { transferUsdc } from '../usdcSettler'

describe('transferUsdc — guards', () => {
  it('rejects a zero amount before touching the chain', async () => {
    const res = await transferUsdc('0x' + '1'.repeat(40), '0')
    expect(res.success).toBe(false)
    expect(res.error).toContain('Invalid refund amount')
  })

  it('rejects a negative amount', async () => {
    const res = await transferUsdc('0x' + '1'.repeat(40), '-5')
    expect(res.success).toBe(false)
    expect(res.error).toContain('Invalid refund amount')
  })

  it('fails cleanly (no throw) when OPERATOR_PRIVATE_KEY is missing', async () => {
    const prev = process.env.OPERATOR_PRIVATE_KEY
    delete process.env.OPERATOR_PRIVATE_KEY
    try {
      const res = await transferUsdc('0x' + '1'.repeat(40), '120000')
      expect(res.success).toBe(false)
      expect(res.error).toContain('OPERATOR_PRIVATE_KEY')
    } finally {
      if (prev !== undefined) process.env.OPERATOR_PRIVATE_KEY = prev
    }
  })
})
