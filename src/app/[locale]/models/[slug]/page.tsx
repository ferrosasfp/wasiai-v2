import { notFound } from 'next/navigation'
import { setRequestLocale, getTranslations } from 'next-intl/server'
import { getModelBySlug } from '@/features/models/services/models.service'
import { ModelCallSection } from '@/features/models/components/ModelCallSection'
import { AgentRating } from '@/features/reputation/components/AgentRating'
import { AgentTrialPlayground } from '@/features/agents/components/AgentTrialPlayground'
import { CodeExamples } from '@/features/models/components/CodeExamples'
import { ReputationMetrics } from '@/features/models/components/ReputationMetrics'
import { AgentExamplesDisplay } from '@/features/models/components/AgentExamplesDisplay'
import { createClient } from '@/lib/supabase/server'
import { EscrowInfoBanner } from '@/features/agents/components/EscrowInfoBanner'
import { PricingBadge }    from '@/features/agents/components/PricingBadge'
import { WasiKeyBanner }   from '@/features/agents/components/WasiKeyBanner'
import Link from 'next/link'
import { Bot } from 'lucide-react'
import { UpgradeOnChainButton } from '@/features/agents/components/UpgradeOnChainButton'

// PERF-04: ISR — revalidate detail pages every 5 minutes
export const revalidate = 300

const APP_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.wasiai.io'

interface Props {
  params: Promise<{ locale: string; slug: string }>
}

