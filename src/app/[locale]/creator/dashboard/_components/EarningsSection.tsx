/**
 * EarningsSection.tsx — Async sub-component for on-chain earnings
 *
 * A-02: Extracted from dashboard/page.tsx into its own async component
 *       so it can be wrapped in <Suspense> for streaming.
 *       The blockchain RPC call is isolated here — if it's slow/fails,
 *       the rest of the dashboard still renders immediately.
 */
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { WithdrawButton } from '../WithdrawButton'


interface EarningsSectionProps {
  userId: string
}

export async function EarningsSection({ userId }: EarningsSectionProps) {
  const t = await getTranslations('dashboard')
  const supabase = await createClient()

  // HU-067: earnings now tracked off-chain in Supabase (pending_earnings_usdc)
  const { data: profile } = await supabase
    .from('creator_profiles')
    .select('wallet_address, pending_earnings_usdc')
    .eq('id', userId)
    .single()

  const pendingOnChain = Number(profile?.pending_earnings_usdc ?? 0)

  const hasEarnings = pendingOnChain > 0

  return (
    <section className={`rounded-2xl border p-6 ${
      hasEarnings
        ? 'border-green-200 bg-gradient-to-br from-green-50 to-white'
        : 'border-gray-200 bg-white'
    }`}>
      {/* Hero banner cuando hay fondos disponibles */}
      {hasEarnings && (
        <div className="mb-5 flex items-center gap-3 rounded-xl bg-green-500 px-4 py-3 text-white">
          <span className="text-2xl">💰</span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">{t('earningsBannerTitle')}</p>
            <p className="text-xs text-green-100">{t('earningsBannerSub')}</p>
          </div>
          <p className="text-2xl font-extrabold shrink-0">${pendingOnChain.toFixed(2)}</p>
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-block h-2 w-2 rounded-full bg-avax-500" />
            <h2 className="font-semibold text-gray-900">{t('onchainEarnings')}</h2>
          </div>

        </div>
        <div className="flex items-center gap-4">
          {!hasEarnings && (
            <div className="text-right">
              <p className="text-3xl font-bold text-gray-400">$0.00</p>
              <p className="text-xs text-gray-400">{t('earningsNone')}</p>
            </div>
          )}
          <WithdrawButton
            pending={pendingOnChain}
            hasWallet={!!profile?.wallet_address}
            walletAddress={profile?.wallet_address ?? ''}
          />
        </div>
      </div>
    </section>
  )
}

/**
 * Skeleton loader shown while EarningsSection is streaming in.
 */
export function EarningsSkeleton() {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 animate-pulse">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="h-5 w-40 rounded bg-avax-200/60" />
          <div className="mt-2 h-4 w-56 rounded bg-avax-100/60" />
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="h-9 w-24 rounded bg-avax-200/60" />
            <div className="mt-1 h-3 w-20 rounded bg-avax-100/60" />
          </div>
          <div className="h-10 w-24 rounded-xl bg-avax-200/60" />
        </div>
      </div>
    </section>
  )
}
