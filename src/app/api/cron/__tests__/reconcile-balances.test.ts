/**
 * WKH-128 — auth + smoke tests for GET /api/cron/reconcile-balances.
 *
 * Verifies the cron-secret gate (constant-time, fail-closed) runs before any
 * DB or on-chain access, and that an accepted request reaches the reconciler
 * and emits the stable RECONCILE_DIVERGENCE alert when a key diverges.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  getKeyBalanceForReconcile: vi.fn(),
  getPendingEarningsForReconcile: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: mocks.createServiceClient,
}))

vi.mock('@/lib/contracts/marketplaceClient', () => ({
  getKeyBalanceForReconcile: mocks.getKeyBalanceForReconcile,
  getPendingEarningsForReconcile: mocks.getPendingEarningsForReconcile,
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: mocks.loggerError,
  },
}))

import { GET } from '../reconcile-balances/route'

/**
 * Minimal chainable Supabase query builder. Chain methods return self; the
 * builder is thenable so `await builder.limit(...)` resolves to terminalResult.
 */
function makeQueryBuilder(terminalResult: unknown) {
  const self = {} as Record<string, unknown>
  const chain = ['select', 'insert', 'update', 'not', 'eq', 'gt', 'order', 'limit']
  for (const m of chain) self[m] = vi.fn(() => self)
  Object.defineProperty(self, 'then', {
    configurable: true,
    enumerable: false,
    get() {
      return (resolve: (v: unknown) => unknown, reject?: (r?: unknown) => unknown) =>
        Promise.resolve(terminalResult).then(resolve, reject)
    },
  })
  return self
}

