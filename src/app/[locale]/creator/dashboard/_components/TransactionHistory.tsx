/**
 * TransactionHistory.tsx — Async sub-component for transaction history
 *
 * WAS-225: Shows settlements, withdrawals, and calls for the creator.
 * WAS-190: Links settlements and withdrawals to Snowtrace via explorerTx().
 *
 * Follows EarningsSection pattern — async server component wrapped in Suspense.
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { explorerTx } from '@/lib/chain'

const TX_HASH_REGEX = /^0x[0-9a-fA-F]{64}$/
const PER_PAGE = 20

function isValidTxHash(hash: string | null | undefined): hash is string {
  return !!hash && TX_HASH_REGEX.test(hash)
}

type TxItem =
  | { type: 'settlement'; date: string; call_count: number; total_usdc: string; tx_hash: string | null }
  | { type: 'withdrawal'; date: string; amount_usdc: string; tx_hash: string | null }
  | { type: 'call'; date: string; agent_slug: string | null; amount_usdc: string; status: string }

interface TransactionHistoryProps {
  userId: string
  page?: number
}

interface AgentKeyRow { id: string }
interface AgentRow { id: string }

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

export async function TransactionHistory({ userId, page = 1 }: TransactionHistoryProps) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== userId) return null

  const svc = createServiceClient()

  // Verify creator profile
  const { data: profile } = await svc
    .from('creator_profiles')
    .select('id, wallet_address')
    .eq('id', userId)
    .single()

  if (!profile) return null

  const hasWallet = !!profile.wallet_address
  const allItems: TxItem[] = []

  // Settlements and withdrawals only if has wallet
  if (hasWallet) {
    const { data: keyRows } = await svc
      .from('agent_keys')
      .select('id')
      .eq('creator_id', profile.id)

    const keyIds: string[] = ((keyRows ?? []) as AgentKeyRow[]).map((k) => k.id)

    if (keyIds.length > 0) {
      const { data: settlements } = await svc
        .from('key_batch_settlements')
        .select('id, key_id, tx_hash, total_usdc, call_count, status, confirmed_at')
        .in('key_id', keyIds)

      for (const s of (settlements ?? []) as SettlementRow[]) {
        allItems.push({
          type: 'settlement',
          date: s.confirmed_at ?? '',
          call_count: s.call_count,
          total_usdc: String(s.total_usdc ?? '0'),
          tx_hash: s.tx_hash ?? null,
        })
      }
    }

    const { data: withdrawals } = await svc
      .from('creator_withdrawal_vouchers')
      .select('id, creator_id, gross_amount_usdc, status, created_at, tx_hash')
      .eq('creator_id', profile.id)

    for (const w of (withdrawals ?? []) as WithdrawalRow[]) {
      allItems.push({
        type: 'withdrawal',
        date: w.created_at,
        amount_usdc: String(w.gross_amount_usdc ?? '0'),
        tx_hash: w.tx_hash ?? null,
      })
    }
  }

  // Calls — always shown
  const { data: agentRows } = await svc
    .from('agents')
    .select('id')
    .eq('creator_id', profile.id)

  const agentIds: string[] = ((agentRows ?? []) as AgentRow[]).map((a) => a.id)

  if (agentIds.length > 0) {
    const { data: calls } = await svc
      .from('agent_calls')
      .select('id, agent_id, agent_slug, amount_paid, status, called_at, settlement_batch_id')
      .in('agent_id', agentIds)

    for (const c of (calls ?? []) as CallRow[]) {
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
  const items = allItems.slice(offset, offset + PER_PAGE)

  return (
    <section className="rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-6 py-4 flex items-center gap-2">
        <div className="h-5 w-1 rounded-full bg-blue-500" />
        <h2 className="font-bold text-gray-900">Transaction History</h2>
        {total > 0 && (
          <span className="text-xs text-gray-400 font-normal">({total})</span>
        )}
      </div>

      {items.length === 0 ? (
        <div className="py-12 text-center">
          <p className="font-medium text-gray-700">No transactions yet</p>
          <p className="text-sm text-gray-400 mt-1">
            Your settlements, withdrawals, and calls will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-6 py-3 text-left">Type</th>
                <th className="px-6 py-3 text-left">Date</th>
                <th className="px-6 py-3 text-left">Details</th>
                <th className="px-6 py-3 text-right">Amount</th>
                <th className="px-6 py-3 text-center">Tx</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((item, idx) => (
                <tr key={idx} className="hover:bg-gray-50/50 transition">
                  <td className="px-6 py-3">
                    <TypeBadge type={item.type} />
                  </td>
                  <td className="px-6 py-3 text-xs text-gray-400">
                    {item.date ? new Date(item.date).toLocaleString('en-US') : '—'}
                  </td>
                  <td className="px-6 py-3 text-xs text-gray-600">
                    {item.type === 'settlement' && `${item.call_count} calls`}
                    {item.type === 'call' && (item.agent_slug ?? '—')}
                    {item.type === 'withdrawal' && 'Withdrawal'}
                  </td>
                  <td className="px-6 py-3 text-right font-semibold text-green-600 text-sm">
                    {item.type === 'settlement' && `$${Number(item.total_usdc).toFixed(4)}`}
                    {item.type === 'withdrawal' && `$${Number(item.amount_usdc).toFixed(4)}`}
                    {item.type === 'call' && `$${Number(item.amount_usdc).toFixed(4)}`}
                  </td>
                  <td className="px-6 py-3 text-center">
                    {(item.type === 'settlement' || item.type === 'withdrawal') &&
                    isValidTxHash(item.tx_hash) ? (
                      <a
                        href={explorerTx(item.tx_hash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-500 hover:underline font-mono"
                      >
                        {item.tx_hash.slice(0, 8)}…
                      </a>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function TypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    settlement: 'bg-blue-100 text-blue-700',
    withdrawal: 'bg-purple-100 text-purple-700',
    call: 'bg-gray-100 text-gray-700',
  }
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[type] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {type}
    </span>
  )
}

export function TransactionHistorySkeleton() {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white shadow-sm animate-pulse">
      <div className="border-b border-gray-100 px-6 py-4">
        <div className="h-5 w-48 rounded bg-gray-200" />
      </div>
      <div className="px-6 py-4 space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex gap-4">
            <div className="h-4 w-20 rounded bg-gray-100" />
            <div className="h-4 w-32 rounded bg-gray-100" />
            <div className="h-4 flex-1 rounded bg-gray-100" />
          </div>
        ))}
      </div>
    </section>
  )
}
