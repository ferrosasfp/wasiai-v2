'use client'

import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { MessageSquare, Eye, Music, Code2, Bot, BarChart2 } from 'lucide-react'

const CATEGORY_COLORS: Record<string, string> = {
  nlp:        'bg-blue-100 text-blue-700',
  vision:     'bg-orange-100 text-orange-700',
  audio:      'bg-green-100 text-green-700',
  code:       'bg-orange-100 text-orange-700',
  multimodal: 'bg-yellow-100 text-yellow-700',
  data:       'bg-yellow-100 text-yellow-700',
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  nlp:        <MessageSquare size={16} />,
  vision:     <Eye           size={16} />,
  audio:      <Music         size={16} />,
  code:       <Code2         size={16} />,
  multimodal: <Bot           size={16} />,
  data:       <BarChart2     size={16} />,
}

interface Props {
  data: Partial<{
    name: string
    description: string
    category: string
    price_per_call: number
    cover_image: string | null
  }>
}

/**
 * AgentCardPreview — live preview of how the agent will look in the marketplace.
 * Based on ModelCard but without Link wrapper, without metrics, with "Preview" badge.
 */
export function AgentCardPreview({ data }: Props) {
  const t = useTranslations('publish.preview')

  const priceLabel = data.price_per_call
    ? `${data.price_per_call} USDC/call`
    : t('pricePlaceholder')

  return (
    <div className="relative rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      {/* Preview badge */}
      <span className="absolute right-3 top-3 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-600">
        {t('label')}
      </span>

      {/* Header */}
      <div className="flex items-start gap-3 pr-16">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-avax-400 to-avax-600 text-lg">
          {data.cover_image ? (
            <Image
              src={data.cover_image}
              alt={data.name ?? 'Agent cover'}
              fill
              className="object-cover"
              sizes="40px"
            />
          ) : (
            <span>{CATEGORY_ICONS[data.category ?? ''] ?? <Bot size={16} />}</span>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-gray-900">
            {data.name || <span className="text-gray-300">Nombre del agente</span>}
          </h3>
          {data.category && (
            <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_COLORS[data.category] ?? 'bg-gray-100 text-gray-600'}`}>
              {data.category}
            </span>
          )}
        </div>
      </div>

      {/* Description */}
      <p className="mt-3 line-clamp-2 text-sm text-gray-500">
        {data.description || <span className="text-gray-300">Descripción del agente…</span>}
      </p>

      {/* Footer — price */}
      <div className="mt-4 flex items-center justify-between border-t border-gray-50 pt-3">
        <span className="flex items-center gap-1 text-xs text-gray-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400" />
          Avalanche · x402
        </span>
        <span className="text-sm font-bold text-gray-900">{priceLabel}</span>
      </div>
    </div>
  )
}
