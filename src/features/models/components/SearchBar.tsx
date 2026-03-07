'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useAgentSearch, type AgentSearchResult } from '../hooks/useAgentSearch'

interface SearchBarProps {
  defaultValue?: string
  category?:     string
  placeholder?:  string
  mode?:         'server' | 'client'
  onResults?:    (results: import('../hooks/useAgentSearch').AgentSearchResult[]) => void
  'aria-label'?: string
}

export function SearchBar({
  defaultValue = '',
  placeholder  = 'Search agents...',
  mode         = 'server',
  ...rest
}: SearchBarProps) {
  void rest
  const t = useTranslations('search')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [value, setValue] = useState(defaultValue)

  // Sync with URL changes (e.g. back/forward navigation)
  useEffect(() => {
    setValue(searchParams.get('search') ?? '')
  }, [searchParams])

  const pushSearch = useCallback((q: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (q.trim()) {
      params.set('search', q.trim())
    } else {
      params.delete('search')
    }
    // Reset to page 1 on new search
    params.delete('page')
    const qs = params.toString()
    router.push(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
  }, [router, pathname, searchParams])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value
    setValue(q)

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => pushSearch(q), 350)
  }

  const handleClear = () => {
    setValue('')
    if (timerRef.current) clearTimeout(timerRef.current)
    pushSearch('')
    inputRef.current?.focus()
  }

  // Cleanup
  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  // Client mode uses the existing useAgentSearch hook
  if (mode === 'client') {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { query, setQuery, isLoading, error, clear } = useAgentSearch()
    return (
      <div className="relative">
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={placeholder}
            aria-label="Search agents"
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2 pr-10 text-sm focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100 sm:w-64"
          />
          {query && (
            <button type="button" onClick={clear} className="text-gray-400 hover:text-gray-600 text-sm" aria-label="Clear search">✕</button>
          )}
          {isLoading && (
            <span className="text-xs text-gray-400 animate-pulse" aria-live="polite">{t('searching')}</span>
          )}
        </div>
        {error && <p className="mt-1 text-xs text-red-500" role="alert">{error}</p>}
      </div>
    )
  }

  // Server mode: debounced URL push (filters as you type)
  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={handleChange}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (timerRef.current) clearTimeout(timerRef.current)
            pushSearch(value)
          }
        }}
        placeholder={placeholder}
        aria-label="Search agents"
        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2 pr-10 text-sm focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100 sm:w-64"
      />
      {value ? (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          aria-label="Clear search"
        >
          <X size={16} />
        </button>
      ) : (
        <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      )}
    </div>
  )
}
