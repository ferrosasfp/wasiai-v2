/**
 * AC-1 (H-1): GET /api/admin/agents debe exigir firma EIP-712.
 * - x-admin-wallet (spoofeable) se ignora → sin firma = 401.
 * - Con firma válida (owner) = 200.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyAdminSignature: vi.fn(),
  serviceFrom: vi.fn(),
}))

vi.mock('@/lib/admin/verifyAdminSignature', () => ({
  verifyAdminSignature: mocks.verifyAdminSignature,
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({
    from: mocks.serviceFrom,
  })),
}))

import { GET } from '@/app/api/admin/agents/route'

// Chainable supabase query builder.
function makeChain(result: unknown) {
  const chain = {} as Record<string, ReturnType<typeof vi.fn>>
  for (const m of ['select', 'eq', 'order', 'in']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  // The agents query resolves when awaited (no .single()); make it thenable.
  chain.then = (resolve: (v: unknown) => void) => resolve(result)
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AC-1: GET /api/admin/agents EIP-712 auth', () => {
  it('returns 401 when x-admin-wallet present but no EIP-712 signature (wallet ignored)', async () => {
    const request = new NextRequest('http://localhost/api/admin/agents', {
      headers: { 'x-admin-wallet': '0xf432baf1315ccDB23E683B95b03fD54Dd3e447Ba' },
    })
    const res = await GET(request)
    expect(res.status).toBe(401)
    // verifyAdminSignature no debió siquiera invocarse: faltan headers EIP-712.
    expect(mocks.verifyAdminSignature).not.toHaveBeenCalled()
  })

  it('returns 200 with valid EIP-712 signature', async () => {
    mocks.verifyAdminSignature.mockResolvedValue({ ok: true })
    mocks.serviceFrom.mockImplementation((table: string) => {
      if (table === 'agents') {
        return makeChain({ data: [{ id: 'a1', slug: 's1', name: 'A', status: 'active', creator_id: 'c1', endpoint_url: 'https://x.com/y' }], error: null })
      }
      // creator_profiles
      return makeChain({ data: [{ id: 'c1', username: 'creator' }], error: null })
    })

    const request = new NextRequest('http://localhost/api/admin/agents', {
      headers: {
        'x-admin-signature': '0x' + 'a'.repeat(130),
        'x-admin-nonce':     '0x' + '0'.repeat(64),
        'x-admin-timestamp': String(Math.floor(Date.now() / 1000)),
      },
    })
    const res = await GET(request)
    expect(res.status).toBe(200)
    expect(mocks.verifyAdminSignature).toHaveBeenCalled()
  })
})
