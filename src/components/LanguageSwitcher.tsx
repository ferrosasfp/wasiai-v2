'use client'

import { usePathname } from 'next/navigation'
import { useRouter } from 'next/navigation'

export function LanguageSwitcher() {
  const router = useRouter()
  // Usar siempre el pathname raw (con locale) para derivar locale y construir URL destino
  const rawPathname = usePathname()
  const currentLocale = rawPathname.startsWith('/es') ? 'es' : 'en'

  function switchLocale(newLocale: string) {
    if (newLocale === currentLocale) return
    // Quitar el prefijo del locale actual y reemplazar por el nuevo
    const pathWithoutLocale = rawPathname.replace(new RegExp(`^/${currentLocale}`), '')
    router.push(`/${newLocale}${pathWithoutLocale}`)
  }

  return (
    <div
      className="flex items-center gap-1 text-xs font-medium"
      role="group"
      aria-label="Change language / Cambiar idioma"
    >
      <button
        type="button"
        data-testid="lang-en"
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
        data-testid="lang-es"
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
