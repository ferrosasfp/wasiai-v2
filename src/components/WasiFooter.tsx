import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

interface Props {
  locale: string
}

export async function WasiFooter({ locale }: Props) {
  const t = await getTranslations('transparency')

  return (
    <footer className="border-t mt-auto py-6 px-4">
      <div className="max-w-6xl mx-auto flex items-center justify-between text-sm text-gray-400">
        <span>© {new Date().getFullYear()} WasiAI</span>
        <Link
          href={`/${locale}/transparency`}
          className="hover:text-gray-600 transition-colors"
        >
          {t('footerLink')}
        </Link>
      </div>
    </footer>
  )
}