function makeRequest(authHeader?: string, search = '') {
  const headers: Record<string, string> = {}
  if (authHeader) headers.authorization = authHeader
  return new Request(`http://localhost/api/cron/reconcile-balances${search}`, { headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('MARKETPLACE_CONTRACT_ADDRESS', '0x000000000000000000000000000000000000dEaD')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /api/cron/reconcile-balances — cron auth', () => {
  it('fails closed (500) when CRON_SECRET is unset', async () => {
    vi.stubEnv('CRON_SECRET', '')
    const res = await GET(makeRequest('Bearer undefined'))
    expect(res.status).toBe(500)
    expect(mocks.createServiceClient).not.toHaveBeenCalled()
  })

  it('rejects (401) a wrong secret', async () => {
    vi.stubEnv('CRON_SECRET', 'right')
    const res = await GET(makeRequest('Bearer wrong'))
    expect(res.status).toBe(401)
    expect(mocks.createServiceClient).not.toHaveBeenCalled()
  })

  it('rejects (401) a missing Authorization header', async () => {
    vi.stubEnv('CRON_SECRET', 'right')
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    expect(mocks.createServiceClient).not.toHaveBeenCalled()
  })

  it('accepts the exact Bearer <secret> and runs the reconciler', async () => {
    vi.stubEnv('CRON_SECRET', 'right')
    // No keys, no creators → clean run.
    mocks.createServiceClient.mockReturnValue({
      from: (table: string) =>
        makeQueryBuilder({ data: table === 'agent_keys' ? [] : [], error: null }),
    })
    const res = await GET(makeRequest('Bearer right'))
    expect(res.status).toBe(200)
    expect(mocks.createServiceClient).toHaveBeenCalledOnce()
    const body = await res.json()
    expect(body.keys.divergences).toBe(0)
    expect(body.creators.divergences).toBe(0)
    expect(mocks.loggerError).not.toHaveBeenCalled()
  })
})

describe('GET /api/cron/reconcile-balances — divergence detection', () => {
  it('emits RECONCILE_DIVERGENCE when a key off-chain != on-chain beyond tolerance', async () => {
    vi.stubEnv('CRON_SECRET', 'right')
    mocks.createServiceClient.mockReturnValue({
      from: (table: string) => {
        if (table === 'agent_keys') {
          return makeQueryBuilder({
            data: [{ id: 'k1', key_hash: 'aa', budget_usdc: 10, spent_usdc: 0 }],
            error: null,
          })
        }
        if (table === 'creator_profiles') {
          return makeQueryBuilder({ data: [], error: null })
        }
        // reconcile_divergences insert → pretend table missing (best-effort)
        return makeQueryBuilder({ error: { message: 'relation does not exist' } })
      },
    })
    // On-chain shows 3 vs DB available 10 → divergence of 7.
    mocks.getKeyBalanceForReconcile.mockResolvedValue(3)

    const res = await GET(makeRequest('Bearer right'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.keys.divergences).toBe(1)
    expect(body.keys.skipped).toBe(0)
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'RECONCILE_DIVERGENCE',
      expect.objectContaining({ code: 'RECONCILE_DIVERGENCE' }),
    )
  })
})

describe('GET /api/cron/reconcile-balances — RPC error (MNR-2: null != 0)', () => {
  it('SKIPS a key whose on-chain read failed (null) — no divergence, no alert, no freeze', async () => {
    vi.stubEnv('CRON_SECRET', 'right')
    const freezeUpdate = vi.fn()
    mocks.createServiceClient.mockReturnValue({
      from: (table: string) => {
        if (table === 'agent_keys') {
          const b = makeQueryBuilder({
            data: [{ id: 'k1', key_hash: 'aa', budget_usdc: 10, spent_usdc: 0 }],
            error: null,
          }) as Record<string, unknown>
          b.update = freezeUpdate.mockReturnValue(b)
          return b
        }
        if (table === 'creator_profiles') {
          return makeQueryBuilder({ data: [], error: null })
        }
        return makeQueryBuilder({ error: { message: 'relation does not exist' } })
      },
    })
    // RPC error → reconcile reader returns null. Must NOT be read as on-chain=0.
    mocks.getKeyBalanceForReconcile.mockResolvedValue(null)

    // freeze=1 to also prove no freeze write happens for a skipped key.
    const res = await GET(makeRequest('Bearer right', '?freeze=1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.keys.checked).toBe(0)        // skipped key never reaches the reconciler
    expect(body.keys.divergences).toBe(0)
    expect(body.keys.skipped).toBe(1)
    expect(body.frozen).toBe(0)
    expect(freezeUpdate).not.toHaveBeenCalled()
    expect(mocks.loggerError).not.toHaveBeenCalled()
  })

  it('still fires divergence for a real mismatch when other keys have RPC errors', async () => {
    vi.stubEnv('CRON_SECRET', 'right')
    mocks.createServiceClient.mockReturnValue({
      from: (table: string) => {
        if (table === 'agent_keys') {
          return makeQueryBuilder({
            data: [
              { id: 'k-rpc', key_hash: 'aa', budget_usdc: 10, spent_usdc: 0 },
              { id: 'k-real', key_hash: 'bb', budget_usdc: 10, spent_usdc: 0 },
            ],
            error: null,
          })
        }
        if (table === 'creator_profiles') {
          return makeQueryBuilder({ data: [], error: null })
        }
        return makeQueryBuilder({ error: { message: 'relation does not exist' } })
      },
    })
    // First key: RPC error (null → skip). Second key: real divergence (10 vs 3).
    mocks.getKeyBalanceForReconcile
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(3)

    const res = await GET(makeRequest('Bearer right'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.keys.checked).toBe(1)        // only the successfully-read key
    expect(body.keys.skipped).toBe(1)
    expect(body.keys.divergences).toBe(1)
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'RECONCILE_DIVERGENCE',
      expect.objectContaining({ code: 'RECONCILE_DIVERGENCE' }),
    )
  })
})

describe('GET /api/cron/reconcile-balances — no contract', () => {
  it('skips when MARKETPLACE_CONTRACT_ADDRESS is unset', async () => {
    vi.stubEnv('CRON_SECRET', 'right')
    vi.stubEnv('MARKETPLACE_CONTRACT_ADDRESS', '')
    const res = await GET(makeRequest('Bearer right'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.skipped).toBe(true)
    expect(mocks.createServiceClient).not.toHaveBeenCalled()
  })
})
