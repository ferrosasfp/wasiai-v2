'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

interface DayData {
  date: string
  calls: number
}

interface Props {
  series: DayData[]
}

export function CallsChart({ series }: Props) {
  const t = useTranslations('analytics')
  const [tooltip, setTooltip] = useState<{ date: string; calls: number } | null>(null)
  const maxCalls = Math.max(...series.map(d => d.calls), 1)
  const allZero = series.every(d => d.calls === 0)

  if (allZero) {
    return (
      <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('callsChartTitle')}</h3>
        <div className="flex h-24 items-center justify-center text-sm text-gray-400">
          {t('noCallsYet')}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-semibold text-gray-700">{t('callsChartTitle')}</h3>
      <div className="relative">
        {/* Tooltip */}
        {tooltip && (
          <div className="absolute -top-8 left-1/2 -translate-x-1/2 rounded bg-gray-900 px-2 py-1 text-xs text-white whitespace-nowrap z-10 pointer-events-none">
            {tooltip.date}: {tooltip.calls} llamadas
          </div>
        )}

        {/* Bars */}
        <div className="flex items-end gap-0.5 h-24">
          {series.map((day) => {
            const heightPct = maxCalls > 0 ? (day.calls / maxCalls) * 100 : 0
            const heightPx = Math.max(heightPct * 0.96, day.calls > 0 ? 2 : 0)
            return (
              <div
                key={day.date}
                className="flex-1 flex items-end"
                onMouseEnter={() => setTooltip({ date: day.date, calls: day.calls })}
                onMouseLeave={() => setTooltip(null)}
              >
                <div
                  className="w-full rounded-sm bg-[#E84142] opacity-80 hover:opacity-100 transition-opacity cursor-default"
                  style={{ height: `${heightPx}px`, minWidth: '2px' }}
                />
              </div>
            )
          })}
        </div>

        {/* X-axis labels — show only first, mid, last */}
        <div className="mt-1 flex justify-between text-xs text-gray-400">
          <span>{series[0]?.date.slice(5) ?? ''}</span>
          <span>{series[Math.floor(series.length / 2)]?.date.slice(5) ?? ''}</span>
          <span>{series[series.length - 1]?.date.slice(5) ?? ''}</span>
        </div>
      </div>
    </div>
  )
}
