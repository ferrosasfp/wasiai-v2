/**
 * td-002-proxy-loop.test.ts
 *
 * Tests para el fix TD-002 sobre /api/v1/capabilities:
 *   - Loop detection (a2a → v2 → a2a recursion break).
 *   - Param mapping v2 → a2a.
 *
 * No alcanza al legacy handler (sigue intacto bajo el flag off).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock env BEFORE importing the route (env is read at module load).
vi.mock('@/lib/env', () => ({
  env: {
    WASIAI_A2A_BASE_URL: 'http://a2a.local',
    WASIAI_V2_FORWARD_KEY: 'test-forward-key-1234567890abcd',
    V2_DELEGATE_TO_A2A: 'compose,orchestrate,capabilities',
    NODE_ENV: 'test',
  },
}))

// Mock forward-handler — delegation always reports true; we observe the
// rewritten URL passed to forwardRequest.
const mockForwardRequest = vi.fn()
const mockIsDelegated = vi.fn<(_e: 'compose' | 'orchestrate' | 'capabilities' | 'mcp') => boolean>()

vi.mock('@/lib/proxy/forward-handler', () => ({
  isDelegated: (e: 'compose' | 'orchestrate' | 'capabilities' | 'mcp') => mockIsDelegated(e),
  forwardRequest: (...args: unknown[]) => mockForwardRequest(...args),
}))

// Mock supabase + chain helpers for legacy handler path.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
      }),
    }),
  })),
}))
vi.mock('@/lib/contracts/WasiAIMarketplace', () => ({
  getMarketplaceAddress: () => '0xabc',
}))
vi.mock('@/lib/chain', () => ({
  CHAIN_ID: 43113,
  CHAIN_NAME: 'avalanche-testnet',
}))

import { GET } from '../route'

function makeGet(
  url: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(url, { method: 'GET', headers: new Headers(headers) })
}

describe('GET /api/v1/capabilities — TD-002 fixes', () => {
  beforeEach(() => {
    mockForwardRequest.mockReset()
    mockForwardRequest.mockResolvedValue(
      new Response(JSON.stringify({ agents: [], total: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    mockIsDelegated.mockReset()
    mockIsDelegated.mockReturnValue(true)
  })

  describe('TD-002 loop detection', () => {
    it('forces legacy handler when x-agent-key is present and x-wasiai-source is missing (a2a callback)', async () => {
      const req = makeGet('http://v2.local/api/v1/capabilities?limit=20', {
        'x-agent-key': 'wasi_aaaa',
      })
      await GET(req)
      // legacy path returns directly — forwardRequest never called.
      expect(mockForwardRequest).not.toHaveBeenCalled()
    })

    it('delegates normally when x-wasiai-source=v2-proxy is set (frontal proxy hop)', async () => {
      const req = makeGet('http://v2.local/api/v1/capabilities?limit=20', {
        'x-agent-key': 'wasi_aaaa',
        'x-wasiai-source': 'v2-proxy',
      })
      await GET(req)
      expect(mockForwardRequest).toHaveBeenCalledTimes(1)
    })

    it('delegates normally for an external client (no x-agent-key)', async () => {
      const req = makeGet('http://v2.local/api/v1/capabilities?limit=20')
      await GET(req)
      expect(mockForwardRequest).toHaveBeenCalledTimes(1)
    })
  })

  describe('TD-002 param mapping v2 → a2a', () => {
    it('rewrites tag → capabilities, max_price → maxPrice, min_reputation → minReputation', async () => {
      const req = makeGet(
        'http://v2.local/api/v1/capabilities?tag=defi&max_price=0.5&min_reputation=0.8&limit=10',
      )
      await GET(req)
      expect(mockForwardRequest).toHaveBeenCalledTimes(1)
      const forwardedReq = mockForwardRequest.mock.calls[0][0] as NextRequest
      const url = new URL(forwardedReq.url)
      expect(url.searchParams.get('capabilities')).toBe('defi')
      expect(url.searchParams.get('maxPrice')).toBe('0.5')
      expect(url.searchParams.get('minReputation')).toBe('0.8')
      expect(url.searchParams.get('limit')).toBe('10')
      // legacy names should be removed.
      expect(url.searchParams.get('tag')).toBeNull()
      expect(url.searchParams.get('max_price')).toBeNull()
      expect(url.searchParams.get('min_reputation')).toBeNull()
    })

    it('keeps existing canonical names untouched when both present (a2a names win)', async () => {
      const req = makeGet(
        'http://v2.local/api/v1/capabilities?tag=defi&capabilities=oracle',
      )
      await GET(req)
      const forwardedReq = mockForwardRequest.mock.calls[0][0] as NextRequest
      const url = new URL(forwardedReq.url)
      // a2a name wins; legacy `tag` left alone (not deleted because we only
      // rewrite when target name was missing).
      expect(url.searchParams.get('capabilities')).toBe('oracle')
      expect(url.searchParams.get('tag')).toBe('defi')
    })

    it('passes q and limit through unchanged', async () => {
      const req = makeGet(
        'http://v2.local/api/v1/capabilities?q=oracle&limit=5',
      )
      await GET(req)
      const forwardedReq = mockForwardRequest.mock.calls[0][0] as NextRequest
      const url = new URL(forwardedReq.url)
      expect(url.searchParams.get('q')).toBe('oracle')
      expect(url.searchParams.get('limit')).toBe('5')
    })

    it('is a noop when no v2-style params are present', async () => {
      const req = makeGet('http://v2.local/api/v1/capabilities?limit=20')
      await GET(req)
      const forwardedReq = mockForwardRequest.mock.calls[0][0] as NextRequest
      const url = new URL(forwardedReq.url)
      expect(url.searchParams.get('limit')).toBe('20')
      expect([...url.searchParams.keys()].sort()).toEqual(['limit'])
    })
  })
})
