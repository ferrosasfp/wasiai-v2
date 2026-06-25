/**
 * V7 (audit 2026-06-25) — withdraw decrements the verified on-chain amount,
 * it does NOT reset pending_earnings_usdc to 0.
 *
 * Before: `update({ pending_earnings_usdc: 0 })` wiped any earnings accrued
 * between signing the voucher (T0) and the on-chain claim (T1). The claim only
 * released grossAmount(T0) → the creator silently lost the (T1 - T0) delta.
 *
 * Now: the route calls `decrement_pending_earnings(p_user_id, realAmount)` where
 * realAmount is decoded from the on-chain EarningsClaimed event (grossAmount),
 * NEVER a client value. The RPC clamps at 0 (GREATEST(... , 0)).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getUser:                vi.fn(),
  validateCsrf:           vi.fn(),
  serviceFrom:            vi.fn(),
  serviceRpc:             vi.fn(),
  profileSingle:          vi.fn(),
  withdrawalsMaybeSingle: vi.fn(),
  withdrawalsInsert:      vi.fn(),
  getTransactionReceipt:  vi.fn(),
}))

// topic0 = keccak256("EarningsClaimed(address,uint256,uint256,uint256,bytes32)")
const EARNINGS_CLAIMED_TOPIC = '0x7c1baf99431f82a970a4a3490e0d9ba64bffbe05e26ccc6e03ec6646aed8d667'
const MARKETPLACE_ADDR = '0x' + 'cc'.repeat(20)
const CREATOR_ADDR     = '0x' + '11'.repeat(20)
const USER_ID          = 'user-123'
const VALID_TX         = '0x' + 'a'.repeat(64)

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mocks.getUser },
      from: () => ({ select: () => ({ eq: () => ({ single: mocks.profileSingle }) }) }),
    }),
  ),
  createServiceClient: vi.fn(() => ({ from: mocks.serviceFrom, rpc: mocks.serviceRpc })),
}))

vi.mock('@/lib/security/csrf', () => ({ validateCsrf: mocks.validateCsrf }))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem')
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      getTransactionReceipt: mocks.getTransactionReceipt,
    })),
  }
})

vi.mock('@/lib/contracts/marketplaceClient', () => ({
  getPendingEarnings: vi.fn(),
}))

import { POST } from '../withdraw/route'

/** ABI-encode a single uint256 as a 64-hex-char word. */
function word(n: bigint): string {
  return n.toString(16).padStart(64, '0')
}

/** Build an EarningsClaimed log with grossAmount = `grossAtomic`. */
function earningsClaimedLog(grossAtomic: bigint) {
  // data = abi.encode(grossAmount, creatorShare, platformShare, nonce)
  const data = '0x' + word(grossAtomic) + word(grossAtomic) + word(0n) + word(0n)
  return {
    topics:  [EARNINGS_CLAIMED_TOPIC, '0x' + CREATOR_ADDR.slice(2).padStart(64, '0')],
    address: MARKETPLACE_ADDR,
    data,
  }
}

function makeRequest() {
  return new NextRequest('http://localhost/api/creator/withdraw', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ txHash: VALID_TX }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_CHAIN_ID = '43113'
  process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI = MARKETPLACE_ADDR

  mocks.validateCsrf.mockReturnValue(null)
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })
  mocks.profileSingle.mockResolvedValue({ data: { wallet_address: CREATOR_ADDR } })

  // No prior withdrawal for this txHash.
  mocks.withdrawalsMaybeSingle.mockResolvedValue({ data: null })
  mocks.withdrawalsInsert.mockReturnValue({ then: (cb: (r: { error: null }) => void) => cb({ error: null }) })
  // RPC decrement succeeds.
  mocks.serviceRpc.mockResolvedValue({ error: null })

  mocks.serviceFrom.mockImplementation((table: string) => {
    if (table === 'creator_withdrawals') {
      return {
        select: () => ({ eq: () => ({ maybeSingle: mocks.withdrawalsMaybeSingle }) }),
        insert: mocks.withdrawalsInsert,
      }
    }
    // creator_profiles — only reached if the route still used .update() (it shouldn't).
    return { update: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }) }
  })
})

describe('V7 — withdraw decrements verified amount, never resets to 0', () => {
  it('calls decrement_pending_earnings with the on-chain grossAmount (not a reset)', async () => {
    // grossAmount = 5 USDC (5_000_000 atomic). Creator may have accrued more since.
    mocks.getTransactionReceipt.mockResolvedValue({
      status: 'success',
      logs:   [earningsClaimedLog(5_000_000n)],
    })

    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.realAmount).toBe(5)

    // Atomic decrement of EXACTLY the verified amount — earnings accrued between
    // T0 and T1 are preserved, not wiped.
    expect(mocks.serviceRpc).toHaveBeenCalledWith('decrement_pending_earnings', {
      p_user_id: USER_ID,
      p_amount:  5,
    })
    // No blanket reset to 0 on creator_profiles.
    expect(mocks.serviceFrom).not.toHaveBeenCalledWith('creator_profiles')
  })

  it('rejects with 403 when the on-chain creator does not match the authenticated wallet', async () => {
    mocks.getTransactionReceipt.mockResolvedValue({
      status: 'success',
      logs:   [{
        topics:  [EARNINGS_CLAIMED_TOPIC, '0x' + ('22'.repeat(20)).padStart(64, '0')],
        address: MARKETPLACE_ADDR,
        data:    '0x' + word(5_000_000n) + word(5_000_000n) + word(0n) + word(0n),
      }],
    })

    const res = await POST(makeRequest())
    expect(res.status).toBe(403)
    expect(mocks.serviceRpc).not.toHaveBeenCalled()
  })
})
