import { Suspense } from 'react'
import { setRequestLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'

// P-10: ISR — revalidate every 5 minutes (increased from 60s)
export const revalidate = 300

import { getModels } from '@/features/models/services/models.service'
import { ModelCard } from '@/features/models/components/ModelCard'
import { ReputationBadge } from '@/features/models/components/ReputationBadge'
import { FilterPanel } from '@/features/models/components/FilterPanel'
import { EmptySearchState } from '@/features/models/components/EmptySearchState'
import { HeroDualCard } from '@/features/home/components/HeroDualCard'
import { SearchBar } from '@/features/models/components/SearchBar'
import type { ModelCategory } from '@/features/models/types/models.types'

const PAGE_SIZE = 12

interface Props {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ category?: string; search?: string; page?: string; agent_type?: string; max_price?: string }>
}

export default async function HomePage({ params, searchParams }: Props) {
  const { locale } = await params
  const { category, search, page: pageStr, agent_type, max_price } = await searchParams
  setRequestLocale(locale)
  const t  = await getTranslations('home')
  const tc = await getTranslations('common')
  const tEmptySearch = await getTranslations('emptySearch')

  const page   = Math.max(1, parseInt(pageStr ?? '1', 10))
  const offset = (page - 1) * PAGE_SIZE

  const maxPriceParsed = max_price ? parseFloat(max_price) : undefined
  const maxPriceValue = (maxPriceParsed !== undefined && !isNaN(maxPriceParsed))
    ? maxPriceParsed
    : undefined

  const { models, total } = await getModels({
    category: category as ModelCategory | undefined,
    search,
    agent_type,
    max_price: maxPriceValue,
    limit: PAGE_SIZE,
    offset,
  })

  // HU-9.1: Cargar sugeridos SOLO si búsqueda activa retorna 0 resultados
  const suggestedModels = (models.length === 0 && search)
    ? (await getModels({ limit: 4, offset: 0 })).models
    : []

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const hasNext    = page < totalPages
  const hasPrev    = page > 1

  function pageHref(p: number) {
    const q = new URLSearchParams()
    if (category)   q.set('category', category)
    if (search)     q.set('search', search)
    if (agent_type) q.set('agent_type', agent_type)
    if (max_price)  q.set('max_price', max_price)
    if (p > 1)      q.set('page', String(p))
    const qs = q.toString()
    return `/${locale}${qs ? `?${qs}` : ''}`
  }

  return (
    <main className="min-h-screen bg-gray-50">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="bg-white border-b border-gray-100 px-6 py-16">
        <HeroDualCard
          locale={locale}
          headline={t('hero.headline')}
          subtitleCreator={t('hero.subtitle.creator')}
          subtitleConsumer={t('hero.subtitle.consumer')}
          ctaCreator={t('hero.cta.creator')}
          ctaConsumer={t('hero.cta.consumer')}
          tagline={t('hero.tagline')}
          tabCreator={t('hero.tab.creator')}
          tabConsumer={t('hero.tab.consumer')}
          badge={t('badge')}
          tabLabel={t('hero.tab.label')}
        />
      </section>

      {/* ── Stats bar ────────────────────────────────────────────────────── */}
      <section className="bg-gray-50 border-b border-gray-100 px-6 py-8">
        <div className="mx-auto max-w-4xl">
          <div className="flex flex-wrap justify-center gap-8 text-center text-sm text-gray-500">
            <div>
              <span className="block text-2xl font-extrabold text-avax-500">x402</span>
              {t('statPayments')}
            </div>
            <div>
              <span className="block text-2xl font-extrabold text-gray-900">$0.02</span>
              {t('statMinCall')}
            </div>
            <div>
              <span className="block text-2xl font-extrabold text-gray-900">90%</span>
              {t('statToCreators')}
            </div>
            <div>
              <span className="block text-2xl font-extrabold text-avax-500">ERC-8004</span>
              {t('statIdentity')}
            </div>
          </div>
        </div>
      </section>

      {/* ── Models ───────────────────────────────────────────────────────── */}
      <section id="agents" className="px-6 py-12">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">{t('availableModels')}</h2>
              {total > 0 && (
                <p className="mt-0.5 text-sm text-gray-400">{t('modelsCount', { total, page, total_pages: totalPages })}</p>
              )}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Suspense>
                <SearchBar mode="server" defaultValue={search} category={category} placeholder={tc('search')} aria-label="Buscar modelos y agentes" />
              </Suspense>
              <Suspense>
                <FilterPanel />
              </Suspense>
            </div>
          </div>

          {models.length === 0 ? (
            search ? (
              // HU-9.1: Empty state rico cuando hay búsqueda activa sin resultados
              <EmptySearchState
                search={search}
                category={category}
                locale={locale}
                suggestedModels={suggestedModels}
                clearHref={`/${locale}`}
                texts={{
                  noResults: tEmptySearch('noResults', { search }),
                  suggestion: tEmptySearch('suggestion'),
                  alsoTryClearCategory: category ? tEmptySearch('alsoTryClearCategory') : undefined,
                  viewAll: tEmptySearch('viewAll'),
                  popularAgents: tEmptySearch('popularAgents'),
                }}
              />
            ) : (
              // Mantener el empty state ACTUAL para marketplace vacío (sin búsqueda)
              <div className="rounded-2xl border-2 border-dashed border-gray-200 py-16 text-center">
                <p className="text-4xl mb-4">🔍</p>
                <p className="text-gray-600 font-medium text-lg">
                  {category ? t('noModelsFiltered') : t('noModels')}
                </p>
                {category ? (
                  <div className="mt-4 flex flex-wrap justify-center gap-3">
                    <Link href={`/${locale}`} className="rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition">
                      {t('clearFilters')}
                    </Link>
                    <Link href={`/${locale}`} className="rounded-full bg-avax-50 px-4 py-2 text-sm font-medium text-avax-600 hover:bg-avax-100 transition">
                      {t('browseAllCategories')}
                    </Link>
                  </div>
                ) : (
                  <div className="mt-4 flex flex-wrap justify-center gap-3">
                    <Link href={`/${locale}/publish`} className="rounded-full bg-avax-500 px-6 py-2.5 text-sm font-semibold text-white hover:bg-avax-600 transition">
                      {t('beFirst')}
                    </Link>
                  </div>
                )}
              </div>
            )
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {models.map((model, i) => (
                  <ModelCard
                    key={model.id}
                    model={model}
                    locale={locale}
                    index={i}
                    reputationBadge={
                      <Suspense fallback={null}>
                        <ReputationBadge agentId={model.id} />
                      </Suspense>
                    }
                  />
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
              <span>🤖</span><span>{t('agentKitBadge')}</span>
            </div>
            <h2 className="text-3xl font-bold">{t('builtForAgents')}</h2>
            <p className="mt-3 max-w-xl mx-auto text-gray-400">
              {t('builtSubtitle')}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-8">
            <div className="rounded-xl bg-gray-800 p-4">
              <p className="mb-2 text-xs font-semibold text-gray-400">{t('step1Label')}</p>
              <pre className="overflow-auto text-xs text-green-400">{`GET /api/v1/agent-keys/me
x-agent-key: wasi_xxx

← { remaining: 4.80,
    status: "ok" }`}</pre>
            </div>
            <div className="rounded-xl bg-gray-800 p-4">
              <p className="mb-2 text-xs font-semibold text-gray-400">{t('step2Label')}</p>
              <pre className="overflow-auto text-xs text-green-400">{`GET /api/v1/models
  ?category=vision
  &max_price=0.05

← [{ slug, price,
     invoke_url }]`}</pre>
            </div>
            <div className="rounded-xl bg-gray-800 p-4">
              <p className="mb-2 text-xs font-semibold text-gray-400">{t('step3Label')}</p>
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
              {t('getAgentKey')}
            </Link>
            <a
              href="https://github.com/coinbase/agentkit"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-gray-600 px-6 py-2.5 font-semibold text-gray-300 hover:border-gray-400 transition"
            >
              {t('agentKitDocs')}
            </a>
          </div>
        </div>
      </section>
    </main>
  )
}


