// Server Component — sin 'use client'
import Link from 'next/link'
import { ModelCard } from './ModelCard'
import type { Model } from '../types/models.types'
import { Search } from 'lucide-react'

interface EmptySearchStateProps {
  search?: string
  category?: string
  locale: string
  suggestedModels: Model[]
  clearHref: string
  // Textos pre-resueltos desde page.tsx (evita importar next-intl/server aquí)
  texts: {
    noResults: string       // "No encontramos agentes para 'X'"
    suggestion: string      // "Prueba con otras palabras..."
    alsoTryClearCategory?: string
    viewAll: string         // "Ver todos los agentes"
    popularAgents: string   // "Agentes populares"
  }
}

export function EmptySearchState({
  category,
  locale,
  suggestedModels,
  clearHref,
  texts,
}: EmptySearchStateProps) {
  return (
    <div className="py-16">
      {/* Mensaje principal */}
      <div className="text-center mb-10">
        <div className="flex justify-center mb-4"><Search size={48} className="text-gray-300" /></div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          {texts.noResults}
        </h2>
        <p className="text-gray-500 text-sm mb-1">
          {texts.suggestion}
        </p>
        {category && texts.alsoTryClearCategory && (
          <p className="text-gray-400 text-sm">
            {texts.alsoTryClearCategory}
          </p>
        )}

        {/* Botón "Ver todos los agentes" */}
        <Link
          href={clearHref}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-avax-500 px-6 py-2.5 text-sm font-semibold text-white hover:bg-avax-600 transition"
        >
          {texts.viewAll}
        </Link>
      </div>

      {/* Agentes sugeridos — solo si existen */}
      {suggestedModels.length > 0 && (
        <div>
          <h3 className="text-center text-sm font-medium text-gray-400 uppercase tracking-wide mb-6">
            {texts.popularAgents}
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {suggestedModels.map((model, i) => (
              <ModelCard key={model.id} model={model} locale={locale} index={i} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
