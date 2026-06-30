/**
 * TB-06 (audit 2026-06-30): tests for getDepositedUsdcFromReceipt — the deposit
 * amount must be decoded from the on-chain USDC Transfer log, not trusted from
 * the request body.
 *
 * We mock viem's client factories so getOperatorClient() returns a stub whose
 * getTransactionReceipt yields hand-built (real-encoded) Transfer logs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { encodeEventTopics, encodeAbiParameters, parseAbiItem, type Address } from 'viem'

const USDC: Address     = '0x5425890298aed601595a70AB815c96711a31Bc65'
const CONTRACT: Address = '0x1111111111111111111111111111111111111111'
const PAYER: Address    = '0x2222222222222222222222222222222222222222'
const OTHER: Address    = '0x3333333333333333333333333333333333333333'

const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')

function transferLog(from: Address, to: Address, value: bigint, address: Address = USDC) {
  return {
    address,
    topics: encodeEventTopics({ abi: [TRANSFER], eventName: 'Transfer', args: { from, to } }),
    data:   encodeAbiParameters([{ type: 'uint256' }], [value]),
  }
}

const mocks = vi.hoisted(() => ({ getTransactionReceipt: vi.fn() }))

// marketplaceClient imports 'server-only', which throws under the jsdom test
// environment. Stub it to a no-op so the module can load.
vi.mock('server-only', () => ({}))
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>()
  return {
    ...actual,
    createPublicClient: () => ({ getTransactionReceipt: mocks.getTransactionReceipt }),
    createWalletClient: () => ({}),
  }
})
vi.mock('viem/accounts', () => ({ privateKeyToAccount: () => ({ address: '0xop' }) }))
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { getDepositedUsdcFromReceipt } from '@/lib/contracts/marketplaceClient'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.OPERATOR_PRIVATE_KEY = '0x' + '1'.repeat(64)
  process.env.MARKETPLACE_CONTRACT_ADDRESS = CONTRACT
  process.env.NEXT_PUBLIC_CHAIN_ID = '43113'
})

describe('getDepositedUsdcFromReceipt', () => {
  it('decodes the USDC Transfer amount to the marketplace contract', async () => {
    mocks.getTransactionReceipt.mockResolvedValue({
      logs: [transferLog(PAYER, CONTRACT, 10_000_000n)], // 10 USDC
    })
    const amount = await getDepositedUsdcFromReceipt('0xtx', USDC, PAYER)
    expect(amount).toBe(10)
  })

  it('ignores Transfer logs to a different recipient', async () => {
    mocks.getTransactionReceipt.mockResolvedValue({
      logs: [transferLog(PAYER, OTHER, 50_000_000n)],
    })
    const amount = await getDepositedUsdcFromReceipt('0xtx', USDC, PAYER)
    expect(amount).toBeNull()
  })

  it('ignores Transfer logs from a token other than USDC', async () => {
    mocks.getTransactionReceipt.mockResolvedValue({
      logs: [transferLog(PAYER, CONTRACT, 9_000_000n, OTHER /* not USDC */)],
    })
    const amount = await getDepositedUsdcFromReceipt('0xtx', USDC, PAYER)
    expect(amount).toBeNull()
  })

  it('filters by the depositor (from) when provided', async () => {
    mocks.getTransactionReceipt.mockResolvedValue({
      logs: [transferLog(OTHER, CONTRACT, 7_000_000n)],
    })
    const amount = await getDepositedUsdcFromReceipt('0xtx', USDC, PAYER)
    expect(amount).toBeNull()
  })

  it('returns null when the receipt read throws', async () => {
    mocks.getTransactionReceipt.mockRejectedValue(new Error('rpc down'))
    const amount = await getDepositedUsdcFromReceipt('0xtx', USDC, PAYER)
    expect(amount).toBeNull()
  })
})
