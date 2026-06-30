/**
 * TB-06 (audit 2026-06-30): tests for the idempotent key-budget credit helper.
 *
 * Covers:
 *  - success via the idempotent RPC,
 *  - duplicate (chain_id, tx_hash) → alreadyCredited no-op (anti-replay),
 *  - migration-not-applied → fallback to legacy increment_key_budget,
 *  - other DB errors surfaced.
 */
import { describe, it, expect, vi } from 'vitest'
import { creditKeyBudgetIdempotent } from '@/lib/contracts/creditKeyBudget'

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

type RpcResult = { error: { code?: string; message?: string } | null }

function makeSupabase(rpcImpl: (fn: string) => RpcResult) {
  const rpc = vi.fn((fn: string) => Promise.resolve(rpcImpl(fn)))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { rpc } as any, rpc }
}

const ARGS = {
  keyId:   'key-uuid',
  amount:  10,
  ownerId: 'owner-uuid',
  chainId: 43113,
  txHash:  '0xabc',
}

describe('creditKeyBudgetIdempotent', () => {
  it('credits via the idempotent RPC on success', async () => {
    const { client, rpc } = makeSupabase(() => ({ error: null }))
    const res = await creditKeyBudgetIdempotent(client, ARGS)
    expect(res).toEqual({ ok: true, idempotent: true })
    expect(rpc).toHaveBeenCalledWith('increment_key_budget_idempotent', {
      p_key_id: 'key-uuid', p_amount: 10, p_owner_id: 'owner-uuid', p_chain_id: 43113, p_tx_hash: '0xabc',
    })
  })

  it('returns alreadyCredited (no-op) on a duplicate (chain_id, tx_hash)', async () => {
    const { client, rpc } = makeSupabase(() => ({
      error: { message: 'DEPOSIT_ALREADY_CREDITED: chain 43113 tx 0xabc already credited' },
    }))
    const res = await creditKeyBudgetIdempotent(client, ARGS)
    expect(res).toEqual({ ok: false, alreadyCredited: true })
    // Must NOT fall back to the legacy RPC (would double-credit).
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('falls back to legacy increment_key_budget when the idempotent RPC is missing (PGRST202)', async () => {
    const { client, rpc } = makeSupabase((fn) =>
      fn === 'increment_key_budget_idempotent'
        ? { error: { code: 'PGRST202', message: 'Could not find the function' } }
        : { error: null },
    )
    const res = await creditKeyBudgetIdempotent(client, ARGS)
    expect(res).toEqual({ ok: true, idempotent: false })
    expect(rpc).toHaveBeenNthCalledWith(2, 'increment_key_budget', {
      p_key_id: 'key-uuid', p_amount: 10, p_owner_id: 'owner-uuid',
    })
  })

  it('falls back to legacy when Postgres raises 42883 (undefined_function)', async () => {
    const { client } = makeSupabase((fn) =>
      fn === 'increment_key_budget_idempotent'
        ? { error: { code: '42883', message: 'function does not exist' } }
        : { error: null },
    )
    const res = await creditKeyBudgetIdempotent(client, ARGS)
    expect(res).toEqual({ ok: true, idempotent: false })
  })

  it('surfaces an unexpected DB error', async () => {
    const { client } = makeSupabase(() => ({ error: { code: '23505', message: 'some other error' } }))
    const res = await creditKeyBudgetIdempotent(client, ARGS)
    expect(res).toEqual({ ok: false, alreadyCredited: false, error: 'some other error' })
  })
})
