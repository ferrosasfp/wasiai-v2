import React from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Layers, Star, MessageCircle } from 'lucide-react'

export interface CollectionCardProps {
  collection: {
    id: string
    slug: string
    name: string
    description: string | null
    cover_image: string | null
    featured: boolean
    agent_count: number
  }
  locale: string
}

export const CollectionCard = React.memo(function CollectionCard({
  collection,
  locale,
}: CollectionCardProps) {
  const t = useTranslations('collections')

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5">
    <Link
      href={`/${locale}/collections/${collection.slug}`}
      className="absolute inset-0 z-0"
      aria-label={collection.name}
    />
      {/* Cover image */}
      <div className="relative h-36 w-full bg-gradient-to-br from-gray-100 to-gray-200 overflow-hidden">
        {collection.cover_image ? (
          <Image
            src={collection.cover_image}
            alt={collection.name}
            fill
            className="object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Layers size={40} className="text-gray-300" />
          </div>
        )}
        {collection.featured && (
          <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-yellow-400 px-2 py-0.5 text-xs font-semibold text-yellow-900">
            <Star size={10} /> {t('featured')}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-base font-semibold text-gray-900 group-hover:text-avax-600 transition-colors">
          {collection.name}
        </h3>
        {collection.description && (
          <p className="mt-1 text-sm text-gray-500 line-clamp-2">{collection.description}</p>
        )}
        <div className="mt-auto pt-3 flex items-center justify-between">
          <span className="text-xs text-gray-400">
            <Layers size={12} className="inline mr-1" />
            {t('agents', { count: collection.agent_count })}
          </span>
          {collection.slug === 'defi-chat' && (
            <div className="relative z-10 flex items-center gap-2">
              <Link
                href={`/${locale}/chat`}
                className="inline-flex items-center gap-1 rounded-full bg-avax-600 px-3 py-1 text-xs font-semibold text-white hover:bg-avax-700 transition-colors"
              >
                <MessageCircle size={11} />
                Chat DeFi
              </Link>
              <Link
                href={`/${locale}/demo`}
                className="inline-flex items-center gap-1 rounded-full border border-avax-500 px-3 py-1 text-xs font-semibold text-avax-600 hover:bg-avax-50 transition-colors"
              >
                ⚡ Demo
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
