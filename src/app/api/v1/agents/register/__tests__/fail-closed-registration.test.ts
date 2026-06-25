/**
 * V5 (audit 2026-06-25) — registro fail-closed
 *
 * Verifica que la AUSENCIA de OPEN_REGISTRATION_KEY ya NO abra el registro
 * anónimo: un request sin método de auth válido debe devolver 401.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (solo lo necesario para llegar al bloque de auth) ──────────────────
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
  })),
  createServiceClient: vi.fn(() => ({
    from: vi.fn(),
    auth: { admin: {} },
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { POST } from '@/app/api/v1/agents/register/route'

function makeRequest(headers: Record<string, string> = {}, body: unknown = {}) {
  return new NextRequest('http://localhost/api/v1/agents/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('V5 — register fail-closed', () => {
  const originalKey = process.env.OPEN_REGISTRATION_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({ data: { user: null } })
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPEN_REGISTRATION_KEY
    else process.env.OPEN_REGISTRATION_KEY = originalKey
  })

  it('sin OPEN_REGISTRATION_KEY en env + request sin auth → 401 (fail-closed)', async () => {
    delete process.env.OPEN_REGISTRATION_KEY

    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toContain('Authentication required')
  })

  it('con OPEN_REGISTRATION_KEY seteada + x-register-key incorrecta → 401', async () => {
    process.env.OPEN_REGISTRATION_KEY = 'real-open-key'

    const res = await POST(makeRequest({ 'x-register-key': 'wrong-key' }))
    expect(res.status).toBe(401)
  })
})
