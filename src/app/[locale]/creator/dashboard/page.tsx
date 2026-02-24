import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
// WithdrawButton and WalletSetup are used inside EarningsSection sub-component
// A-02: Sub-component with Suspense for streaming — async blockchain call isolated
import { EarningsSection, EarningsSkeleton } from './_components/EarningsSection'

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
  called_at: string
  agent: { name: string; slug: string } | null
}

export default async function CreatorDashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/${locale ?? 'en'}/login`)

  // P-01 + A-02: Fetch models only; earnings/wallet fetched inside EarningsSection (Suspense)
  const { data: models } = await supabase
    .from('agents')
    .select('id, name, slug, category, status, price_per_call, total_calls, total_revenue, created_at')
    .eq('creator_id', user.id)
    .order('total_calls', { ascending: false })

  const safeModels: ModelRow[] = models ?? []
  const modelIds = safeModels.map(m => m.id)

  // Recent calls — fetched in parallel with above (independent query)
  const serviceClient = createServiceClient()
  const recentCallsData = modelIds.length > 0
    ? await serviceClient
        .from('agent_calls')
        .select('id, agent_id, caller_type, amount_paid, status, latency_ms, called_at, agent:agents(name, slug)')
        .in('agent_id', modelIds)
        .order('called_at', { ascending: false })
        .limit(20)
    : { data: [] }

  const recentCalls: CallRow[] = (recentCallsData.data as unknown as CallRow[]) ?? []

  // Aggregate stats
  const totalCalls = safeModels.reduce((s, m) => s + (m.total_calls ?? 0), 0)
  const totalRevenue = safeModels.reduce((s, m) => s + Number(m.total_revenue ?? 0), 0)
  const activeModels = safeModels.filter(m => m.status === 'active').length

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

        {/* A-02: On-chain Earnings with Suspense — blockchain RPC doesn't block page render */}
        <Suspense fallback={<EarningsSkeleton />}>
          <EarningsSection userId={user.id} />
        </Suspense>

        {/* Models table */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Your Models</h2>
            <Link
              href={`/${locale}/publish`}
              className="rounded-xl bg-avax-500 px-4 py-2 text-sm font-semibold text-white hover:bg-avax-600 transition"
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
                          className="font-medium text-gray-900 hover:text-avax-600"
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
                        {new Date(call.called_at).toLocaleString('en-US')}
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
            className="mt-4 inline-block rounded-xl bg-avax-500 px-4 py-2 text-sm font-semibold text-white hover:bg-avax-600 transition"
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
    vision: 'bg-avax-500 text-avax-600',
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
          className="mt-4 inline-block rounded-xl bg-avax-500 px-4 py-2 text-sm font-semibold text-white hover:bg-avax-600 transition"
        >
          {cta.label}
        </Link>
      )}
    </div>
  )
}
