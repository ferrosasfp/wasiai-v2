'use client'
import { useTranslations } from 'next-intl'

export function PublishLoading() {
  const t = useTranslations('publish')
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-avax-600 border-t-transparent" />
        <p className="text-sm text-gray-500">{t('loading')}</p>
      </div>
    </div>
  )
}
