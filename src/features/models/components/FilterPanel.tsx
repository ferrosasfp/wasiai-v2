'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Brain, BookMarked, Wrench, LayoutGrid, MessageSquare, Eye, Music, Code2, Bot, BarChart2 } from 'lucide-react'
import type { ReactNode } from 'react'

const AGENT_TYPES: { value: string; label: string; icon: ReactNode }[] = [
  { value: 'llm',  label: 'LLM',  icon: <Brain      size={14} /> },
  { value: 'rag',  label: 'RAG',  icon: <BookMarked size={14} /> },
  { value: 'tool', label: 'Tool', icon: <Wrench     size={14} /> },
]

const CATEGORIES: { value: string; label: string; icon: ReactNode }[] = [
  { value: 'all',        label: 'All',        icon: <LayoutGrid  size={14} /> },
  { value: 'nlp',        label: 'NLP',        icon: <MessageSquare size={14} /> },
  { value: 'vision',     label: 'Vision',     icon: <Eye         size={14} /> },
  { value: 'audio',      label: 'Audio',      icon: <Music       size={14} /> },
  { value: 'code',       label: 'Code',       icon: <Code2       size={14} /> },
  { value: 'multimodal', label: 'Multimodal', icon: <Bot         size={14} /> },
  { value: 'data',       label: 'Data',       icon: <BarChart2   size={14} /> },
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
    <div className="space-y-2">
      {/* Fila única scrolleable — categorías + tipos */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none" style={{ scrollbarWidth: 'none' }}>

        {/* Chips de Categoría */}
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            onClick={() => updateFilters({ category: cat.value === 'all' ? null : cat.value })}
            className={`shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
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

        {/* Separador */}
        <div className="shrink-0 h-5 w-px bg-gray-200" />

        {/* Chips de Tipo de Agente */}
        {AGENT_TYPES.map((type) => (
          <button
            key={type.value}
            onClick={() => updateFilters({
              agent_type: currentAgentType === type.value ? null : type.value
            })}
            className={`shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
              currentAgentType === type.value
                ? 'bg-violet-500 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <span>{type.icon}</span>
            {type.label}
          </button>
        ))}

        {/* Separador */}
        <div className="shrink-0 h-5 w-px bg-gray-200" />

        {/* Input Precio Máximo */}
        <div className="shrink-0 flex items-center gap-1.5">
          <span className="text-xs text-gray-400">$</span>
          <input
            type="number"
            min="0"
            max="10"
            step="0.10"
            value={currentMaxPrice}
            onChange={(e) => updateFilters({ max_price: e.target.value || null })}
            placeholder="Max"
            className="w-16 rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:border-avax-400 focus:outline-none"
          />
          <span className="text-xs text-gray-400">USDC</span>
        </div>

        {/* Botón Limpiar filtros */}
        {hasActiveFilters && (
          <button
            onClick={clearAll}
            className="shrink-0 flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 transition"
          >
            ✕ {t('clearFilters')}
          </button>
        )}
      </div>
    </div>
  )
}
