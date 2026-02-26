import { Suspense } from 'react'
import { setRequestLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'

// P-10: ISR — revalidate every 5 minutes (increased from 60s)
export const revalidate = 300

import { getModels } from '@/features/models/services/models.service'
import { ModelCard } from '@/features/models/components/ModelCard'
import { CategoryFilter } from '@/features/models/components/CategoryFilter'
import type { ModelCategory } from '@/features/models/types/models.types'

const PAGE_SIZE = 12

interface Props {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ category?: string; search?: string; page?: string }>
}

export default async function HomePage({ params, searchParams }: Props) {
  const { locale } = await params
  const { category, search, page: pageStr } = await searchParams
  setRequestLocale(locale)
  const t = await getTranslations('home')

  const page   = Math.max(1, parseInt(pageStr ?? '1', 10))
  const offset = (page - 1) * PAGE_SIZE

  const { models, total } = await getModels({
    category: category as ModelCategory | undefined,
    search,
    limit: PAGE_SIZE,
    offset,
  })

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const hasNext    = page < totalPages
  const hasPrev    = page > 1

  function pageHref(p: number) {
    const q = new URLSearchParams()
    if (category) q.set('category', category)
    if (search)   q.set('search', search)
    if (p > 1)    q.set('page', String(p))
    const qs = q.toString()
    return `/${locale}${qs ? `?${qs}` : ''}`
  }

  return (
    <main className="min-h-screen bg-gray-50">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="bg-white border-b border-gray-100 px-6 py-16">
        <div className="mx-auto max-w-4xl text-center">

          {/* Badge */}
          <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-avax-50 border border-avax-100 px-4 py-1.5 text-sm text-avax-600 font-medium">
            <span>⚡</span>
            <span>{t('badge')}</span>
          </div>

          {/* Headline */}
          <h1 className="text-5xl font-extrabold tracking-tight text-gray-900 mb-4">
            {t('heroTitle')}
            <br />
            <span className="text-avax-500">{t('heroSubtitle')}</span>
          </h1>

          <p className="text-lg text-gray-500 mb-10 max-w-2xl mx-auto">
            {t('heroDescription')}
          </p>

          {/* Dual CTA */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-14">
            <Link
              href={`/${locale}/publish`}
              className="inline-flex items-center gap-2 bg-avax-500 text-white font-semibold px-6 py-3 rounded-xl hover:bg-avax-600 transition-colors"
            >
              {t('ctaCreator')}
            </Link>
            <Link
              href="#agents"
              className="inline-flex items-center gap-2 border border-gray-200 text-gray-700 font-semibold px-6 py-3 rounded-xl hover:border-avax-300 hover:text-avax-600 transition-colors"
            >
              {t('ctaConsumer')}
            </Link>
          </div>

          {/* Stats pills */}
          <div className="flex flex-wrap justify-center gap-6 text-sm text-gray-400">
            <span>⚡ {t('statPayments')}</span>
            <span>💰 {t('statMinCall')}</span>
            <span>🏠 {t('statToCreators')}</span>
            <span>🔗 {t('statIdentity')}</span>
          </div>

        </div>
      </section>

      {/* ── Stats bar ────────────────────────────────────────────────────── */}
      <section className="bg-gray-50 border-b border-gray-100 px-6 py-8">
        <div className="mx-auto max-w-4xl">
          <div className="flex flex-wrap justify-center gap-8 text-center text-sm text-gray-500">
            <div>
              <span className="block text-2xl font-extrabold text-avax-500">x402</span>
              Native payments
            </div>
            <div>
              <span className="block text-2xl font-extrabold text-gray-900">$0.02</span>
              Min. per call
            </div>
            <div>
              <span className="block text-2xl font-extrabold text-gray-900">90%</span>
              To creators
            </div>
            <div>
              <span className="block text-2xl font-extrabold text-avax-500">ERC-8004</span>
              Agent identity
            </div>
          </div>
        </div>
      </section>

      {/* ── Models ───────────────────────────────────────────────────────── */}
      <section id="agents" className="px-6 py-12">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Available Models</h2>
              {total > 0 && (
                <p className="mt-0.5 text-sm text-gray-400">{total} models · page {page} of {totalPages}</p>
              )}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Suspense>
                <SearchInput defaultValue={search} category={category} />
              </Suspense>
              <Suspense>
                <CategoryFilter />
              </Suspense>
            </div>
          </div>

          {models.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-gray-200 py-16 text-center">
              <p className="text-4xl mb-4">🔍</p>
              <p className="text-gray-600 font-medium text-lg">
                {search ? `No results for "${search}"` : category ? `No models in "${category}" yet` : 'No models yet.'}
              </p>
              {(search || category) ? (
                <div className="mt-4 flex flex-wrap justify-center gap-3">
                  <Link href={`/${locale}`} className="rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition">
                    Clear filters
                  </Link>
                  {!search && category && (
                    <Link href={`/${locale}`} className="rounded-full bg-avax-50 px-4 py-2 text-sm font-medium text-avax-600 hover:bg-avax-100 transition">
                      Browse all categories
                    </Link>
                  )}
                </div>
              ) : (
                <div className="mt-4 flex flex-wrap justify-center gap-3">
                  <Link href={`/${locale}/publish`} className="rounded-full bg-avax-500 px-6 py-2.5 text-sm font-semibold text-white hover:bg-avax-600 transition">
                    Be the first to publish →
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {models.map((model, i) => (
                  <ModelCard key={model.id} model={model} locale={locale} index={i} />
                ))}
              </div>

              {/* UX-09: Pagination */}
              {totalPages > 1 && (
                <div className="mt-10 flex items-center justify-center gap-3">
                  {hasPrev ? (
                    <Link
                      href={pageHref(page - 1)}
                      className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition"
                    >
                      ← Previous
                    </Link>
                  ) : (
                    <span className="rounded-xl border border-gray-100 bg-gray-50 px-5 py-2.5 text-sm text-gray-300 cursor-default">
                      ← Previous
                    </span>
                  )}

                  <span className="text-sm text-gray-500">
                    {page} / {totalPages}
                  </span>

                  {hasNext ? (
                    <Link
                      href={pageHref(page + 1)}
                      className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition"
                    >
                      Next →
                    </Link>
                  ) : (
                    <span className="rounded-xl border border-gray-100 bg-gray-50 px-5 py-2.5 text-sm text-gray-300 cursor-default">
                      Next →
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* ── Agent API ────────────────────────────────────────────────────── */}
      <section className="bg-gray-900 px-6 py-16 text-white">
        <div className="mx-auto max-w-4xl">
          <div className="mb-10 text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-avax-500/20 px-4 py-1.5 text-sm text-avax-300">
              <span>🤖</span><span>Coinbase AgentKit compatible</span>
            </div>
            <h2 className="text-3xl font-bold">Built for the Agentic Economy</h2>
            <p className="mt-3 max-w-xl mx-auto text-gray-400">
              Any AI agent can discover, pay, and call models on WasiAI autonomously.
              x402 native. ERC-8004 identity. Gasless payments on Avalanche.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-8">
            <div className="rounded-xl bg-gray-800 p-4">
              <p className="mb-2 text-xs font-semibold text-gray-400">1. Check budget</p>
              <pre className="overflow-auto text-xs text-green-400">{`GET /api/v1/agent-keys/me
x-agent-key: wasi_xxx

← { remaining: 4.80,
    status: "ok" }`}</pre>
            </div>
            <div className="rounded-xl bg-gray-800 p-4">
              <p className="mb-2 text-xs font-semibold text-gray-400">2. Discover models</p>
              <pre className="overflow-auto text-xs text-green-400">{`GET /api/v1/models
  ?category=vision
  &max_price=0.05

← [{ slug, price,
     invoke_url }]`}</pre>
            </div>
            <div className="rounded-xl bg-gray-800 p-4">
              <p className="mb-2 text-xs font-semibold text-gray-400">3. Invoke & pay</p>
              <pre className="overflow-auto text-xs text-green-400">{`POST /api/v1/models/
  {slug}/invoke
x-agent-key: wasi_xxx

← { result,
  charged: 0.02 }`}</pre>
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-4">
            <Link
              href={`/${locale}/agent-keys`}
              className="rounded-full bg-avax-500 px-6 py-2.5 font-semibold hover:bg-avax-600 transition"
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

// ── Search input ──────────────────────────────────────────────────────────────
function SearchInput({ defaultValue, category }: { defaultValue?: string; category?: string }) {
  return (
    <form method="GET" className="flex items-center gap-2">
      {category && <input type="hidden" name="category" value={category} />}
      <input
        type="search"
        name="search"
        defaultValue={defaultValue}
        placeholder="Search models..."
        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm focus:border-avax-400 focus:outline-none sm:w-52"
      />
    </form>
  )
}
