'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'

const AGENT_TYPES = [
  { value: 'llm',        label: 'LLM',        icon: '🧠' },
  { value: 'rag',        label: 'RAG',         icon: '📚' },
  { value: 'tool',       label: 'Tool',        icon: '🔧' },
  { value: 'multimodal', label: 'Multimodal',  icon: '🎭' },
  { value: 'code',       label: 'Code',        icon: '💻' },
]

const CATEGORIES = [
  { value: 'all',        label: 'All',         icon: '✨' },
  { value: 'nlp',        label: 'NLP',         icon: '💬' },
  { value: 'vision',     label: 'Vision',      icon: '👁' },
  { value: 'audio',      label: 'Audio',       icon: '🎵' },
  { value: 'code',       label: 'Code',        icon: '💻' },
  { value: 'multimodal', label: 'Multimodal',  icon: '🤖' },
  { value: 'data',       label: 'Data',        icon: '📊' },
]

export function FilterPanel() {
  const t = useTranslations('filters')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const currentCategory  = searchParams.get('category')  ?? 'all'
  const currentAgentType = searchParams.get('agent_type') ?? ''
  const currentMaxPrice  = searchParams.get('max_price')  ?? ''

  // Función central: actualizar uno o más params y hacer push
  function updateFilters(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('page') // reset paginación al cambiar filtros

    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '' || value === 'all') {
        params.delete(key)
      } else {
        params.set(key, value)
      }
    })

    router.push(`${pathname}?${params.toString()}`)
  }

  const hasActiveFilters = (
    currentCategory !== 'all' ||
    currentAgentType !== '' ||
    currentMaxPrice !== ''
  )

  function clearAll() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('category')
    params.delete('agent_type')
    params.delete('max_price')
    params.delete('page')
    // Mantener 'search' si existe — limpiar filtros NO limpia la búsqueda
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">

        {/* Chips de Categoría */}
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => updateFilters({ category: cat.value === 'all' ? null : cat.value })}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                (cat.value === 'all' && currentCategory === 'all') ||
                currentCategory === cat.value
                  ? 'bg-avax-500 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <span>{cat.icon}</span>
              {cat.label}
            </button>
          ))}
        </div>

        {/* Separador */}
        <div className="hidden sm:block h-6 w-px bg-gray-200" />

        {/* Chips de Tipo de Agente */}
        <div className="flex flex-wrap gap-2">
          {AGENT_TYPES.map((type) => (
            <button
              key={type.value}
              onClick={() => updateFilters({
                agent_type: currentAgentType === type.value ? null : type.value
              })}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                currentAgentType === type.value
                  ? 'bg-violet-500 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <span>{type.icon}</span>
              {type.label}
            </button>
          ))}
        </div>

        {/* Separador */}
        <div className="hidden sm:block h-6 w-px bg-gray-200" />

        {/* Input Precio Máximo */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500 shrink-0">
            {t('maxPrice')}
          </label>
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-400">$</span>
            <input
              type="number"
              min="0"
              max="10"
              step="0.10"
              value={currentMaxPrice}
              onChange={(e) => updateFilters({ max_price: e.target.value || null })}
              placeholder="10.00"
              className="w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:border-avax-400 focus:outline-none"
            />
            <span className="text-xs text-gray-400">USDC</span>
          </div>
        </div>

        {/* Botón Limpiar filtros — solo visible cuando hay filtros activos */}
        {hasActiveFilters && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 transition"
          >
            ✕ {t('clearFilters')}
          </button>
        )}
      </div>
    </div>
  )
}