export default async function ModelDetailPage({ params }: Props) {
  const { locale, slug } = await params
  setRequestLocale(locale)
  const tMarket   = await getTranslations('marketplace')
  const tAnalytics = await getTranslations('analytics')
  const tDetail   = await getTranslations('modelDetail')

  const [model, supabase] = await Promise.all([
    getModelBySlug(slug),
    createClient(),
  ])
  if (!model) notFound()

  const { data: { user } } = await supabase.auth.getUser()
  const isAuthenticated = !!user

  // HU-069: Fetch creator wallet for on-chain registration validation
  let registeredWallet: string | null = null
  if (user) {
    const { data: cp } = await supabase
      .from('creator_profiles')
      .select('wallet_address')
      .eq('id', user.id)
      .maybeSingle()
    registeredWallet = cp?.wallet_address ?? null
  }

  const invokeUrl = `${APP_URL}/api/v1/models/${model.slug}/invoke`

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl px-6 py-10">

        {/* Back */}
        <Link
          href={`/${locale}`}
          className="mb-6 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition"
        >
          {tDetail('backToMarketplace')}
        </Link>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">

          {/* ── Main column ─────────────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-6">

            {/* Header */}
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
              <div className="flex items-start gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-avax-500 to-avax-700 shrink-0">
                  <Bot size={28} className="text-white" />
                </div>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-bold text-gray-900">{model.name}</h1>
                    {model.is_featured && (
                      <span className="rounded-full bg-avax-50 px-3 py-0.5 text-xs font-semibold text-avax-600">{tDetail('featured')}</span>
                    )}
                    {/* HU-3.3: Badge Free Trial — solo si el creator lo activó */}
                    {model.free_trial_enabled && (
                      <span className="rounded-full bg-green-50 border border-green-200 px-3 py-0.5 text-xs font-semibold text-green-700">
                        {tDetail('freeTrial')}
                      </span>
                    )}
                    {model.registration_type === 'on_chain' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
                        On-chain
                      </span>
                    )}
                    <span className="rounded-full bg-gray-100 px-3 py-0.5 text-xs font-medium text-gray-600 capitalize">
                      {model.category}
                    </span>
                  </div>
                  {model.creator && (
                    <p className="mt-1 text-sm text-gray-500">
                      by <span className="font-medium text-gray-700">@{model.creator.username}</span>
                      {model.creator.verified && <span className="ml-1 text-avax-500">✓</span>}
                    </p>
                  )}
                </div>
              </div>
              {model.description && (
                <p className="mt-4 text-gray-600 leading-relaxed">{model.description}</p>
              )}
              {/* WAS-160c: Upgrade to on-chain button — only for off-chain agents owned by current user */}
              <UpgradeOnChainButton
                slug={model.slug}
                pricePerCall={model.price_per_call}
                registrationType={model.registration_type ?? 'off_chain'}
                isOwner={user?.id === model.creator_id}
                registeredWallet={registeredWallet}
              />
            </div>

            {/* Capabilities */}
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
              <h2 className="mb-4 font-semibold text-gray-900">{tDetail('capabilitiesSchema')}</h2>

              {model.capabilities && model.capabilities.length > 0 ? (
                <div className="space-y-3">
                  {model.capabilities.map((cap, i) => (
                    <div key={i} className="rounded-xl bg-gray-50 p-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-800">{cap.name}</span>
                        <span className="rounded-full bg-white border border-gray-200 px-2 py-0.5 text-xs text-gray-500 font-mono">
                          {cap.inputType} → {cap.outputType}
                        </span>
                      </div>
                      {cap.description && (
                        <p className="mt-1 text-sm text-gray-500">{cap.description}</p>
                      )}
                      {cap.example && (
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded-lg bg-gray-100 p-2">
                            <p className="mb-1 font-medium text-gray-500">Input</p>
                            <p className="font-mono text-gray-700">{cap.example.input}</p>
                          </div>
                          <div className="rounded-lg bg-avax-50 p-2">
                            <p className="mb-1 font-medium text-avax-500">Output</p>
                            <p className="font-mono text-avax-700">{typeof cap.example.output === 'object' ? JSON.stringify(cap.example.output, null, 2) : String(cap.example.output)}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 py-6 px-4 text-center">
                  <p className="text-sm text-gray-500">{tDetail('noCapabilities')}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    Input: <code className="font-mono">{"{ \"input\": \"string\" }"}</code> ·
                    Output: model-specific JSON
                  </p>
                </div>
              )}
            </div>

            {/* HU-4.3: Ejemplos Input/Output — invisible si no hay ejemplos (retorna null) */}
            <AgentExamplesDisplay agentId={model.id} />

            {/* HU-3.3: Trial Playground solo si el creator lo activó — ausente del DOM si no */}
            {model.free_trial_enabled ? (
              <AgentTrialPlayground slug={model.slug} isAuthenticated={isAuthenticated} />
            ) : null}

            {/* UX-04: Code Examples auto-generated */}
            <CodeExamples
              slug={model.slug}
              priceUsdc={model.price_per_call > 0 ? model.price_per_call.toString() : null}
              inputExample={model.capabilities?.[0]?.example?.input ?? null}
              locale={locale}
            />

            {/* Agent API — both auth methods */}
            <div className="rounded-2xl bg-gray-900 p-6 text-white">
              <h2 className="mb-4 font-semibold text-gray-100 flex items-center gap-2"><Bot size={16} /> Agent API</h2>

              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {tDetail('optionA')}
              </p>
              <pre className="mb-4 overflow-auto rounded-xl bg-black/30 p-4 text-sm text-green-400">{`POST ${invokeUrl}
x-agent-key: wasi_your_key_here
Content-Type: application/json

{ "input": "your input" }`}</pre>

              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {tDetail('optionB')}
              </p>
              <pre className="overflow-auto rounded-xl bg-black/30 p-4 text-sm text-green-400">{`# 1. Probe — receive 402 with payment instructions
POST ${invokeUrl}
{ "input": "your input" }

# 2. Pay + retry
POST ${invokeUrl}
X-PAYMENT: <x402-eip712-signed-payload>
{ "input": "your input" }`}</pre>

              <div className="mt-4 flex flex-wrap gap-3">
                <Link
                  href={`/${locale}/agent-keys`}
                  className="rounded-xl bg-avax-500 px-4 py-2 text-sm font-semibold hover:bg-avax-400 transition"
                >
                  {tDetail('getAgentKey')}
                </Link>
                <a
                  href={`${APP_URL}/api/v1/models/${model.slug}/invoke`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xl border border-gray-600 px-4 py-2 text-sm font-semibold text-gray-300 hover:border-gray-400 transition"
                >
                  {tDetail('modelSpecJson')}
                </a>
              </div>
            </div>
          </div>

          {/* ── Sidebar ──────────────────────────────────────────────────── */}
          <div className="space-y-4">

            {/* WAS-133: Gas fee dinámico — solo si el agente tiene precio */}
            {model.price_per_call > 0 && (
              <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {tDetail('pricingHeader')}
                </p>
                <PricingBadge slug={model.slug} basePrice={model.price_per_call} />
              </div>
            )}

            {/* WAS-133: Banner WasiAI Key — se autogestiona según si el usuario tiene key activa */}
            <WasiKeyBanner locale={locale} creatorPrice={model.price_per_call} />

            {/* WAS-72: Escrow banner para agentes de tareas largas */}
            {model.long_running && <EscrowInfoBanner />}

            {/* Pay & Call — real component */}
            <ModelCallSection model={model} isAuthenticated={isAuthenticated} />

            {/* Creator */}
            {model.creator && (
              <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {tDetail('creator')}
                </h3>
                <Link
                  href={`/${locale}/creator/${model.creator.username}`}
                  className="flex items-center gap-3 group"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-avax-100 text-base font-bold text-avax-600 shrink-0 group-hover:bg-avax-200 transition">
                    {(model.creator.display_name ?? model.creator.username)[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-gray-800 group-hover:text-avax-600 truncate transition">
                      {model.creator.display_name ?? model.creator.username}
                      {model.creator.verified && <span className="ml-1 text-avax-500">✓</span>}
                    </p>
                    <p className="text-xs text-gray-500">@{model.creator.username}</p>
                  </div>
                </Link>
                {model.creator.bio && (
                  <p className="mt-3 text-sm text-gray-600 leading-relaxed">{model.creator.bio}</p>
                )}
              </div>
            )}

            {/* Quick stats */}
            <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100 space-y-2 text-sm">
              <div className="flex justify-between text-gray-500">
                <span>{tMarket('protocol')}</span>
                <span className="font-medium text-gray-800">x402</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>{tMarket('network')}</span>
                <span className="font-medium text-gray-800 capitalize">{model.chain}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>{tMarket('currency')}</span>
                <span className="font-medium text-gray-800">{model.currency}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>{tAnalytics('total_calls')}</span>
                <span className="font-medium text-gray-800">{model.total_calls.toLocaleString('en-US')}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>{tMarket('creatorEarns')}</span>
                <span className="font-medium text-green-600">90%</span>
              </div>
            </div>

            {/* HU-4.4: Métricas de reputación con datos reales */}
            <ReputationMetrics agentId={model.id} />

            {/* ERC-8004 Reputation */}
            <AgentRating
              slug={model.slug}
              initialScore={model.reputation_score ?? null}
              initialCount={model.reputation_count ?? 0}
            />

          </div>
        </div>
      </div>
    </main>
  )
}
