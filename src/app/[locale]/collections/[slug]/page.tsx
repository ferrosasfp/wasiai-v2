import { notFound } from 'next/navigation'
import { setRequestLocale, getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { ModelCard } from '@/features/models/components/ModelCard'
import type { Model } from '@/features/models/types/models.types'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, Layers } from 'lucide-react'

export const revalidate = 300

interface Props {
  params: Promise<{ locale: string; slug: string }>
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params
  const supabase = await createClient()
  const { data: collection } = await supabase
    .from('collections')
    .select('name, description')
    .eq('slug', slug)
    .single()

  if (!collection) return { title: 'Collection — WasiAI' }
  return {
    title: `${collection.name} — WasiAI`,
    description: collection.description ?? `Explore the ${collection.name} collection on WasiAI`,
  }
}

export default async function CollectionDetailPage({ params }: Props) {
  const { locale, slug } = await params
  setRequestLocale(locale)
  const t = await getTranslations('collections')
  const supabase = await createClient()

  // Fetch collection
  const { data: collection } = await supabase
    .from('collections')
    .select('*')
    .eq('slug', slug)
    .single()

  if (!collection) notFound()

  // Fetch agents in this collection, ordered by sort_order
  const { data: agentRows } = await supabase
    .from('collection_agents')
    .select('sort_order, agent:agents(*, creator:creator_profiles!agents_creator_id_fkey(id, username, display_name, avatar_url, verified))')
    .eq('collection_id', collection.id)
    .order('sort_order')

  const agents: Model[] = (agentRows ?? [])
    .map(r => r.agent as unknown as Model)
    .filter(Boolean)

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      {/* Back link */}
      <Link
        href={`/${locale}/collections`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6 transition-colors"
      >
        <ArrowLeft size={14} /> {t('backToCollections')}
      </Link>

      {/* Header */}
      <div className="mb-8">
        {collection.cover_image && (
          <div className="relative h-48 w-full rounded-2xl overflow-hidden mb-6">
            <Image
              src={collection.cover_image}
              alt={collection.name}
              fill
              className="object-cover"
            />
          </div>
        )}
        <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">{collection.name}</h1>
        {collection.description && (
          <p className="mt-2 text-lg text-gray-500">{collection.description}</p>
        )}
        <p className="mt-2 text-sm text-gray-400">
          <Layers size={13} className="inline mr-1" />
          {t('agents', { count: agents.length })}
        </p>
      </div>

      {/* Agents grid */}
      {agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <Layers size={48} className="mb-4" />
          <p>{t('empty')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent, i) => (
            <ModelCard key={agent.id} model={agent} locale={locale} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}
