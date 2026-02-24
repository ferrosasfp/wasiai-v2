import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'

export default function MainNotFound() {
  const t = useTranslations('common')

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="text-center">
        <p className="text-5xl font-bold text-gray-300">404</p>
        <h1 className="mt-4 text-xl font-bold text-gray-900">
          {t('notFound')}
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          {t('notFoundMessage')}
        </p>
        <Link
          href="/creator/dashboard"
          className="mt-6 inline-block rounded-lg bg-avax-500 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-avax-600 focus:outline-none focus:ring-2 focus:ring-avax-400 focus:ring-offset-2"
        >
          {t('back')}
        </Link>
      </div>
    </div>
  )
}
