'use client'

import { createClient } from '@/lib/supabase/client'
import { clearWalletState } from '@/lib/wallet-cleanup'
import { useTranslations } from 'next-intl'

interface Props {
  locale: string
}

export function ProfileSignOut({ locale }: Props) {
  const t = useTranslations('profile')

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    clearWalletState()
    window.location.href = `/${locale}/login`
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 transition"
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
      </svg>
      {t('signOut')}
    </button>
  )
}
