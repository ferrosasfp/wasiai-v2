'use client'

import Link from 'next/link'
import Image from 'next/image'
import { memo, useState } from 'react'
import type { Model } from '../types/models.types'
import { MessageSquare, Eye, Music, Code2, Bot, BarChart2, Flame, BadgeCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { OnChainBadge } from '@/components/badges/OnChainBadge'

const CATEGORY_COLORS: Record<string, string> = {
  nlp:        'bg-blue-100 text-blue-700',
  vision:     'bg-orange-100 text-orange-700',
  audio:      'bg-green-100 text-green-700',
  code:       'bg-orange-100 text-orange-700',
  multimodal: 'bg-yellow-100 text-yellow-700',
  data:       'bg-yellow-100 text-yellow-700',
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  nlp:        <MessageSquare size={18} />,
  vision:     <Eye           size={18} />,
  audio:      <Music         size={18} />,
  code:       <Code2         size={18} />,
  multimodal: <Bot           size={18} />,
  data:       <BarChart2     size={18} />,
}

interface ModelCardProps {
  model: Model
  locale: string
  /** Position index in the grid — first 3 are above the fold and get priority loading */
  index?: number
  /** HU-4.4: Badge de reputación (opcional) — pasado como ReactNode desde Server Components */
  reputationBadge?: React.ReactNode
}

// P-03: Memoized to avoid unnecessary re-renders in grid lists
export const ModelCard = memo(function ModelCard({ model, locale, index = 0, reputationBadge }: ModelCardProps) {
  const t = useTranslations('marketplace')
  const remaining = Math.max(0, model.total_calls ?? 0)
  const [imgError, setImgError] = useState(false)

  return (
    <Link
      href={`/${locale}/models/${model.slug}`}
      className="group block rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md hover:-translate-y-0.5"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-avax-400 to-avax-600 text-lg shrink-0 overflow-hidden">
            {model.cover_image && !imgError ? (
              // P-04: sizes avoids downloading unnecessarily large images; priority for LCP candidates
              <Image
                src={model.cover_image}
                alt={`${model.name} cover`}
                fill
                className="object-cover"
                sizes="40px"
                priority={index < 3}
                onError={() => setImgError(true)}
              />
            ) : (
              CATEGORY_ICONS[model.category] ?? <Bot size={18} />
            )}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 group-hover:text-avax-600 transition-colors truncate">
              {model.name ?? 'Sin nombre'}
            </h3>
            {model.creator && (
              <p className="text-xs text-gray-500 truncate">@{model.creator.username}</p>
            )}
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${CATEGORY_COLORS[model.category] ?? 'bg-gray-100 text-gray-600'}`}>
          {model.category}
        </span>
      </div>

      {/* Description */}
      {model.description && (
        <p className="mt-3 text-sm text-gray-600 line-clamp-2">{model.description}</p>
      )}

      {/* Agent type + registration badges */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {model.agent_type && model.agent_type !== 'model' && (
          <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-600 capitalize">
            {model.agent_type}
          </span>
        )}
        {model.registration_type === 'on_chain' && <OnChainBadge />}
        {model.erc8004_id && (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
            ERC-8004
          </span>
        )}
        {model.free_trial_enabled && model.free_trial_limit > 0 && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
            {t('freeTrial', { count: model.free_trial_limit })}
          </span>
        )}
      </div>

      {/* Footer */}
      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-gray-400 min-w-0">
          {remaining > 0 && (
            <span className="shrink-0 flex items-center gap-1">
              <Flame size={11} className="text-orange-500" />
              {remaining >= 1000
                ? `${(remaining / 1000).toFixed(1)}k`
                : remaining} {t('calls')}
            </span>
          )}
          {model.is_featured && (
            <span className="rounded-full bg-avax-50 px-2 py-0.5 text-avax-600 font-medium shrink-0">{t('featured')}</span>
          )}
          {model.reputation_score !== null && model.reputation_count > 0 && (
            <span className="inline-flex items-center gap-1 shrink-0 text-green-600 font-medium">
              👍 {model.reputation_score}%
            </span>
          )}
          {model.creator?.verified && (
            <span className="shrink-0" title={t('verifiedCreator')}>
              <BadgeCheck size={13} className="text-blue-500" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* HU-4.4: Badge compacto de uptime — pasado como prop desde Server Components */}
          {reputationBadge}
          <div className="flex items-baseline gap-1">
            <span className="text-sm font-bold text-gray-900">${(model.price_per_call ?? 0).toFixed(2)}</span>
            <span className="text-xs text-gray-400">USDC</span>
          </div>
        </div>
      </div>

      {/* Chain indicator + CTA */}
      <div className="mt-3 flex items-center justify-between border-t border-gray-50 pt-3 text-xs text-gray-400">
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400" />
          Avalanche · x402
        </span>
        <span className="rounded-full bg-avax-50 px-3 py-1 text-xs font-semibold text-avax-600 group-hover:bg-avax-500 group-hover:text-white transition-colors">
          Try →
        </span>
      </div>
    </Link>
  )
})
