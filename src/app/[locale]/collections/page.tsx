import { setRequestLocale, getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { CollectionCard } from '@/features/collections/components/CollectionCard'
import { Layers } from 'lucide-react'

export const revalidate = 300

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'collections' })
  return {
    title: `${t('title')} — WasiAI`,
    description: t('subtitle'),
  }
}

export default async function CollectionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('collections')
  const supabase = await createClient()

  // Fetch collections with agent count via join
  const { data: collections } = await supabase
    .from('collections')
    .select('*, collection_agents(agent_id)')
    .order('sort_order')

  const enriched = (collections ?? []).map(c => ({
    ...c,
    agent_count: Array.isArray(c.collection_agents) ? c.collection_agents.length : 0,
  }))

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">{t('title')}</h1>
        <p className="mt-2 text-gray-500">{t('subtitle')}</p>
      </div>

      {enriched.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <Layers size={48} className="mb-4" />
          <p className="text-lg">{t('empty')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {enriched.map(c => (
            <CollectionCard key={c.id} collection={c} locale={locale} />
          ))}
        </div>
      )}
    </div>
  )
}
