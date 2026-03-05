'use client'

/**
 * AgentKeyWidget — WAS dashboard
 * Muestra el resumen de Agent Keys del creator en el dashboard.
 * El creator ve cuánto tiene disponible para que sus agentes paguen servicios.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

interface AgentKey {
  id:           string
  name:         string
  budget_usdc:  number
  spent_usdc:   number
  is_active:    boolean
}

interface Props {
  locale: string
}

export function AgentKeyWidget({ locale }: Props) {
  const [keys, setKeys]       = useState<AgentKey[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/agent-keys')
      .then(r => r.ok ? r.json() : [])
      .then((data: AgentKey[]) => setKeys(data))
      .catch(() => setKeys([]))
      .finally(() => setLoading(false))
  }, [])

  const activeKeys    = keys.filter(k => k.is_active)
  const totalBudget   = activeKeys.reduce((s, k) => s + k.budget_usdc, 0)
  const totalSpent    = activeKeys.reduce((s, k) => s + k.spent_usdc, 0)
  const t = useTranslations('agentKeyWidget')
  const totalAvailable = Math.max(0, totalBudget - totalSpent)

  if (loading) {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-6 animate-pulse">
        <div className="h-4 w-32 bg-gray-200 rounded mb-3" />
        <div className="h-8 w-24 bg-gray-100 rounded" />
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-avax-200 bg-white p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-0.5">{t('title')}</p>
          <h3 className="text-base font-semibold text-gray-900">{t('subtitle')}</h3>
        </div>
        <span className="text-xs bg-avax-100 text-avax-700 px-2 py-1 rounded-full font-medium">
          {activeKeys.length} key{activeKeys.length !== 1 ? 's' : ''} activa{activeKeys.length !== 1 ? 's' : ''}
        </span>
      </div>

      {activeKeys.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-500">
            {t('noKey')}
          </p>
          <Link
            href={`/${locale}/agent-keys`}
            className="self-start rounded-lg bg-avax-500 px-4 py-2 text-sm font-semibold text-white hover:bg-avax-400 transition"
          >
            Crear Agent Key →
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">

          {/* Balance disponible */}
          <div className="rounded-xl bg-avax-50 border border-avax-100 p-4">
            <p className="text-xs text-gray-500 mb-1">{t('available')}</p>
            <p className="text-3xl font-extrabold text-avax-700">
              ${totalAvailable.toFixed(2)} <span className="text-base font-semibold text-avax-500">USDC</span>
            </p>
            <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
              <span>Depositado: ${totalBudget.toFixed(2)}</span>
              <span>·</span>
              <span>Usado: ${totalSpent.toFixed(2)}</span>
            </div>
            {/* Barra de progreso */}
            <div className="mt-3 h-1.5 w-full rounded-full bg-avax-100">
              <div
                className="h-1.5 rounded-full bg-avax-500 transition-all"
                style={{ width: `${totalBudget > 0 ? Math.min(100, (totalSpent / totalBudget) * 100) : 0}%` }}
              />
            </div>
          </div>

          {/* Keys individuales si hay más de una */}
          {activeKeys.length > 1 && (
            <div className="flex flex-col gap-2">
              {activeKeys.map(k => (
                <div key={k.id} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 truncate max-w-[60%]">{k.name}</span>
                  <span className="font-medium text-gray-900">
                    ${Math.max(0, k.budget_usdc - k.spent_usdc).toFixed(2)} USDC
                  </span>
                </div>
              ))}
            </div>
          )}

          <Link
            href={`/${locale}/agent-keys`}
            className="self-start text-sm font-semibold text-avax-600 hover:text-avax-800 transition"
          >
            {t('manage')}
          </Link>
        </div>
      )}
    </section>
  )
}
