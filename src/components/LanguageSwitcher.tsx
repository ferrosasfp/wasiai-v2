'use client'

import { usePathname, useRouter } from '@/i18n/navigation'
import { useParams } from 'next/navigation'

export function LanguageSwitcher() {
  const router = useRouter()
  // usePathname de @/i18n/navigation retorna path SIN prefijo de locale
  // e.g. en /en/publish → devuelve '/publish'
  const pathname = usePathname()
  const params = useParams()
  const currentLocale = (params?.locale as string) || 'en'

  function switchLocale(newLocale: string) {
    if (newLocale === currentLocale) return
    router.replace(pathname, { locale: newLocale as 'en' | 'es' })
  }

  return (
    <div
      className="flex items-center gap-1 text-xs font-medium"
      role="group"
      aria-label="Change language / Cambiar idioma"
    >
      <button
        type="button"
        onClick={() => switchLocale('en')}
        aria-pressed={currentLocale === 'en'}
        aria-label="Switch to English"
        className={`rounded px-1.5 py-0.5 transition-colors ${
          currentLocale === 'en'
            ? 'font-bold text-gray-900'
            : 'text-gray-400 opacity-50 hover:text-gray-600'
        }`}
      >
        EN
      </button>
      <span className="text-gray-300" aria-hidden="true">|</span>
      <button
        type="button"
        onClick={() => switchLocale('es')}
        aria-pressed={currentLocale === 'es'}
        aria-label="Cambiar a Español"
        className={`rounded px-1.5 py-0.5 transition-colors ${
          currentLocale === 'es'
            ? 'font-bold text-gray-900'
            : 'text-gray-400 opacity-50 hover:text-gray-600'
        }`}
      >
        ES
      </button>
    </div>
  )
}
