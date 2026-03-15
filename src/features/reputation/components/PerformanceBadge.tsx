'use client'

import { useTranslations } from 'next-intl'

interface Props {
  score: number | null
}

export function PerformanceBadge({ score }: Props) {
  const t = useTranslations('modelDetail')

  if (score === null || score === undefined) return null

  let colorClasses: string
  if (score >= 90) {
    colorClasses = 'text-green-500 bg-green-500/10'
  } else if (score >= 70) {
    colorClasses = 'text-yellow-500 bg-yellow-500/10'
  } else {
    colorClasses = 'text-red-500 bg-red-500/10'
  }

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-0.5 text-xs font-semibold ${colorClasses}`}>
      {t('performanceBadge.label')}: {score}/100
    </span>
  )
}
