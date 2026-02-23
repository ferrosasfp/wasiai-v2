import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPendingEarnings } from '@/lib/contracts/marketplaceClient'
import { WithdrawButton } from './WithdrawButton'
import { WalletSetup } from './WalletSetup'

interface ModelRow {
  id: string
  name: string
  slug: string
  category: string
  status: string
  price_per_call: number
  total_calls: number
  total_revenue: number
  created_at: string
}

interface CallRow {
  id: string
  agent_id: string
  caller_type: string
  amount_paid: number
  status: string
  latency_ms: number | null
  created_at: string
  agent: { name: string; slug: string } | null
}

export default async function CreatorDashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/${locale ?? 'en'}/login`)

  // Fetch creator profile (wallet)
  const { data: profile } = await supabase
    .from('creator_profiles')
    .select('wallet_address')
    .eq('id', user.id)
    .single()

  // Fetch pending on-chain earnings
  const pendingOnChain = profile?.wallet_address
    ? await getPendingEarnings(profile.wallet_address).catch(() => 0)
    : 0

  // Fetch creator's models
  const { data: models } = await supabase
    .from('agents')
    .select('id, name, slug, category, status, price_per_call, total_calls, total_revenue, created_at')
    .eq('creator_id', user.id)
    .order('total_calls', { ascending: false })

  const safeModels: ModelRow[] = models ?? []

  // Aggregate stats
  const totalCalls = safeModels.reduce((s, m) => s + (m.total_calls ?? 0), 0)
  const totalRevenue = safeModels.reduce((s, m) => s + Number(m.total_revenue ?? 0), 0)
  const activeModels = safeModels.filter(m => m.status === 'active').length

  // Fetch last 20 calls across all creator models
  const modelIds = safeModels.map(m => m.id)
  let recentCalls: CallRow[] = []
  if (modelIds.length > 0) {
    const { data: calls } = await supabase
      .from('agent_calls')
      .select('id, agent_id, caller_type, amount_paid, status, latency_ms, created_at, agent:agents(name, slug)')
      .in('agent_id', modelIds)
      .order('created_at', { ascending: false })
      .limit(20)
    recentCalls = (calls as unknown as CallRow[]) ?? []
  }

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-10">
      <div className="mx-auto max-w-5xl space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Creator Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">{user.email}</p>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Total Models" value={safeModels.length.toString()} icon="📦" />
          <StatCard label="Active" value={activeModels.toString()} icon="✅" />
          <StatCard label="Total Calls" value={totalCalls.toLocaleString('en-US')} icon="⚡" />
          <StatCard
            label="Revenue"
            value={`$${totalRevenue.toFixed(2)}`}
            icon="💰"
            highlight
          />
        </div>

        {/* On-chain Earnings Withdrawal */}
        <section className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-purple-50 p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-gray-900">On-chain Earnings</h2>
              <p className="mt-1 text-sm text-gray-500">
                Your USDC earnings accumulated in{' '}
                <a
                  href={`https://${Number(process.env.NEXT_PUBLIC_CHAIN_ID) === 43114 ? '' : 'testnet.'}snowscan.xyz/address/${process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-500 hover:underline"
                >
                  WasiAIMarketplace.sol
                </a>
              </p>
              <WalletSetup initialWallet={profile?.wallet_address ?? null} />
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-3xl font-bold text-indigo-700">
                  ${pendingOnChain.toFixed(2)}
                </p>
                <p className="text-xs text-gray-500">USDC available</p>
              </div>
              <WithdrawButton
                pending={pendingOnChain}
                hasWallet={!!profile?.wallet_address}
              />
            </div>
          </div>
        </section>

        {/* Models table */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Your Models</h2>
            <Link
              href={`/${locale}/publish`}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition"
            >
              + Publish Model
            </Link>
          </div>

          {safeModels.length === 0 ? (
            <EmptyState
              icon="📭"
              title="No models yet"
              subtitle="Publish your first model to start earning."
              cta={{ label: 'Publish Model', href: '/publish' }}
            />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-6 py-3 text-left">Model</th>
                    <th className="px-6 py-3 text-left">Category</th>
                    <th className="px-6 py-3 text-right">Price</th>
                    <th className="px-6 py-3 text-right">Calls</th>
                    <th className="px-6 py-3 text-right">Revenue</th>
                    <th className="px-6 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {safeModels.map((model) => (
                    <tr key={model.id} className="hover:bg-gray-50/50 transition">
                      <td className="px-6 py-4">
                        <Link
                          href={`/models/${model.slug}`}
                          className="font-medium text-gray-900 hover:text-indigo-600"
                        >
                          {model.name}
                        </Link>
                        <p className="text-xs text-gray-400">{model.slug}</p>
                      </td>
                      <td className="px-6 py-4">
                        <CategoryBadge category={model.category} />
                      </td>
                      <td className="px-6 py-4 text-right text-gray-700">
                        ${model.price_per_call.toFixed(3)}
                      </td>
                      <td className="px-6 py-4 text-right font-medium text-gray-900">
                        {(model.total_calls ?? 0).toLocaleString('en-US')}
                      </td>
                      <td className="px-6 py-4 text-right font-semibold text-green-600">
                        ${Number(model.total_revenue ?? 0).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <StatusBadge status={model.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Recent calls */}
        <section>
          <h2 className="mb-4 font-semibold text-gray-900">Recent Calls</h2>

          {recentCalls.length === 0 ? (
            <EmptyState
              icon="⚡"
              title="No calls yet"
              subtitle="Calls to your models will appear here in real time."
            />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-6 py-3 text-left">Model</th>
                    <th className="px-6 py-3 text-left">Caller</th>
                    <th className="px-6 py-3 text-right">Amount</th>
                    <th className="px-6 py-3 text-right">Latency</th>
                    <th className="px-6 py-3 text-center">Status</th>
                    <th className="px-6 py-3 text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {recentCalls.map((call) => (
                    <tr key={call.id} className="hover:bg-gray-50/50 transition">
                      <td className="px-6 py-3 font-medium text-gray-800">
                        {call.agent?.name ?? '—'}
                      </td>
                      <td className="px-6 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          call.caller_type === 'agent'
                            ? 'bg-violet-100 text-violet-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}>
                          {call.caller_type === 'agent' ? '🤖 agent' : '👤 human'}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right text-green-600">
                        ${Number(call.amount_paid).toFixed(3)}
                      </td>
                      <td className="px-6 py-3 text-right text-gray-500">
                        {call.latency_ms != null ? `${call.latency_ms}ms` : '—'}
                      </td>
                      <td className="px-6 py-3 text-center">
                        <StatusBadge status={call.status} />
                      </td>
                      <td className="px-6 py-3 text-right text-xs text-gray-400">
                        {new Date(call.created_at).toLocaleString('en-US')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Agent API quick-start */}
        <section className="rounded-2xl bg-gray-900 p-6 text-white">
          <p className="mb-2 text-sm font-semibold text-gray-300">
            🤖 Other agents discover and pay your models automatically:
          </p>
          <pre className="overflow-auto rounded-xl bg-black/30 p-4 text-sm text-green-400">{`# Discovery
GET ${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://wasiai-v2.vercel.app'}/api/v1/models?category=nlp

# Invoke (x402)
POST ${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://wasiai-v2.vercel.app'}/api/v1/models/{slug}/invoke
x-payment: <usdc-tx-hash>
Content-Type: application/json
{ "input": "..." }`}</pre>
          <Link
            href={`/${locale}/agent-keys`}
            className="mt-4 inline-block rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition"
          >
            Manage Agent Keys →
          </Link>
        </section>

      </div>
    </main>
  )
}

// ── Sub-components ──────────────────────────────────────────────

function StatCard({
  label, value, icon, highlight = false,
}: {
  label: string
  value: string
  icon: string
  highlight?: boolean
}) {
  return (
    <div className={`rounded-2xl p-5 shadow-sm border ${
      highlight
        ? 'border-green-200 bg-green-50'
        : 'border-gray-100 bg-white'
    }`}>
      <div className="text-2xl">{icon}</div>
      <div className={`mt-2 text-2xl font-bold ${highlight ? 'text-green-700' : 'text-gray-900'}`}>
        {value}
      </div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  )
}

function CategoryBadge({ category }: { category: string }) {
  const colors: Record<string, string> = {
    nlp: 'bg-blue-100 text-blue-700',
    vision: 'bg-purple-100 text-purple-700',
    audio: 'bg-pink-100 text-pink-700',
    code: 'bg-green-100 text-green-700',
    multimodal: 'bg-orange-100 text-orange-700',
    data: 'bg-gray-100 text-gray-700',
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[category] ?? 'bg-gray-100 text-gray-600'}`}>
      {category}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    paused: 'bg-yellow-100 text-yellow-700',
    reviewing: 'bg-blue-100 text-blue-600',
    success: 'bg-green-100 text-green-700',
    error: 'bg-red-100 text-red-600',
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

function EmptyState({
  icon, title, subtitle, cta,
}: {
  icon: string
  title: string
  subtitle: string
  cta?: { label: string; href: string }
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white py-12 text-center shadow-sm">
      <div className="text-4xl">{icon}</div>
      <p className="mt-3 font-medium text-gray-700">{title}</p>
      <p className="text-sm text-gray-400">{subtitle}</p>
      {cta && (
        <Link
          href={cta.href}
          className="mt-4 inline-block rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition"
        >
          {cta.label}
        </Link>
      )}
    </div>
  )
}
