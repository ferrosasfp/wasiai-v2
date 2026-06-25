/**
 * V8 (audit 2026-06-25) — concurrent withdrawal vouchers over the same balance.
 *
 * Before: the route signed an EIP-712 voucher for grossAmount =
 * pending_earnings_usdc(T0) and inserted the audit row fire-and-forget. Two
 * requests within the 10/h rate-limit window both read the same balance and both
 * got a valid signature with distinct nonces → a possible ~2x on-chain claim.
 *
 * Now: the route reserves the voucher slot ATOMICALLY via
 * insert_voucher_if_none_pending BEFORE signing. If a pending, non-expired
 * voucher already exists for the creator the RPC returns false and the route
 * rejects with 409 — no second signature is ever produced.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getUser:       vi.fn(),
  validateCsrf:  vi.fn(),
  checkRateLimit: vi.fn(),
  profileSingle: vi.fn(),
  rpc:           vi.fn(),
  signTypedData: vi.fn(),
}))

const USER_ID       = 'creator-123'
const WALLET        = '0x' + '11'.repeat(20)
const MARKETPLACE   = '0x' + 'cc'.repeat(20)

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mocks.getUser },
      from: () => ({ select: () => ({ eq: () => ({ single: mocks.profileSingle }) }) }),
      rpc:  mocks.rpc,
    }),
  ),
}))

vi.mock('@/lib/security/csrf', () => ({ validateCsrf: mocks.validateCsrf }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/ratelimit', () => ({
  getKeysLimit:   vi.fn(() => ({})),
  getIdentifier:  vi.fn(() => 'id'),
  checkRateLimit: mocks.checkRateLimit,
}))

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem')
  return {
    ...actual,
    createWalletClient: vi.fn(() => ({ signTypedData: mocks.signTypedData })),
  }
})
vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn(() => ({ address: '0x' + 'ab'.repeat(20) })),
}))

import { POST } from '../route'

function makeRequest() {
  return new NextRequest('http://localhost/api/creator/earnings/voucher', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_CHAIN_ID = '43113'
  process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI = MARKETPLACE
  process.env.OPERATOR_PRIVATE_KEY = '0x' + 'de'.repeat(32)

  mocks.validateCsrf.mockReturnValue(null)
  mocks.checkRateLimit.mockResolvedValue(null)
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })
  mocks.profileSingle.mockResolvedValue({
    data: { wallet_address: WALLET, pending_earnings_usdc: '5.000000' },
  })
  mocks.signTypedData.mockResolvedValue('0x' + 'ee'.repeat(65))
  // Default: slot reserved (no pending voucher exists).
  mocks.rpc.mockResolvedValue({ data: true, error: null })
})

describe('V8 — voucher slot is reserved atomically before signing', () => {
  it('signs and returns 200 when no pending voucher exists (reservation wins)', async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.signature).toBeDefined()
    expect(body.grossAmountUsdc).toBe(5)

    // The reservation RPC ran BEFORE signing.
    expect(mocks.rpc).toHaveBeenCalledWith(
      'insert_voucher_if_none_pending',
      expect.objectContaining({ p_creator_id: USER_ID, p_gross_amount: 5 }),
    )
    expect(mocks.signTypedData).toHaveBeenCalledTimes(1)
  })

  it('rejects with 409 and does NOT sign when a pending voucher already exists', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null })

    const res = await POST(makeRequest())
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/pending withdrawal voucher already exists/i)
    // Critical: no signature produced for the second voucher.
    expect(mocks.signTypedData).not.toHaveBeenCalled()
  })

  it('only one of two concurrent requests gets a signature', async () => {
    // The DB-level atomic INSERT ... WHERE NOT EXISTS lets exactly one win.
    mocks.rpc
      .mockResolvedValueOnce({ data: true,  error: null })
      .mockResolvedValueOnce({ data: false, error: null })

    const [res1, res2] = await Promise.all([POST(makeRequest()), POST(makeRequest())])
    const statuses = [res1.status, res2.status].sort()
    expect(statuses).toEqual([200, 409])
    // Exactly one signature across both concurrent requests.
    expect(mocks.signTypedData).toHaveBeenCalledTimes(1)
  })

  it('returns 500 if the reservation RPC errors (fails closed, no signing)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'db down' } })
    const res = await POST(makeRequest())
    expect(res.status).toBe(500)
    expect(mocks.signTypedData).not.toHaveBeenCalled()
  })
})
