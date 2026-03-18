/**
 * GET /api/creator/transactions
 *
 * Returns paginated transaction history for the authenticated creator:
 * - key_batch_settlements (type: "settlement")
 * - creator_withdrawal_vouchers (type: "withdrawal")
 * - agent_calls (type: "call")
 *
 * WAS-225: Transaction History
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const PER_PAGE = 20

interface SettlementRow {
  id: string
  key_id: string
  tx_hash: string | null
  total_usdc: number | string
  call_count: number
  status: string
  confirmed_at: string | null
}

interface WithdrawalRow {
  id: string
  creator_id: string
  gross_amount_usdc: number | string
  status: string
  created_at: string
  tx_hash: string | null
}

interface CallRow {
  id: string
  agent_id: string
  agent_slug: string | null
  amount_paid: number | string
  status: string
  called_at: string
  settlement_batch_id: string | null
}

interface AgentRow {
  id: string
}

type TxItem =
  | { type: 'settlement'; date: string; call_count: number; total_usdc: string; tx_hash: string | null }
  | { type: 'withdrawal'; date: string; amount_usdc: string; tx_hash: string | null }
  | { type: 'call'; date: string; agent_slug: string | null; amount_usdc: string; status: string }

export async function GET(req: NextRequest) {
  // Auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const svc = createServiceClient()

  // Verify creator profile
  const { data: profile } = await svc
    .from('creator_profiles')
    .select('id, wallet_address')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const hasWallet = !!profile.wallet_address

  // Parse page param
  const pageParam = req.nextUrl.searchParams.get('page')
  const parsed = parseInt(pageParam ?? '1', 10)
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1

  // Get creator's agent IDs
  const { data: agentRows } = await svc
    .from('agents')
    .select('id')
    .eq('creator_id', profile.id)

  const agentIds: string[] = (agentRows as AgentRow[] ?? []).map((a) => a.id)

  // Collect all transactions
  const allItems: TxItem[] = []

  // Fetch settlements (via agent keys → key_batch_settlements)
  // key_id is TEXT — join via agent_keys
  if (hasWallet) {
    const { data: keyRows } = await svc
      .from('agent_keys')
      .select('id')
      .eq('creator_id', profile.id)

    const keyIds: string[] = (keyRows ?? []).map((k: { id: string }) => k.id)

    if (keyIds.length > 0) {
      const { data: settlements } = await svc
        .from('key_batch_settlements')
        .select('id, key_id, tx_hash, total_usdc, call_count, status, confirmed_at')
        .in('key_id', keyIds)

      for (const s of (settlements as SettlementRow[] ?? [])) {
        allItems.push({
          type: 'settlement',
          date: s.confirmed_at ?? '',
          call_count: s.call_count,
          total_usdc: String(s.total_usdc ?? '0'),
          tx_hash: s.tx_hash ?? null,
        })
      }
    }

    // Fetch withdrawals
    const { data: withdrawals } = await svc
      .from('creator_withdrawal_vouchers')
      .select('id, creator_id, gross_amount_usdc, status, created_at, tx_hash')
      .eq('creator_id', profile.id)

    for (const w of (withdrawals as WithdrawalRow[] ?? [])) {
      allItems.push({
        type: 'withdrawal',
        date: w.created_at,
        amount_usdc: String(w.gross_amount_usdc ?? '0'),
        tx_hash: w.tx_hash ?? null,
      })
    }
  }

  // Fetch calls (always — regardless of wallet)
  if (agentIds.length > 0) {
    const { data: calls } = await svc
      .from('agent_calls')
      .select('id, agent_id, agent_slug, amount_paid, status, called_at, settlement_batch_id')
      .in('agent_id', agentIds)

    for (const c of (calls as CallRow[] ?? [])) {
      allItems.push({
        type: 'call',
        date: c.called_at,
        agent_slug: c.agent_slug ?? null,
        amount_usdc: String(c.amount_paid ?? '0'),
        status: c.status,
      })
    }
  }

  // Sort by date descending
  allItems.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0
    const db = b.date ? new Date(b.date).getTime() : 0
    return db - da
  })

  const total = allItems.length
  const offset = (page - 1) * PER_PAGE
  const slice = allItems.slice(offset, offset + PER_PAGE)

  return NextResponse.json({
    data: slice,
    total,
    page,
    per_page: PER_PAGE,
  })
}
