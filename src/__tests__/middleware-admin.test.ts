/**
 * AC-4 (H-3): /admin pages must be protected by the middleware.
 * Sin sesión a /en/admin → 307 redirect a /en/login.
 * Con sesión → no redirige a login.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
}))

vi.mock('next-intl/middleware', () => ({
  default: vi.fn(() => vi.fn(() => NextResponse.next())),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: mocks.getUser },
  })),
}))

import { middleware } from '../../middleware'

function makeRequest(path: string) {
  return new NextRequest(`http://localhost${path}`)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AC-4: /admin protected route', () => {
  it('redirects unauthenticated request to /en/admin → 307 /en/login', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } })
    const res = await middleware(makeRequest('/en/admin'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/en/login')
  })

  it('does NOT redirect authenticated request to /en/admin', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    const res = await middleware(makeRequest('/en/admin'))
    const location = res.headers.get('location')
    const redirectsToLogin = res.status === 307 && !!location && location.includes('/login')
    expect(redirectsToLogin).toBe(false)
  })
})
