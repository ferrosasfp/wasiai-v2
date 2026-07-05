import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// V10 (audit 2026-06-25): a Supabase error on the wallet-update path must NOT
// leak its raw `message` (column/constraint names) to the client. The route
// must return a generic message + stable code, and log the raw error.

const mocks = vi.hoisted(() => ({
  getUser:     vi.fn(),
  from:        vi.fn(),
  validateCsrf: vi.fn(),
  triggerImmediateSettlement: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mocks.getUser },
      from: mocks.from,
    }),
  ),
}))

vi.mock('@/lib/security/csrf', () => ({
  validateCsrf: mocks.validateCsrf,
}))

vi.mock('@/lib/settlement/immediateSettlement', () => ({
  triggerImmediateSettlement: mocks.triggerImmediateSettlement,
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { POST } from '../wallet/route'

const RAW_SUPABASE_MSG =
  'duplicate key value violates unique constraint "creator_profiles_wallet_address_key"'

describe('POST /api/creator/wallet — V10 error leak guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateCsrf.mockReturnValue(null) // CSRF ok
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mocks.triggerImmediateSettlement.mockResolvedValue(undefined)
  })

  it('returns a generic message + code and logs the raw Supabase error', async () => {
    // First .from() call → SELECT current profile (no existing wallet).
    // Second .from() call → SELECT creator_earnings pending (WKH-SEC-03).
    // Third .from() call → UPDATE returns a Supabase error.
    const selectChain = {
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null }),
    }
    const earningsChain = {
      select:      vi.fn().mockReturnThis(),
      eq:          vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    }
    const updateChain = {
      update: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockResolvedValue({ error: { message: RAW_SUPABASE_MSG, code: '23505' } }),
    }
    mocks.from
      .mockReturnValueOnce(selectChain)
      .mockReturnValueOnce(earningsChain)
      .mockReturnValueOnce(updateChain)

    const req = new NextRequest('http://localhost/api/creator/wallet', {
      method: 'POST',
      body: JSON.stringify({ wallet_address: '0x' + 'a'.repeat(40) }),
      headers: { 'content-type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(500)

    const body = await res.json()
    // Client never sees the raw constraint string.
    expect(JSON.stringify(body)).not.toContain('constraint')
    expect(JSON.stringify(body)).not.toContain('creator_profiles_wallet_address_key')
    expect(body.error).toBe('Failed to update wallet address')
    expect(body.code).toBe('db_error')

    // Raw error was logged server-side.
    expect(mocks.loggerError).toHaveBeenCalled()
    const loggedSerialized = JSON.stringify(mocks.loggerError.mock.calls)
    expect(loggedSerialized).toContain('creator_profiles_wallet_address_key')
  })
})
