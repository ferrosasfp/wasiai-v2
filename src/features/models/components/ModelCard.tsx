import Link from 'next/link'
import type { Model } from '../types/models.types'

const CATEGORY_COLORS: Record<string, string> = {
  nlp: 'bg-blue-100 text-blue-700',
  vision: 'bg-purple-100 text-purple-700',
  audio: 'bg-green-100 text-green-700',
  code: 'bg-orange-100 text-orange-700',
  multimodal: 'bg-pink-100 text-pink-700',
  data: 'bg-yellow-100 text-yellow-700',
}

const CATEGORY_ICONS: Record<string, string> = {
  nlp: '💬', vision: '👁', audio: '🎵', code: '💻', multimodal: '🤖', data: '📊',
}

interface ModelCardProps {
  model: Model
  locale: string
}

export function ModelCard({ model, locale }: ModelCardProps) {
  return (
    <Link
      href={`/${locale}/models/${model.slug}`}
      className="group block rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md hover:-translate-y-0.5"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-lg">
            {CATEGORY_ICONS[model.category] ?? '🤖'}
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors">
              {model.name}
            </h3>
            {model.creator && (
              <p className="text-xs text-gray-500">@{model.creator.username}</p>
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

      {/* Footer */}
      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>⚡ {model.total_calls.toLocaleString()} calls</span>
          {model.is_featured && (
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-600 font-medium">Featured</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-sm font-bold text-gray-900">
            ${model.price_per_call}
          </span>
          <span className="text-xs text-gray-400">/ call</span>
        </div>
      </div>
    </Link>
  )
}
