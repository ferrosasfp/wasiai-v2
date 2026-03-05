'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

interface Alert {
  type: string
  agentId: string
  agentName: string
  message: string
}

interface Props {
  alerts: Alert[]
}

function resolveAlertMessage(message: string, t: ReturnType<typeof useTranslations<'analytics'>>) {
  // Backend encodes as "i18n.key:agentName"
  if (message.startsWith('analytics.alertHighError:')) {
    return t('alertHighError', { name: message.split(':')[1] })
  }
  if (message.startsWith('analytics.alertNoActivity:')) {
    return t('alertNoActivity', { name: message.split(':')[1] })
  }
  return message
}

export function AlertBanner({ alerts }: Props) {
  const t = useTranslations('analytics')
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const visible = alerts.filter(a => !dismissed.has(`${a.type}:${a.agentId}`))
  if (visible.length === 0) return null

  function dismiss(alert: Alert) {
    setDismissed(prev => new Set([...prev, `${alert.type}:${alert.agentId}`]))
  }

  return (
    <div className="space-y-2">
      {visible.map(alert => (
        <div
          key={`${alert.type}:${alert.agentId}`}
          className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
            alert.type === 'high_error_rate'
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-yellow-200 bg-yellow-50 text-yellow-800'
          }`}
        >
          <div className="flex items-start gap-2">
            <span className="shrink-0 text-base">
              {alert.type === 'high_error_rate' ? '⚠️' : '💤'}
            </span>
            <p>{resolveAlertMessage(alert.message, t)}</p>
          </div>
          <button
            onClick={() => dismiss(alert)}
            className="shrink-0 text-lg leading-none opacity-60 hover:opacity-100 transition-opacity"
            aria-label="Dismiss alert"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
