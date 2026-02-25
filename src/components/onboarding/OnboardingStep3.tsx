'use client'

import { useTranslations } from 'next-intl'
import { WalletSetup } from '@/components/WalletSetup'
import { completeOnboarding } from '@/app/[locale]/onboarding/actions'

interface Props {
  initialWallet: string | null
}

export function OnboardingStep3({ initialWallet }: Props) {
  const t = useTranslations('onboarding.step3')

  // Called by WalletSetup after successful wallet save via router.refresh()
  // We also need to handle completeOnboarding when wallet is saved.
  // WalletSetup calls router.refresh() — we intercept via form action below.

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
      <div className="mb-6 text-center">
        <div className="flex items-center justify-center gap-2 mb-3">
          <div className="text-4xl">💳</div>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-500">
            {t('optional')}
          </span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>
      </div>

      <div className="rounded-xl border border-gray-100 bg-gray-50 p-5 mb-6">
        <WalletSetup initialWallet={initialWallet} />
      </div>

      <form action={completeOnboarding}>
        <button
          type="submit"
          className="w-full rounded-xl border border-gray-200 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50 transition"
        >
          {t('skip')}
        </button>
      </form>
    </div>
  )
}
