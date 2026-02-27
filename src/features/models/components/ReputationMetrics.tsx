// src/features/models/components/ReputationMetrics.tsx
// HU-4.4: Panel completo de métricas de reputación — Server Component (sin 'use client')
// AC-8: Muestra 4 métricas en detail page (/models/[slug])
// AC-9: Server Component — no hace fetch en cliente

import { getTranslations } from 'next-intl/server'
import { getAgentReputation } from '@/lib/reputation'

interface ReputationMetricsProps {
  agentId: string
}

export async function ReputationMetrics({ agentId }: ReputationMetricsProps) {
  const [rep, t] = await Promise.all([
    getAgentReputation(agentId),
    getTranslations('reputation'),
  ])

  // AC-3: Sin datos → sección invisible
  if (!rep.hasData) return null

  const uptimeBadgeClass =
    rep.uptimePct !== null && rep.uptimePct >= 99 ? 'bg-green-100 text-green-700' :
    rep.uptimePct !== null && rep.uptimePct >= 95 ? 'bg-yellow-100 text-yellow-700' :
    rep.uptimePct !== null                         ? 'bg-red-100 text-red-700' :
                                                     'bg-gray-100 text-gray-500'

  function fmt(value: number | null, suffix = ''): string {
    if (value === null) return '—'
    return `${Math.round(value)}${suffix}`
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          {t('title')}
        </h3>
        {rep.sufficientData ? (
          <span className="text-xs text-gray-400">
            {t('basedOn', { n: rep.totalCalls })}
          </span>
        ) : (
          <span className="text-xs text-amber-600 font-medium">
            {t('insufficientData')}
          </span>
        )}
      </div>

      {!rep.sufficientData ? (
        <p className="text-sm text-gray-500">{t('insufficientData')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 text-sm">
          {/* Uptime */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">{t('uptime')}</span>
            <span className={`inline-flex items-center self-start rounded-full px-2.5 py-0.5 text-sm font-semibold ${uptimeBadgeClass}`}>
              {fmt(rep.uptimePct, '%')}
            </span>
          </div>

          {/* Error Rate */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">{t('errorRate')}</span>
            <span className="font-semibold text-gray-900">
              {fmt(rep.errorRatePct, '%')}
            </span>
          </div>

          {/* p50 / avg latency */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">
              {rep.usingFallback ? t('latencyAvg') : t('latencyP50')}
            </span>
            <span className="font-semibold text-gray-900">
              {fmt(rep.p50Ms, ' ms')}
              {rep.usingFallback && rep.p50Ms !== null && (
                <span className="text-xs text-gray-400 ml-1">{t('approx')}</span>
              )}
            </span>
          </div>

          {/* p95 latency */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">{t('latencyP95')}</span>
            <span className="font-semibold text-gray-900">
              {rep.usingFallback ? '—' : fmt(rep.p95Ms, ' ms')}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
