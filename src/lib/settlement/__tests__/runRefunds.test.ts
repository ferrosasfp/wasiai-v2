/**
 * V6 — runRefunds processor tests.
 *
 * Exercises the refund processor: atomic claim, on-chain transfer (mocked),
 * marking done with tx_hash, and the anti double-refund invariant (a done
 * refund is never re-paid; a claimed-elsewhere row is skipped).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  transferUsdc: vi.fn(),
}))

vi.mock('@/lib/contracts/usdcSettler', () => ({
  transferUsdc: mocks.transferUsdc,
}))
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { runRefunds } from '../runRefunds'
import type { SupabaseClient } from '@supabase/supabase-js'

type RefundRow = {
  id: string
  settlement_tx_hash: string
  payer_address: string
  amount_usdc: string
  agent_slug: string | null
  status: string
}

/**
 * Builds a fake supabase client backed by an in-memory refunds table.
 * - .from('refunds').select().eq('status','pending').order().limit() → pending rows
 * - .rpc('claim_refund', {p_id}) → atomically flips pending→processing, returns row(s)
 * - .from('refunds').update({...}).eq('id', id) → mutates the row
 */
function makeFakeSupabase(rows: RefundRow[]) {
  const db = new Map(rows.map(r => [r.id, { ...r }]))

  const selectBuilder = () => {
    const b: Record<string, unknown> = {}
    b.select = vi.fn(() => b)
    b.eq     = vi.fn(() => b)
    b.order  = vi.fn(() => b)
    b.limit  = vi.fn(() =>
      Promise.resolve({
        data: [...db.values()].filter(r => r.status === 'pending'),
        error: null,
      }),
    )
    return b
  }

  const updateBuilder = (patch: Record<string, unknown>) => {
    const b: Record<string, unknown> = {}
    b.eq = vi.fn((_col: string, id: string) => {
      const row = db.get(id)
      if (row) Object.assign(row, patch)
      return Promise.resolve({ data: null, error: null })
    })
    return b
  }

  const fromImpl = vi.fn((table: string) => {
    if (table !== 'refunds') throw new Error(`unexpected table ${table}`)
    const sb = selectBuilder()
    return {
      select: sb.select,
      update: (patch: Record<string, unknown>) => updateBuilder(patch),
    }
  })

  const rpc = vi.fn((fn: string, args: { p_id: string }) => {
    if (fn !== 'claim_refund') throw new Error(`unexpected rpc ${fn}`)
    const row = db.get(args.p_id)
    // Atomic claim: only succeeds if still pending.
    if (row && row.status === 'pending') {
      row.status = 'processing'
      return Promise.resolve({ data: [{ ...row }], error: null })
    }
    return Promise.resolve({ data: [], error: null })
  })

  return {
    client: { from: fromImpl, rpc } as unknown as SupabaseClient,
    db,
  }
}

function row(over: Partial<RefundRow> = {}): RefundRow {
  return {
    id: 'refund-1',
    settlement_tx_hash: '0x' + 'f'.repeat(64),
    payer_address: '0x' + '1'.repeat(40),
    amount_usdc: '0.120000',
    agent_slug: 'demo-agent',
    status: 'pending',
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_CHAIN_ID = '43113'
})

describe('runRefunds — happy path', () => {
  it('pays a pending refund and marks it done with tx_hash', async () => {
    mocks.transferUsdc.mockResolvedValue({ success: true, transactionHash: '0xrefundtx' })
    const { client, db } = makeFakeSupabase([row()])

    const res = await runRefunds(client)

    expect(res.refunded).toBe(1)
    // transfer called with payer + atomic amount (0.12 USDC = 120000 micro)
    expect(mocks.transferUsdc).toHaveBeenCalledWith('0x' + '1'.repeat(40), '120000')
    const persisted = db.get('refund-1')!
    expect(persisted.status).toBe('done')
    expect((persisted as unknown as { refund_tx_hash: string }).refund_tx_hash).toBe('0xrefundtx')
  })

  it('no pending refunds → refunded 0, no transfer', async () => {
    const { client } = makeFakeSupabase([row({ status: 'done' })])
    const res = await runRefunds(client)
    expect(res.refunded).toBe(0)
    expect(mocks.transferUsdc).not.toHaveBeenCalled()
  })
})

describe('runRefunds — idempotency / anti double-refund', () => {
  it('does NOT re-pay a refund already done', async () => {
    mocks.transferUsdc.mockResolvedValue({ success: true, transactionHash: '0xtx' })
    const { client } = makeFakeSupabase([row({ status: 'done' })])

    const res = await runRefunds(client)

    expect(res.refunded).toBe(0)
    expect(mocks.transferUsdc).not.toHaveBeenCalled()
  })

  it('atomic claim: a row claimed by another worker is skipped (no double transfer)', async () => {
    mocks.transferUsdc.mockResolvedValue({ success: true, transactionHash: '0xtx' })
    const { client, db } = makeFakeSupabase([row()])

    // Simulate a concurrent worker having already claimed the row between the
    // SELECT and the claim_refund: force status to 'processing' so claim returns [].
    const r = db.get('refund-1')!
    r.status = 'processing'

    const res = await runRefunds(client)

    expect(res.refunded).toBe(0)
    expect(mocks.transferUsdc).not.toHaveBeenCalled()
  })

  it('processing twice in a row → transfer happens at most once', async () => {
    mocks.transferUsdc.mockResolvedValue({ success: true, transactionHash: '0xtx' })
    const { client } = makeFakeSupabase([row()])

    await runRefunds(client) // pays it (pending→done)
    const second = await runRefunds(client) // nothing pending now

    expect(mocks.transferUsdc).toHaveBeenCalledTimes(1)
    expect(second.refunded).toBe(0)
  })
})

describe('runRefunds — fail-safe', () => {
  it('transfer fails → row marked failed, never done, no tx_hash', async () => {
    mocks.transferUsdc.mockResolvedValue({ success: false, error: 'insufficient funds' })
    const { client, db } = makeFakeSupabase([row()])

    const res = await runRefunds(client)

    expect(res.refunded).toBe(0)
    const persisted = db.get('refund-1')!
    expect(persisted.status).toBe('failed')
    expect((persisted as unknown as { refund_tx_hash?: string }).refund_tx_hash).toBeUndefined()
  })

  it('transfer throws → row marked failed, never done', async () => {
    mocks.transferUsdc.mockRejectedValue(new Error('rpc down'))
    const { client, db } = makeFakeSupabase([row()])

    const res = await runRefunds(client)

    expect(res.refunded).toBe(0)
    expect(db.get('refund-1')!.status).toBe('failed')
  })
})
