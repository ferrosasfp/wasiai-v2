import { describe, it, expect, vi, beforeEach } from 'vitest'

// V10 (audit 2026-06-25): the jsonError helper must NEVER echo raw error
// detail to the client — only a generic message + a stable machine code —
// and must log the raw detail server-side when provided.

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
  warn:  vi.fn(),
  info:  vi.fn(),
  debug: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({ logger: loggerMock }))

import { jsonError, jsonOk } from '../jsonError'

describe('jsonError (V10 — no raw error leak)', () => {
  beforeEach(() => {
    loggerMock.error.mockClear()
  })

  it('returns only a generic message + code to the client (no raw detail)', async () => {
    // Simulated Supabase error with internal column / constraint info.
    const supabaseError = {
      message: 'duplicate key value violates unique constraint "creator_profiles_wallet_address_key"',
      code:    '23505',
      details: 'Key (wallet_address)=(0xabc) already exists.',
      hint:    'internal-db-host:5432',
    }

    const res = jsonError('db_error', 'Failed to update wallet address', 500, {
      logDetail: supabaseError,
    })

    expect(res.status).toBe(500)
    const body = await res.json()

    // Client gets the generic message + stable code ONLY.
    expect(body).toEqual({ error: 'Failed to update wallet address', code: 'db_error' })

    // No internal Supabase detail leaked to the client.
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('constraint')
    expect(serialized).not.toContain('creator_profiles_wallet_address_key')
    expect(serialized).not.toContain('internal-db-host')
    expect(serialized).not.toContain('23505')
  })

  it('logs the raw detail server-side when logDetail is provided', () => {
    const err = new Error('ECONNREFUSED 10.0.0.5:5432')
    jsonError('read_failed', 'Contract read failed', 500, { logDetail: err })

    expect(loggerMock.error).toHaveBeenCalledTimes(1)
    const [msg, payload] = loggerMock.error.mock.calls[0]!
    expect(msg).toContain('read_failed')
    expect(payload).toMatchObject({ detail: err, status: 500 })
  })

  it('does not log when no logDetail is given', () => {
    jsonError('not_found', 'Agent not found', 404)
    expect(loggerMock.error).not.toHaveBeenCalled()
  })

  it('jsonOk returns the payload with the given status', async () => {
    const res = jsonOk({ ok: true, slug: 'agent-1' }, 201)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ok: true, slug: 'agent-1' })
  })
})
