'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface AgentSearchResult {
  id:            string
  slug:          string
  name:          string
  description:   string
  category:      string
  agent_type:    string
  price_per_call: number
  is_featured:   boolean
  total_calls:   number
  rank?:         number
}

interface UseAgentSearchOptions {
  debounceMs?: number   // default: 300
  minChars?:  number    // default: 2
  category?:  string
  agentType?: string
}

interface UseAgentSearchReturn {
  results:   AgentSearchResult[]
  isLoading: boolean
  error:     string | null
  query:     string
  setQuery:  (q: string) => void
  clear:     () => void
}

export function useAgentSearch(
  options: UseAgentSearchOptions = {}
): UseAgentSearchReturn {
  const { debounceMs = 300, minChars = 2, category, agentType } = options

  const [query,     setQueryState] = useState('')
  const [results,   setResults]    = useState<AgentSearchResult[]>([])
  const [isLoading, setIsLoading]  = useState(false)
  const [error,     setError]      = useState<string | null>(null)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const search = useCallback(async (q: string) => {
    if (q.trim().length < minChars) {
      setResults([])
      return
    }

    // Cancelar request anterior si sigue en vuelo
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setIsLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        q:     q.trim(),
        limit: '20',
      })
      if (category)  params.set('category',   category)
      if (agentType) params.set('agent_type', agentType)

      const res = await fetch(`/api/v1/agents?${params.toString()}`, {
        signal: abortRef.current.signal,
      })

      if (!res.ok) {
        if (res.status === 429) {
          throw new Error('Demasiadas búsquedas. Intenta en un momento.')
        }
        throw new Error(`Error ${res.status}`)
      }

      const json = await res.json()
      setResults(json.agents ?? [])
    } catch (err) {
      if ((err as Error).name === 'AbortError') return // cancelación intencional
      setError((err as Error).message)
      setResults([])
    } finally {
      setIsLoading(false)
    }
  }, [minChars, category, agentType])

  const setQuery = useCallback((q: string) => {
    setQueryState(q)

    // Cancelar timer anterior
    if (timerRef.current) clearTimeout(timerRef.current)

    if (q.trim().length < minChars) {
      setResults([])
      setIsLoading(false)
      return
    }

    // Debounce: esperar debounceMs antes de disparar el fetch
    timerRef.current = setTimeout(() => {
      search(q)
    }, debounceMs)
  }, [search, debounceMs, minChars])

  const clear = useCallback(() => {
    setQueryState('')
    setResults([])
    setError(null)
    setIsLoading(false)
    if (timerRef.current) clearTimeout(timerRef.current)
    abortRef.current?.abort()
  }, [])

  // Cleanup al desmontar componente
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      abortRef.current?.abort()
    }
  }, [])

  return { results, isLoading, error, query, setQuery, clear }
}
