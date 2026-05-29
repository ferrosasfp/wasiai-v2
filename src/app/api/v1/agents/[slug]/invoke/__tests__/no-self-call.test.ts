/**
 * AC-6 (H-5): el proxy /api/v1/agents/[slug]/invoke debe resolver in-process
 * (delegar a handleInvoke) sin self-call HTTP ni NEXT_PUBLIC_SITE_URL.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  handleInvoke: vi.fn(async () => NextResponse.json({ ok: true }, { status: 200 })),
  fetch: vi.fn(),
}))

vi.mock('@/lib/invoke/handleInvoke', () => ({
  handleInvoke: mocks.handleInvoke,
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => {
      const chain = {} as Record<string, ReturnType<typeof vi.fn>>
      for (const m of ['select', 'eq']) chain[m] = vi.fn().mockReturnValue(chain)
      chain.single = vi.fn().mockResolvedValue({ data: { free_trial_enabled: false }, error: null })
      return chain
    }),
  })),
}))

import { POST } from '@/app/api/v1/agents/[slug]/invoke/route'

function makeParams(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', mocks.fetch)
  delete process.env.NEXT_PUBLIC_SITE_URL
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AC-6: no self-call HTTP, in-process delegation', () => {
  it('returns 200 (not 502), never calls fetch, delegates to handleInvoke', async () => {
    const request = new NextRequest('http://localhost/api/v1/agents/echo/invoke', {
      method: 'POST',
      headers: {
        'X-API-Key':    'wasi_test',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: { q: 'hi' } }),
    })

    const res = await POST(request, makeParams('echo'))

    expect(res.status).toBe(200)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.handleInvoke).toHaveBeenCalledWith(expect.anything(), 'echo')
  })
})
