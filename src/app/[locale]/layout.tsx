import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { routing } from '@/i18n/routing'
import { Web3Provider } from '@/shared/providers/Web3Provider'
import { WasiNavBar } from '@/components/WasiNavBar'
import { MobileBottomNav } from '@/components/MobileBottomNav'   // HU-MOBILE-NAV
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

  // HU-MOBILE-NAV: Determinar role en servidor — sin query extra visible en cliente
  // 1 query por PK a creator_profiles (index scan, < 1ms) → prop drilling sin flash
  let userRole: 'creator' | 'consumer' | null = null
  if (user) {
    const { data: profile } = await supabase
      .from('creator_profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle()
    userRole = profile ? 'creator' : 'consumer'
  }

  return (
    <NextIntlClientProvider>
      <Web3Provider>
        <WasiNavBar initialEmail={user?.email ?? null} />
        {children}
        {/* HU-MOBILE-NAV: Bottom Nav — sm:hidden lo oculta en desktop */}
        <MobileBottomNav locale={locale} userRole={userRole} />
      </Web3Provider>
      <WasiFooter locale={locale} />
    </NextIntlClientProvider>
  )
}
