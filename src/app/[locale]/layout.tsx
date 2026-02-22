import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { routing } from '@/i18n/routing'
import { Web3Provider } from '@/shared/providers/Web3Provider'
import { WasiNavBar } from '@/components/WasiNavBar'
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
        {children}
      </Web3Provider>
    </NextIntlClientProvider>
  )
}
