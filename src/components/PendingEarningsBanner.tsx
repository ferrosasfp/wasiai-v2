'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { WalletSetup } from '@/components/WalletSetup'
import { Wallet } from 'lucide-react'

interface Props {
  /** pending_earnings_usdc from creator_profiles (raw numeric, 6 decimals) */
  pendingEarnings: number
}

/** Formats a raw USDC value (stored as numeric 20,6) to 2-decimal display */
function formatUsdc(raw: number): string {
  return raw.toFixed(2)
}

export function PendingEarningsBanner({ pendingEarnings }: Props) {
  const t              = useTranslations('dashboard')
  const [open, setOpen] = useState(false)

  if (pendingEarnings <= 0) return null

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Wallet size={22} className="text-green-600 shrink-0" />
          <div>
            <p className="font-semibold text-amber-800">
              {t('pendingEarnings', { amount: formatUsdc(pendingEarnings) })}
            </p>
            <p className="mt-0.5 text-sm text-amber-700">
              {t('pendingEarningsSubtitle')}
            </p>
          </div>
        </div>

        {!open && (
          <button
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 transition"
          >
            {t('pendingEarningsCta')}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-white p-4">
          <WalletSetup initialWallet={null} />
        </div>
      )}
    </div>
  )
}
