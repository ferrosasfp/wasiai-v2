/**
 * V13 (audit 2026-06-25) — admin auth constant-time
 *
 * Verifica que el chequeo de ADMIN_SECRET mantenga el mismo comportamiento
 * observable (válido → pasa, inválido → 401) tras pasar a timingSafeEqual.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({ from: mocks.from })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { GET } from '@/app/api/admin/disputes/route'

const ADMIN_SECRET = 'super-secret-admin-token-123'

function makeReq(authHeader?: string) {
  return new Request('http://localhost/api/admin/disputes', {
    method: 'GET',
    headers: authHeader ? { authorization: authHeader } : {},
  })
}

// Chain que resuelve a una lista vacía para el happy path
function makeListChain() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  ;['select', 'eq', 'order', 'limit'].forEach(m => {
    chain[m] = vi.fn().mockReturnValue(chain)
  })
  // El handler hace await sobre la query final → resolvemos a data: []
  chain.order = vi.fn().mockResolvedValue({ data: [], error: null })
  return chain
}

describe('V13 — admin disputes auth (constant-time)', () => {
  const original = process.env.ADMIN_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ADMIN_SECRET = ADMIN_SECRET
    mocks.from.mockReturnValue(makeListChain())
  })

  afterEach(() => {
    if (original === undefined) delete process.env.ADMIN_SECRET
    else process.env.ADMIN_SECRET = original
  })

  it('sin header authorization → 401', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('secret incorrecto (misma longitud) → 401', async () => {
    const wrong = `Bearer ${'x'.repeat(ADMIN_SECRET.length)}`
    const res = await GET(makeReq(wrong))
    expect(res.status).toBe(401)
  })

  it('secret incorrecto (distinta longitud) → 401', async () => {
    const res = await GET(makeReq('Bearer short'))
    expect(res.status).toBe(401)
  })

  it('secret correcto → NO 401 (pasa el guard de auth)', async () => {
    const res = await GET(makeReq(`Bearer ${ADMIN_SECRET}`))
    expect(res.status).not.toBe(401)
  })

  it('ADMIN_SECRET sin configurar → 401 aun con header', async () => {
    delete process.env.ADMIN_SECRET
    const res = await GET(makeReq(`Bearer ${ADMIN_SECRET}`))
    expect(res.status).toBe(401)
  })
})
