/**
 * AC-7 (H-6): el log '[Middleware Run]' solo debe emitirse en development.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
  mocks.getUser.mockResolvedValue({ data: { user: null } })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('AC-7: [Middleware Run] log gated by isDev', () => {
  it('does NOT log [Middleware Run] in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await middleware(makeRequest('/en/admin'))
    const loggedMiddlewareRun = spy.mock.calls.some(
      (args) => typeof args[0] === 'string' && args[0].includes('[Middleware Run]'),
    )
    expect(loggedMiddlewareRun).toBe(false)
    spy.mockRestore()
  })

  it('logs [Middleware Run] in development', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await middleware(makeRequest('/en/admin'))
    const loggedMiddlewareRun = spy.mock.calls.some(
      (args) => typeof args[0] === 'string' && args[0].includes('[Middleware Run]'),
    )
    expect(loggedMiddlewareRun).toBe(true)
    spy.mockRestore()
  })
})
