import { Suspense } from 'react'
import { setRequestLocale } from 'next-intl/server'
import { getModels } from '@/features/models/services/models.service'
import { ModelCard } from '@/features/models/components/ModelCard'
import { CategoryFilter } from '@/features/models/components/CategoryFilter'
import type { ModelCategory } from '@/features/models/types/models.types'
import Link from 'next/link'

interface Props {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ category?: string; search?: string }>
}

export default async function HomePage({ params, searchParams }: Props) {
  const { locale } = await params
  const { category, search } = await searchParams
  setRequestLocale(locale)

  const models = await getModels({
    category: category as ModelCategory | undefined,
    search,
    limit: 12,
  })

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Hero */}
      <section className="bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 px-6 py-20 text-white">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm backdrop-blur">
            <span>⚡</span>
            <span>The marketplace for the agentic economy</span>
          </div>
          <h1 className="text-5xl font-extrabold tracking-tight">
            WasiAI
          </h1>
          <p className="mt-4 text-xl text-white/80">
            AI agents discover, pay, and call models autonomously.<br />
            x402 native payments on Avalanche. No subscriptions. No friction.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link
              href={`/${locale}/publish`}
              className="rounded-full bg-white px-6 py-3 font-semibold text-indigo-600 shadow hover:bg-indigo-50 transition"
            >
              Publish a Model →
            </Link>
            <Link
              href={`/${locale}/agent-keys`}
              className="rounded-full border border-white/30 px-6 py-3 font-semibold text-white hover:bg-white/10 transition"
            >
              Get Agent Key →
            </Link>
          </div>
          {/* Stats */}
          <div className="mt-12 flex flex-wrap justify-center gap-8 text-sm text-white/70">
            <div><span className="block text-3xl font-bold text-white">x402</span>Native payments</div>
            <div><span className="block text-3xl font-bold text-white">$0.02</span>Min. per call</div>
            <div><span className="block text-3xl font-bold text-white">80%</span>To creators</div>
            <div><span className="block text-3xl font-bold text-white">ERC-8004</span>Agent identity</div>
          </div>
        </div>
      </section>

      {/* Models */}
      <section id="models" className="px-6 py-12">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-2xl font-bold text-gray-900">Available Models</h2>
            <Suspense>
              <CategoryFilter />
            </Suspense>
          </div>

          {models.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-gray-200 py-20 text-center">
              <p className="text-gray-500">No models yet.</p>
              <Link
                href={`/${locale}/publish`}
                className="mt-4 inline-block rounded-full bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Be the first to publish →
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {models.map((model) => (
                <ModelCard key={model.id} model={model} locale={locale} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Agent CTA */}
      <section className="bg-gray-900 px-6 py-16 text-white">
        <div className="mx-auto max-w-4xl">
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 rounded-full bg-indigo-500/20 px-4 py-1.5 text-sm text-indigo-300 mb-4">
              <span>🤖</span><span>Coinbase AgentKit compatible</span>
            </div>
            <h2 className="text-3xl font-bold">Built for the Agentic Economy</h2>
            <p className="mt-3 text-gray-400 max-w-xl mx-auto">
              Any AI agent — AgentKit, LangChain, custom — can discover, pay, and call models on WasiAI autonomously. x402 native. ERC-8004 identity support.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-8">
            <div className="rounded-xl bg-gray-800 p-4">
              <p className="text-xs font-semibold text-gray-400 mb-2">1. Check your budget</p>
              <pre className="text-green-400 text-xs overflow-auto">{`GET /api/v1/agent-keys/me
x-agent-key: wasi_xxx

← { remaining_usdc: 4.80,
    status: "ok" }`}</pre>
            </div>
            <div className="rounded-xl bg-gray-800 p-4">
              <p className="text-xs font-semibold text-gray-400 mb-2">2. Discover models</p>
              <pre className="text-green-400 text-xs overflow-auto">{`GET /api/v1/models
  ?category=vision
  &max_price=0.05

← [{ slug, price,
     invoke_url }]`}</pre>
            </div>
            <div className="rounded-xl bg-gray-800 p-4">
              <p className="text-xs font-semibold text-gray-400 mb-2">3. Invoke &amp; pay</p>
              <pre className="text-green-400 text-xs overflow-auto">{`POST /api/v1/models/
  flux-pro/invoke
x-agent-key: wasi_xxx

← { result, meta:
  { charged: 0.02 }}`}</pre>
            </div>
          </div>

          <div className="text-center flex flex-wrap justify-center gap-4">
            <Link
              href={`/${locale}/agent-keys`}
              className="rounded-full bg-indigo-500 px-6 py-2.5 font-semibold hover:bg-indigo-400 transition"
            >
              Get Agent Key →
            </Link>
            <a
              href="https://github.com/coinbase/agentkit"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-gray-600 px-6 py-2.5 font-semibold text-gray-300 hover:border-gray-400 transition"
            >
              AgentKit Docs ↗
            </a>
          </div>
        </div>
      </section>
    </main>
  )
}
