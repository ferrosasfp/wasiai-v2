'use client'

import Link from 'next/link'
import { useApiKeyBalance, type BalanceStatus } from '../hooks/useApiKeyBalance'

// ─── Props ────────────────────────────────────────────────────────────────────

interface ApiKeyBalanceProps {
  /** Pasar `!!userEmail` desde WasiNavBar — desactiva el hook sin sesión */
  enabled: boolean
  /** Locale actual extraído del pathname (e.g. 'en', 'es') */
  locale: string
}

// ─── SVG Íconos inline (sin dependencias externas) ───────────────────────────

function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}

function IconTriangle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

function IconXCircle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  )
}

function IconKey({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="M21 2l-9.6 9.6" />
      <path d="M15.5 7.5l3 3L22 7l-3-3" />
    </svg>
  )
}

function IconAlertCircle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

// ─── Helpers de formato ───────────────────────────────────────────────────────

function formatUSDC(amount: number): string {
  return `$${amount.toFixed(2)} USDC`
}

// ─── Mapa de estilos por estado ───────────────────────────────────────────────

const STATUS_STYLES: Record<BalanceStatus, string> = {
  loading:   'border-gray-200 bg-gray-50',
  no_key:    'border-gray-200 bg-gray-50',
  ok:        'border-green-200 bg-green-50',
  warning:   'border-yellow-200 bg-yellow-50',
  exhausted: 'border-red-200 bg-red-50',
  inactive:  'border-gray-200 bg-gray-50',
  error:     'border-yellow-200 bg-yellow-50',
}

const TEXT_STYLES: Record<BalanceStatus, string> = {
  loading:   'text-gray-400',
  no_key:    'text-gray-500',
  ok:        'text-green-700',
  warning:   'text-yellow-700',
  exhausted: 'text-red-700',
  inactive:  'text-gray-500',
  error:     'text-yellow-700',
}

const ICON_STYLES: Record<BalanceStatus, string> = {
  loading:   'text-gray-300',
  no_key:    'text-gray-400',
  ok:        'text-green-500',
  warning:   'text-yellow-500',
  exhausted: 'text-red-500',
  inactive:  'text-gray-400',
  error:     'text-yellow-500',
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function ApiKeyBalance({ enabled, locale }: ApiKeyBalanceProps) {
  const { uiStatus, data, isInitialLoading } = useApiKeyBalance(enabled)

  // No montar nada si no hay sesión
  if (!enabled) return null

  // ── Estado: cargando (fetch inicial O polling) → skeleton ─────────────────
  if (isInitialLoading || uiStatus === 'loading') {
    return (
      <div
        className="h-7 w-20 animate-pulse rounded-full bg-gray-100"
        aria-label="Cargando saldo..."
        role="status"
      />
    )
  }

  const badgeBase = `flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[uiStatus]}`
  const textClass = TEXT_STYLES[uiStatus]
  const iconClass = `h-3.5 w-3.5 shrink-0 ${ICON_STYLES[uiStatus]}`

  // ── Estado: sin key activa ─────────────────────────────────────────────────
  if (uiStatus === 'no_key') {
    return (
      <Link
        href={`/${locale}/agent-keys`}
        className={`${badgeBase} hover:bg-gray-100 transition-colors`}
        aria-label="Sin API key activa — Crear API key"
        title="Crea tu API key para invocar agentes"
      >
        <IconKey className={iconClass} />
        <span className={textClass}>Crear API key</span>
      </Link>
    )
  }

  // ── Extraer saldo para estados con datos ───────────────────────────────────
  const remaining = data && data.has_key ? data.remaining_usdc : 0
  const displayAmount = formatUSDC(remaining ?? 0)

  // ── Tooltip por estado ─────────────────────────────────────────────────────
  const tooltips: Partial<Record<BalanceStatus, string>> = {
    ok:        `Saldo disponible: ${displayAmount}`,
    warning:   'Saldo bajo — recarga pronto',
    exhausted: 'Saldo agotado — no puedes invocar agentes',
    inactive:  'Tu API key está desactivada',
    error:     'No se pudo actualizar el saldo',
  }
  const tooltip = tooltips[uiStatus] ?? displayAmount

  // ── Badge con ícono según estado ───────────────────────────────────────────
  function renderIcon() {
    switch (uiStatus) {
      case 'ok':        return <IconCheck className={iconClass} />
      case 'warning':   return <IconTriangle className={iconClass} />
      case 'exhausted': return <IconXCircle className={iconClass} />
      case 'inactive':  return <IconKey className={iconClass} />
      case 'error':     return <IconAlertCircle className={iconClass} />
      default:          return <IconKey className={iconClass} />
    }
  }

  // ── aria-label descriptivo ─────────────────────────────────────────────────
  function ariaLabel() {
    switch (uiStatus) {
      case 'ok':
      case 'warning':
      case 'exhausted': return `Saldo disponible: ${displayAmount}`
      case 'inactive':  return 'API key inactiva'
      case 'error':     return `Saldo (no actualizado): ${displayAmount}`
      default:          return 'Saldo de API key'
    }
  }

  return (
    <div
      className={badgeBase}
      aria-label={ariaLabel()}
      title={tooltip}
      role="status"
    >
      {renderIcon()}
      <span className={textClass}>
        {uiStatus === 'inactive' ? 'Key inactiva' : displayAmount}
      </span>
      {/* Indicador adicional de datos stale en estado error */}
      {uiStatus === 'error' && (
        <span className="ml-0.5 text-yellow-400 text-xs" aria-hidden="true">!</span>
      )}
    </div>
  )
}
