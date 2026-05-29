/**
 * AC-2 (H-2): PATCH /api/admin/agents/:id exige firma EIP-712.
 *   - x-admin-wallet spoofeado, sin firma → 401 Y DB NO mutada.
 * AC-3 (H-3-zod): body validado con zod .strict().
 *   - status invalido → 400 con detail.
 *   - campo desconocido → 400 (.strict()), sin mutar.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  verifyAdminSignature: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/admin/verifyAdminSignature', () => ({
  verifyAdminSignature: mocks.verifyAdminSignature,
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => {
      const chain = {} as Record<string, ReturnType<typeof vi.fn>>
      chain.update = mocks.update.mockReturnValue(chain)
      for (const m of ['eq', 'select']) chain[m] = vi.fn().mockReturnValue(chain)
      chain.single = vi.fn().mockResolvedValue({ data: { id: 'agent-uuid', slug: 's', status: 'suspended', consecutive_failures: 0 }, error: null })
      return chain
    }),
  })),
}))

import { PATCH } from '@/app/api/admin/agents/[id]/route'

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function signedHeaders() {
  return {
    'x-admin-signature': '0x' + 'a'.repeat(130),
    'x-admin-nonce':     '0x' + '0'.repeat(64),
    'x-admin-timestamp': String(Math.floor(Date.now() / 1000)),
    'Content-Type':      'application/json',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AC-2: PATCH requires EIP-712, no mutation without signature', () => {
  it('returns 401 and does NOT call update when x-admin-wallet spoofed and no signature', async () => {
    const request = new NextRequest('http://localhost/api/admin/agents/agent-uuid', {
      method: 'PATCH',
      headers: {
        'x-admin-wallet': '0xf432baf1315ccDB23E683B95b03fD54Dd3e447Ba',
        'Content-Type':   'application/json',
      },
      body: JSON.stringify({ status: 'suspended' }),
    })
    const res = await PATCH(request, makeParams('agent-uuid'))
    expect(res.status).toBe(401)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.verifyAdminSignature).not.toHaveBeenCalled()
  })
})

describe('AC-3: zod .strict() validation', () => {
  it('returns 400 with detail when status is an invalid value (signature valid)', async () => {
    mocks.verifyAdminSignature.mockResolvedValue({ ok: true })
    const request = new NextRequest('http://localhost/api/admin/agents/agent-uuid', {
      method: 'PATCH',
      headers: signedHeaders(),
      body: JSON.stringify({ status: 'invalid_value' }),
    })
    const res = await PATCH(request, makeParams('agent-uuid'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.detail).toBeDefined()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('returns 400 for unknown field (.strict) and does NOT mutate', async () => {
    mocks.verifyAdminSignature.mockResolvedValue({ ok: true })
    const request = new NextRequest('http://localhost/api/admin/agents/agent-uuid', {
      method: 'PATCH',
      headers: signedHeaders(),
      body: JSON.stringify({ unknown_field: true }),
    })
    const res = await PATCH(request, makeParams('agent-uuid'))
    expect(res.status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
