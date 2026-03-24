import type { Metadata } from 'next'
import { DemoPageClient } from './_components/DemoPageClient'
import { createClient } from '@/lib/supabase/server'
import { setRequestLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { Zap } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Autonomous Demo — WasiAI',
}

interface Props {
  params: Promise<{ locale: string }>
}

export default async function DemoPage({ params }: Props) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('auth')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-avax-100">
            <Zap size={32} className="text-avax-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Autonomous Demo</h1>
          <p className="text-gray-500">
            {t('signInRequired') ?? 'Sign in to access the Autonomous Demo and test agent orchestration.'}
          </p>
          <div className="flex flex-col gap-3">
            <Link
              href={`/${locale}/login`}
              className="rounded-xl bg-avax-500 px-6 py-3 text-sm font-semibold text-white hover:bg-avax-400 transition"
            >
              {t('signIn') ?? 'Sign In'}
            </Link>
            <Link
              href={`/${locale}/register`}
              className="rounded-xl border border-gray-300 px-6 py-3 text-sm font-semibold text-gray-600 hover:border-gray-400 transition"
            >
              {t('createAccount') ?? 'Create Account'}
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return <DemoPageClient />
}
