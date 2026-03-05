'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { OnChainStats } from '@/components/transparency/OnChainStats'

interface Props {
  locale: string
}

export function WasiFooter({ locale }: Props) {
  const t = useTranslations('transparency')

  return (
    <footer className="border-t mt-auto py-6 px-4">
      <div className="max-w-6xl mx-auto space-y-3">
        <div className="flex items-center justify-center">
          <OnChainStats compact />
        </div>
        <div className="flex items-center justify-between text-sm text-gray-400">
          <span>© {new Date().getFullYear()} WasiAI</span>
          <Link
            href={`/${locale}/transparency`}
            className="hover:text-gray-600 transition-colors"
          >
            {t('footerLink')}
          </Link>
        </div>
      </div>
    </footer>
  )
}
