/**
 * V6 — transferUsdc guard tests (no chain interaction).
 *
 * Full on-chain transfer is covered by the runRefunds processor test (transfer
 * mocked at the boundary). Here we assert the cheap guards that run before any
 * RPC / wallet setup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// V6 robustness: mock viem so we can drive writeContract / waitForTransactionReceipt
// to exercise the submit-vs-confirm boundary (txHash preservation on timeout).
const viemMocks = vi.hoisted(() => ({
  writeContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}))

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>()
  return {
    ...actual,
    createWalletClient: vi.fn(() => ({ writeContract: viemMocks.writeContract })),
    createPublicClient: vi.fn(() => ({ waitForTransactionReceipt: viemMocks.waitForTransactionReceipt })),
    http: vi.fn(() => ({})),
  }
})
vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn(() => ({ address: '0x' + '2'.repeat(40) })),
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

  // B2 (audit 2026-06-25) — max transfer cap (defense-in-depth).
  it('rejects an amount over the max transfer cap without touching the chain', async () => {
    const prevMax = process.env.MAX_OPERATOR_TRANSFER_USDC
    const prevPk = process.env.OPERATOR_PRIVATE_KEY
    process.env.MAX_OPERATOR_TRANSFER_USDC = '100' // 100 USDC = 100_000_000 atomic
    // PK present so we prove the cap (not the PK guard) is what rejects.
    process.env.OPERATOR_PRIVATE_KEY = '0x' + '1'.repeat(64)
    try {
      // 101 USDC = 101_000_000 atomic > cap
      const res = await transferUsdc('0x' + '1'.repeat(40), '101000000')
      expect(res.success).toBe(false)
      expect(res.error).toBe('amount exceeds max transfer cap')
    } finally {
      if (prevMax !== undefined) process.env.MAX_OPERATOR_TRANSFER_USDC = prevMax
      else delete process.env.MAX_OPERATOR_TRANSFER_USDC
      if (prevPk !== undefined) process.env.OPERATOR_PRIVATE_KEY = prevPk
      else delete process.env.OPERATOR_PRIVATE_KEY
    }
  })

  it('lets an amount within the cap proceed past the cap guard', async () => {
    const prevMax = process.env.MAX_OPERATOR_TRANSFER_USDC
    const prevPk = process.env.OPERATOR_PRIVATE_KEY
    process.env.MAX_OPERATOR_TRANSFER_USDC = '100'
    delete process.env.OPERATOR_PRIVATE_KEY // next guard after the cap
    try {
      // A typical cents-level refund (0.12 USDC) is well under the cap.
      const res = await transferUsdc('0x' + '1'.repeat(40), '120000')
      expect(res.success).toBe(false)
      // It got PAST the cap guard and hit the PK guard, proving the cap allowed it.
      expect(res.error).toContain('OPERATOR_PRIVATE_KEY')
      expect(res.error).not.toContain('max transfer cap')
    } finally {
      if (prevMax !== undefined) process.env.MAX_OPERATOR_TRANSFER_USDC = prevMax
      else delete process.env.MAX_OPERATOR_TRANSFER_USDC
      if (prevPk !== undefined) process.env.OPERATOR_PRIVATE_KEY = prevPk
    }
  })
})

// V6 robustness — submit-vs-confirm boundary: a txHash already obtained from
// writeContract must NEVER be discarded if confirmation later fails.
describe('transferUsdc — tx hash preservation (submit vs confirm)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_CHAIN_ID = '43113'
    process.env.OPERATOR_PRIVATE_KEY = '0x' + '1'.repeat(64)
    delete process.env.MAX_OPERATOR_TRANSFER_USDC
  })

  it('writeContract OK + waitForReceipt THROW (timeout) → returns the hash with unconfirmed:true', async () => {
    viemMocks.writeContract.mockResolvedValue('0xsubmittedhash')
    viemMocks.waitForTransactionReceipt.mockRejectedValue(new Error('Timed out while waiting for transaction receipt'))

    const res = await transferUsdc('0x' + '1'.repeat(40), '120000')

    expect(res.success).toBe(false)
    expect(res.transactionHash).toBe('0xsubmittedhash') // NOT lost
    expect(res.unconfirmed).toBe(true)
    expect(res.error).toContain('receipt unconfirmed')
  })

  it('writeContract THROW (never submitted) → no transactionHash, no unconfirmed flag', async () => {
    viemMocks.writeContract.mockRejectedValue(new Error('nonce too low'))

    const res = await transferUsdc('0x' + '1'.repeat(40), '120000')

    expect(res.success).toBe(false)
    expect(res.transactionHash).toBeUndefined()
    expect(res.unconfirmed).toBeUndefined()
    expect(res.error).toContain('nonce too low')
    expect(viemMocks.waitForTransactionReceipt).not.toHaveBeenCalled()
  })

  it('receipt status reverted → success:false with the hash in the error', async () => {
    viemMocks.writeContract.mockResolvedValue('0xrevertedhash')
    viemMocks.waitForTransactionReceipt.mockResolvedValue({ status: 'reverted' })

    const res = await transferUsdc('0x' + '1'.repeat(40), '120000')

    expect(res.success).toBe(false)
    expect(res.transactionHash).toBe('0xrevertedhash')
    expect(res.error).toContain('0xrevertedhash')
    expect(res.unconfirmed).toBeUndefined() // a revert is definitive, not "unconfirmed"
  })

  it('happy path: writeContract OK + receipt success → success:true with the hash', async () => {
    viemMocks.writeContract.mockResolvedValue('0xconfirmedhash')
    viemMocks.waitForTransactionReceipt.mockResolvedValue({ status: 'success' })

    const res = await transferUsdc('0x' + '1'.repeat(40), '120000')

    expect(res.success).toBe(true)
    expect(res.transactionHash).toBe('0xconfirmedhash')
    expect(res.unconfirmed).toBeUndefined()
  })
})
