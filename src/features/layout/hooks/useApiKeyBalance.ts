'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { KeyBalanceResult } from '@/app/api/v1/me/key-balance/route'

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type BalanceStatus =
  | 'loading'    // fetch inicial en curso → skeleton
  | 'no_key'     // usuario sin API key activa
  | 'ok'         // saldo suficiente (usage_pct < 80%)
  | 'warning'    // saldo bajo (usage_pct >= 80%, remaining > 0)
  | 'exhausted'  // saldo agotado (remaining_usdc === 0)
  | 'inactive'   // key existe pero is_active = false
  | 'error'      // fetch falló, mostrando datos stale

export interface UseApiKeyBalanceResult {
  /** Estado visual derivado para el componente */
  uiStatus: BalanceStatus
  /** Datos crudos del último fetch exitoso */
  data: KeyBalanceResult | null
  /** true solo durante el primer fetch */
  isInitialLoading: boolean
  /** true durante cualquier re-fetch (background) */
  isFetching: boolean
  /** true si el último fetch falló */
  hasError: boolean
  /** Fuerza re-fetch inmediato (usar tras invocar un agente) */
  refresh: () => void
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 60_000
const ENDPOINT = '/api/v1/me/key-balance'

// ─── Derivación de uiStatus ───────────────────────────────────────────────────

function deriveUiStatus(
  data: KeyBalanceResult | null,
  hasError: boolean,
  isInitialLoading: boolean
): BalanceStatus {
  if (isInitialLoading) return 'loading'
  if (!data) return hasError ? 'error' : 'loading'

  if (!data.has_key) return 'no_key'

  const { status, remaining_usdc, usage_pct } = data

  if (status === 'inactive') return 'inactive'
  if (remaining_usdc === 0 || status === 'budget_exhausted') return 'exhausted'
  // warning = menos del 20% del budget disponible (usage_pct >= 80)
  if ((usage_pct ?? 0) >= 80) return 'warning'
  if (hasError) return 'error'  // datos stale presentes
  return 'ok'
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useApiKeyBalance(
  /** Activar el hook solo cuando hay sesión. Pasar `!!userEmail` desde WasiNavBar. */
  enabled: boolean
): UseApiKeyBalanceResult {
  const [data,             setData]             = useState<KeyBalanceResult | null>(null)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isFetching,       setIsFetching]       = useState(false)
  const [hasError,         setHasError]         = useState(false)

  // Ref para evitar setState en componentes desmontados
  const isMounted = useRef(true)
  // Ref para poder llamar fetchBalance dentro del callback de visibilitychange
  const fetchRef = useRef<(() => Promise<void>) | undefined>(undefined)

  const fetchBalance = useCallback(async () => {
    if (!isMounted.current || document.hidden) return
    setIsFetching(true)
    try {
      const res = await fetch(ENDPOINT, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: KeyBalanceResult = await res.json()
      if (isMounted.current) {
        setData(json)
        setHasError(false)
        setIsInitialLoading(false)
      }
    } catch {
      // No console.error en producción — el estado `error` maneja esto visualmente
      if (isMounted.current) {
        setHasError(true)
        setIsInitialLoading(false)
      }
    } finally {
      if (isMounted.current) setIsFetching(false)
    }
  }, [])

  // Mantener ref sincronizada para el listener de visibilidad
  fetchRef.current = fetchBalance

  useEffect(() => {
    if (!enabled) {
      setIsInitialLoading(false)
      return
    }

    isMounted.current = true

    // Fetch inicial
    fetchBalance()

    // Polling periódico (el guard `document.hidden` dentro de fetchBalance pausa naturalmente)
    const intervalId = setInterval(() => {
      fetchRef.current?.()
    }, POLL_INTERVAL_MS)

    // Reanudar fetch inmediato al volver el foco
    function handleVisibilityChange() {
      if (!document.hidden) {
        fetchRef.current?.()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    // Refresh desde agent-keys page tras Add USDC / Withdraw / Close Key
    window.addEventListener('apikey:refresh', fetchBalance as EventListener)

    return () => {
      isMounted.current = false
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('apikey:refresh', fetchBalance as EventListener)
    }
  }, [enabled, fetchBalance])

  const uiStatus = deriveUiStatus(data, hasError, isInitialLoading)

  return {
    uiStatus,
    data,
    isInitialLoading,
    isFetching,
    hasError,
    refresh: fetchBalance,
  }
}
