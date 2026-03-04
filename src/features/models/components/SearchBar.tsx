'use client'

import { useRef } from 'react'
import { useAgentSearch, type AgentSearchResult } from '../hooks/useAgentSearch'
import { Search } from 'lucide-react'

interface SearchBarProps {
  defaultValue?: string
  category?:     string
  placeholder?:  string
  /**
   * mode='server' → form GET para navegación SSR (mantiene SEO, recarga página)
   * mode='client' → useAgentSearch reactivo (SPA, sin recarga)
   */
  mode?:       'server' | 'client'
  /** Callback opcional para recibir resultados en modo client */
  onResults?:  (results: AgentSearchResult[]) => void
}

export function SearchBar({
  defaultValue = '',
  category,
  placeholder  = 'Busca agentes por función, tecnología...',
  mode         = 'server',
  /* onResults is intentionally not destructured here — it is forwarded to
     the parent via useAgentSearch when needed in mode='client' */
  ...rest
}: SearchBarProps) {
  void rest // suppress unused destructuring
  const inputRef = useRef<HTMLInputElement>(null)
  const { query, setQuery, isLoading, error, clear } = useAgentSearch({ category })

  // ── Modo server: form GET → recarga SSR con SEO ───────────────────
  if (mode === 'server') {
    return (
      <form method="GET" className="flex items-center gap-2">
        {category && (
          <input type="hidden" name="category" value={category} />
        )}
        <div className="relative">
          <input
            ref={inputRef}
            type="search"
            name="search"
            defaultValue={defaultValue}
            placeholder={placeholder}
            aria-label="Buscar agentes"
            className={[
              'w-full rounded-xl border border-gray-200 bg-white',
              'px-4 py-2 pr-10 text-sm',
              'focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100',
              'sm:w-64',
            ].join(' ')}
          />
          <button
            type="submit"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label="Buscar"
          >
            <Search size={16} />
          </button>
        </div>
      </form>
    )
  }

  // ── Modo client: reactivo con debounce ────────────────────────────
  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={e => {
            setQuery(e.target.value)
          }}
          placeholder={placeholder}
          aria-label="Buscar agentes"
          className={[
            'w-full rounded-xl border border-gray-200 bg-white',
            'px-4 py-2 pr-10 text-sm',
            'focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100',
            'sm:w-64',
          ].join(' ')}
        />
        {query && (
          <button
            type="button"
            onClick={clear}
            className="text-gray-400 hover:text-gray-600 text-sm"
            aria-label="Limpiar búsqueda"
          >
            ✕
          </button>
        )}
        {isLoading && (
          <span className="text-xs text-gray-400 animate-pulse" aria-live="polite">
            buscando…
          </span>
        )}
      </div>
      {error && (
        <p className="mt-1 text-xs text-red-500" role="alert">{error}</p>
      )}
    </div>
  )
}
