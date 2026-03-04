import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { setOnboardingStep } from '@/app/[locale]/onboarding/actions'
import { Rocket } from 'lucide-react'

interface Props {
  locale: string
}

export async function OnboardingStep2({ locale }: Props) {
  const t = await getTranslations('onboarding.step2')

  async function skipStep2() {
    'use server'
    await setOnboardingStep(3)
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
      <div className="mb-6 text-center">
        <div className="flex justify-center mb-3"><Rocket size={40} className="text-avax-500" /></div>
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>
      </div>

      <div className="space-y-3">
        <Link
          href={`/${locale}/publish?from=onboarding`}
          className="flex w-full items-center justify-center rounded-xl bg-avax-500 py-3 font-semibold text-white hover:bg-avax-600 transition"
        >
          {t('cta')}
        </Link>

        <form action={skipStep2}>
          <button
            type="submit"
            className="w-full rounded-xl border border-gray-200 py-3 text-sm font-medium text-gray-500 hover:bg-gray-50 transition"
          >
            {t('skip')}
          </button>
        </form>
      </div>

      <p className="mt-4 text-center text-xs text-gray-400">
        Puedes publicar tu agente en cualquier momento desde tu dashboard
      </p>
    </div>
  )
}
