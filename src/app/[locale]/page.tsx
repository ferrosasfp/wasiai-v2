import { Suspense } from 'react'
import { setRequestLocale } from 'next-intl/server'
import Link from 'next/link'

// PERF-03: ISR — revalidate every 60 seconds
export const revalidate = 60

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
      <section className="bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 px-6 py-20 text-white">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm backdrop-blur">
            <span>⚡</span>
            <span>The marketplace for the agentic economy</span>
          </div>
          <h1 className="text-5xl font-extrabold tracking-tight">WasiAI</h1>
          <p className="mt-4 text-xl text-white/80">
            AI agents discover, pay, and call models autonomously.<br />
            x402 native payments on Avalanche. No subscriptions. No friction.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <a
              href="#models"
              className="rounded-full bg-white px-6 py-3 font-semibold text-indigo-600 shadow hover:bg-indigo-50 transition"
            >
              Browse Models
            </a>
            <Link
              href={`/${locale}/publish`}
              className="rounded-full border border-white/30 px-6 py-3 font-semibold text-white hover:bg-white/10 transition"
            >
              Publish a Model →
            </Link>
          </div>

          <div className="mt-12 flex flex-wrap justify-center gap-8 text-sm text-white/70">
            <div><span className="block text-3xl font-bold text-white">x402</span>Native payments</div>
            <div><span className="block text-3xl font-bold text-white">$0.02</span>Min. per call</div>
            <div><span className="block text-3xl font-bold text-white">90%</span>To creators</div>
            <div><span className="block text-3xl font-bold text-white">ERC-8004</span>Agent identity</div>
          </div>
        </div>
      </section>

      {/* ── Models ───────────────────────────────────────────────────────── */}
      <section id="models" className="px-6 py-12">
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
            <div className="rounded-2xl border-2 border-dashed border-gray-200 py-20 text-center">
              <p className="text-gray-400 text-lg">
                {search || category ? 'No models match your filters.' : 'No models yet.'}
              </p>
              {search || category ? (
                <Link href={`/${locale}`} className="mt-4 inline-block text-sm text-indigo-500 hover:underline">
                  Clear filters
                </Link>
              ) : (
                <Link
                  href={`/${locale}/publish`}
                  className="mt-4 inline-block rounded-full bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
                >
                  Be the first to publish →
                </Link>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {models.map((model) => (
                  <ModelCard key={model.id} model={model} locale={locale} />
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
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-indigo-500/20 px-4 py-1.5 text-sm text-indigo-300">
              <span>🤖</span><span>Coinbase AgentKit compatible</span>
            </div>
            <h2 className="text-3xl font-bold">Built for the Agentic Economy</h2>
            <p className="mt-3 max-w-xl mx-auto text-gray-400">
              Any AI agent can discover, pay, and call models on WasiAI autonomously.
              x402 native. ERC-8004 identity. Gasless via Ultravioleta DAO.
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
        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm focus:border-indigo-400 focus:outline-none sm:w-52"
      />
    </form>
  )
}
