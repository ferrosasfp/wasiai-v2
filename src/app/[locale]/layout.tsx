import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { routing } from '@/i18n/routing'
import { Web3Provider } from '@/shared/providers/Web3Provider'
import { WasiNavBar } from '@/components/WasiNavBar'
import { BottomTabBar } from '@/features/auth/components/BottomTabBar'
import { WasiFooter } from '@/components/WasiFooter'
import { createClient } from '@/lib/supabase/server'

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

interface Props {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) {
    notFound()
  }

  setRequestLocale(locale)

  // Read session server-side so the navbar gets the email in the initial HTML
  // — no flash, no delay, no client-side round-trip needed
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <NextIntlClientProvider>
      <Web3Provider>
        <WasiNavBar initialEmail={user?.email ?? null} />
        <div className="pb-20 sm:pb-0">{children}</div>
        {/* Bottom Tab Bar — visible solo en mobile (sm:hidden dentro del componente) */}
        <BottomTabBar locale={locale} initialEmail={user?.email ?? null} />
      </Web3Provider>
      <WasiFooter locale={locale} />
    </NextIntlClientProvider>
  )
}
