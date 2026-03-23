'use client'

import { useTranslations } from 'next-intl'

interface HealthBadgeProps {
  healthCheck: { passed: boolean; message?: string } | null
  lastCheckedAt: string | null
}

function getMinutesAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
}

export function HealthBadge({ healthCheck, lastCheckedAt }: HealthBadgeProps) {
  const t = useTranslations('health_badge')

  if (!lastCheckedAt || healthCheck === null) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-gray-400"
        aria-label={t('not_checked')}
        title={t('not_checked')}
      >
        <span aria-hidden>⚪</span>
        <span className="hidden sm:inline">{t('not_checked')}</span>
      </span>
    )
  }

  const minutesAgo = getMinutesAgo(lastCheckedAt)
  const checkedLabel = t('last_checked', { minutes: minutesAgo })

  if (healthCheck.passed) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-green-600"
        aria-label={t('online')}
        title={checkedLabel}
      >
        <span aria-hidden>🟢</span>
        <span className="hidden sm:inline">{t('online')}</span>
      </span>
    )
  }

  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-red-500"
      aria-label={`${t('down')} — ${checkedLabel}`}
      title={checkedLabel}
    >
      <span aria-hidden>🔴</span>
      <span className="hidden sm:inline">{t('down')}</span>
    </span>
  )
}
