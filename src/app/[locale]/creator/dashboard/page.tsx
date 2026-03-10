import React, { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { ensureCreatorProfile } from '@/lib/ensureCreatorProfile'
import { Package, CheckCircle2, Zap, DollarSign, Inbox, Activity } from 'lucide-react'
import type { ReactNode } from 'react'
// WithdrawButton and WalletSetup are used inside EarningsSection sub-component
// A-02: Sub-component with Suspense for streaming — async blockchain call isolated
import { EarningsSection, EarningsSkeleton } from './_components/EarningsSection'
import { AgentActions } from './_components/AgentActions'
import { FreeTrialToggle } from './_components/FreeTrialToggle'
import { WebhooksPanel } from './_components/WebhooksPanel'
import { AgentWalletSection } from './_components/AgentWalletSection'
import { AgentKeyWidget }     from './_components/AgentKeyWidget'
import { PendingEarningsBanner } from '@/components/PendingEarningsBanner'
import { CreatorAnalytics } from '@/features/creator/components/CreatorAnalytics'
import { CallsPagination } from '@/features/creator/components/CallsPagination'

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
  free_trial_enabled: boolean
  free_trial_limit: number
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

const CALLS_PER_PAGE = 10

export default async function CreatorDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ callsPage?: string }>
}) {
  const { locale } = await params
  const { callsPage: callsPageParam } = await searchParams
  const t = await getTranslations('dashboard')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/${locale ?? 'en'}/login`)

  // HU-069: Ensure creator_profile exists (fallback for missing DB trigger)
  await ensureCreatorProfile(supabase, user)

  // HU-1.1: Check onboarding status and pending earnings
  const { data: creatorProfile } = await supabase
    .from('creator_profiles')
    .select('onboarding_completed, onboarding_step, pending_earnings_usdc, wallet_address')
    .eq('id', user.id)
    .single()

  // Redirect to onboarding wizard if not yet completed
  if (creatorProfile && !creatorProfile.onboarding_completed) {
    redirect(`/${locale ?? 'en'}/onboarding`)
  }

  const pendingEarnings = Number(creatorProfile?.pending_earnings_usdc ?? 0)
  const hasWallet       = !!creatorProfile?.wallet_address

  // P-01 + A-02: Fetch models only; earnings/wallet fetched inside EarningsSection (Suspense)
  const { data: models } = await supabase
    .from('agents')
    .select('id, name, slug, category, status, price_per_call, total_calls, total_revenue, created_at, free_trial_enabled, free_trial_limit')
    .eq('creator_id', user.id)
    .order('total_calls', { ascending: false })

  const safeModels: ModelRow[] = models ?? []
  const modelIds = safeModels.map(m => m.id)

  // Recent calls — fetched in parallel with above (independent query)
  const callsPage = Math.max(1, parseInt(callsPageParam ?? '1', 10))
  const callsOffset = (callsPage - 1) * CALLS_PER_PAGE
  // NG-013: usar createClient() (respeta RLS) en vez de createServiceClient()
  const userClient = await createClient()
  const recentCallsData = modelIds.length > 0
    ? await userClient
        .from('agent_calls')
        .select(
          'id, agent_id, caller_type, amount_paid, status, latency_ms, called_at, agent:agents(name, slug)',
          { count: 'exact' }
        )
        .in('agent_id', modelIds)
        .order('called_at', { ascending: false })
        .range(callsOffset, callsOffset + CALLS_PER_PAGE - 1)
    : { data: [], count: 0 }

  const recentCalls: CallRow[] = (recentCallsData.data as unknown as CallRow[]) ?? []
  const totalCallsCount = recentCallsData.count ?? 0
  const totalPages = Math.ceil(totalCallsCount / CALLS_PER_PAGE)

  // Aggregate stats
  const totalCalls = safeModels.reduce((s, m) => s + (m.total_calls ?? 0), 0)
  const totalRevenue = safeModels.reduce((s, m) => s + Number(m.total_revenue ?? 0), 0)
  const activeModels = safeModels.filter(m => m.status === 'active').length

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-10">
      <div className="mx-auto max-w-5xl space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="mt-1 text-sm text-gray-500">{user.email}</p>
        </div>

        {/* HU-1.1: Pending earnings banner — visible if pending_earnings_usdc > 0 AND no wallet */}
        {pendingEarnings > 0 && !hasWallet && (
          <PendingEarningsBanner pendingEarnings={pendingEarnings} />
        )}

        {/* Stats cards */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label={t('totalAgents')} value={safeModels.length.toString()} icon={<Package size={22} className="text-gray-400" />} />
          <StatCard label={t('active')} value={activeModels.toString()} icon={<CheckCircle2 size={22} className="text-green-400" />} />
          <StatCard label={t('totalCalls')} value={totalCalls.toLocaleString('en-US')} icon={<Zap size={22} className="text-avax-400" />} />
          <StatCard
            label={t('revenue')}
            value={`$${totalRevenue.toFixed(2)}`}
            icon={<DollarSign size={22} className="text-green-500" />}
            highlight
          />
        </div>

        {/* A-02: On-chain Earnings with Suspense — blockchain RPC doesn't block page render */}
        <Suspense fallback={<EarningsSkeleton />}>
          <EarningsSection userId={user.id} />
        </Suspense>

        {/* HU-1.4: Creator Analytics */}
        <CreatorAnalytics agents={safeModels.map(m => ({ id: m.id, name: m.name }))} />

        {/* Agents table */}
        <section>
          <div className="mb-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="h-5 w-1 rounded-full bg-avax-500" />
              <h2 className="font-bold text-gray-900">{t('yourAgents')}</h2>
              <span className="text-xs text-gray-400 font-normal">({safeModels.length})</span>
            </div>
            <Link
              href={`/${locale}/publish`}
              className="rounded-xl bg-avax-500 px-4 py-2 text-sm font-semibold text-white hover:bg-avax-600 transition shrink-0"
            >
              {t('publishAgent')}
            </Link>
          </div>

          {safeModels.length === 0 ? (
            <EmptyState
              icon={<Inbox size={36} className="text-gray-300" />}
              title={t('noAgents')}
              subtitle={t('noAgentsSubtitle')}
              cta={{ label: t('publishAgent'), href: `/${locale}/publish` }}
            />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
              {/* WAS-55: min-w fuerza overflow real en mobile — sin esto w-full comprime la tabla */}
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-6 py-3 text-left">{t('colAgent')}</th>
                    <th className="px-6 py-3 text-left">{t('colCategory')}</th>
                    <th className="px-6 py-3 text-right">{t('colPrice')}</th>
                    <th className="px-6 py-3 text-right">{t('colCalls')}</th>
                    <th className="px-6 py-3 text-right">{t('colRevenue')}</th>
                    <th className="px-6 py-3 text-center">{t('colStatus')}</th>
                    <th className="px-6 py-3 text-center">{t('colActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {safeModels.map((model) => (
                    <React.Fragment key={model.id}>
                    <tr className="hover:bg-gray-50/50 transition">
                      <td className="px-6 py-4">
                        <Link
                          href={`/${locale}/models/${model.slug}`}
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
                      <td className="px-6 py-4 text-center">
                        <AgentActions
                          slug={model.slug}
                          locale={locale}
                          currentStatus={model.status}
                          agentName={model.name}
                        />
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={7} className="px-6 pb-4">
                        <FreeTrialToggle
                          slug={model.slug}
                          initialEnabled={model.free_trial_enabled ?? false}
                          initialLimit={model.free_trial_limit ?? 1}
                        />
                      </td>
                    </tr>
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Recent calls */}
        <section>
          <div className="mb-4 flex items-center gap-2">
            <div className="h-5 w-1 rounded-full bg-violet-500" />
            <h2 className="font-bold text-gray-900">{t('recentCalls')}</h2>
          </div>

          {recentCalls.length === 0 && callsPage === 1 ? (
            <EmptyState
              icon={<Activity size={36} className="text-gray-300" />}
              title={t('noCalls')}
              subtitle={t('noCallsSubtitle')}
            />
          ) : (
            <>
            <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
              {/* WAS-55: min-w fuerza overflow real en mobile */}
              <table className="w-full min-w-[520px] text-sm">
                <thead className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2.5 text-left">{t('colAgent')}</th>
                    <th className="px-4 py-2.5 text-left">{t('colCaller')}</th>
                    <th className="px-4 py-2.5 text-right">{t('colAmount')}</th>
                    <th className="px-4 py-2.5 text-right">{t('colLatency')}</th>
                    <th className="px-4 py-2.5 text-center">{t('colStatus')}</th>
                    <th className="px-4 py-2.5 text-right">{t('colTime')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {recentCalls.map((call) => (
                    <tr key={call.id} className="hover:bg-gray-50/50 transition">
                      <td className="px-4 py-2.5 font-medium text-gray-800 text-sm">
                        {call.agent?.name ?? '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          call.caller_type === 'agent'
                            ? 'bg-violet-100 text-violet-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}>
                          {call.caller_type === 'agent' ? t('callerAgent') : t('callerHuman')}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-green-600 text-sm">
                        ${Number(call.amount_paid).toFixed(3)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-400 text-xs">
                        {call.latency_ms != null ? `${call.latency_ms}ms` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <StatusBadge status={call.status} />
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-gray-400">
                        {new Date(call.called_at).toLocaleString('en-US')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <CallsPagination currentPage={callsPage} totalPages={totalPages} />
            </>
          )}
        </section>

        {/* WAS-74: Webhooks */}
        <WebhooksPanel />

        {/* Agent Key widget — fondos para servicios agénticos */}
        <AgentKeyWidget locale={locale} />

        {/* WAS-71: Agent Wallets — una sección por agente */}
        {safeModels.map((model) => (
          <AgentWalletSection key={model.id} agentSlug={model.slug} agentName={model.name} locale={locale} />
        ))}

        {/* Agent API quick-start */}
        <section className="rounded-2xl bg-gray-900 p-6 text-white">
          <p className="mb-2 text-sm font-semibold text-gray-300">
            {t('apiQuickStartLabel')}
          </p>
          <pre className="overflow-auto rounded-xl bg-black/30 p-4 text-sm text-green-400">{`# Discovery
GET ${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.wasiai.io'}/api/v1/models?category=nlp

# Invoke (x402)
POST ${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.wasiai.io'}/api/v1/models/{slug}/invoke
x-payment: <usdc-tx-hash>
Content-Type: application/json
{ "input": "..." }`}</pre>
          <Link
            href={`/${locale}/agent-keys`}
            className="mt-4 inline-block rounded-xl bg-avax-500 px-4 py-2 text-sm font-semibold text-white hover:bg-avax-600 transition"
          >
            {t('manageAgentKeys')}
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
  icon: ReactNode
  highlight?: boolean
}) {
  return (
    <div className={`rounded-2xl p-5 shadow-sm border flex flex-col gap-3 ${
      highlight
        ? 'border-green-200 bg-gradient-to-br from-green-50 to-white'
        : 'border-gray-100 bg-white'
    }`}>
      <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${
        highlight ? 'bg-green-100' : 'bg-gray-50'
      }`}>
        {icon}
      </div>
      <div>
        <div className={`text-2xl font-extrabold ${highlight ? 'text-green-700' : 'text-gray-900'}`}>
          {value}
        </div>
        <div className="text-xs text-gray-500 mt-0.5">{label}</div>
      </div>
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
    reviewing: 'bg-blue-100 text-avax-600',
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
  icon: ReactNode
  title: string
  subtitle: string
  cta?: { label: string; href: string }
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white py-12 text-center shadow-sm">
      <div className="flex justify-center">{icon}</div>
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
