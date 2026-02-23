/**
 * EarningsSection.tsx — Async sub-component for on-chain earnings
 *
 * A-02: Extracted from dashboard/page.tsx into its own async component
 *       so it can be wrapped in <Suspense> for streaming.
 *       The blockchain RPC call is isolated here — if it's slow/fails,
 *       the rest of the dashboard still renders immediately.
 */
import { createClient } from '@/lib/supabase/server'
import { getPendingEarnings } from '@/lib/contracts/marketplaceClient'
import { WithdrawButton } from '../WithdrawButton'
import { WalletSetup } from '../WalletSetup'
import { IS_MAINNET } from '@/lib/chain'

interface EarningsSectionProps {
  userId: string
}

export async function EarningsSection({ userId }: EarningsSectionProps) {
  const supabase = await createClient()

  const { data: profile } = await supabase
    .from('creator_profiles')
    .select('wallet_address')
    .eq('id', userId)
    .single()

  // On-chain RPC call — may be slow
  const pendingOnChain = profile?.wallet_address
    ? await getPendingEarnings(profile.wallet_address).catch(() => 0)
    : 0

  const contractAddress = process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT_ADDRESS ?? ''
  const explorerBase = IS_MAINNET ? 'snowscan.xyz' : 'testnet.snowscan.xyz'

  return (
    <section className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-purple-50 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-gray-900">On-chain Earnings</h2>
          <p className="mt-1 text-sm text-gray-500">
            Your USDC earnings accumulated in{' '}
            <a
              href={`https://${explorerBase}/address/${contractAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-500 hover:underline"
            >
              WasiAIMarketplace.sol
            </a>
          </p>
          <WalletSetup initialWallet={profile?.wallet_address ?? null} />
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-3xl font-bold text-indigo-700">
              ${pendingOnChain.toFixed(2)}
            </p>
            <p className="text-xs text-gray-500">USDC available</p>
          </div>
          <WithdrawButton
            pending={pendingOnChain}
            hasWallet={!!profile?.wallet_address}
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
    <section className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-purple-50 p-6 animate-pulse">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="h-5 w-40 rounded bg-indigo-200/60" />
          <div className="mt-2 h-4 w-56 rounded bg-indigo-100/60" />
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="h-9 w-24 rounded bg-indigo-200/60" />
            <div className="mt-1 h-3 w-20 rounded bg-indigo-100/60" />
          </div>
          <div className="h-10 w-24 rounded-xl bg-indigo-200/60" />
        </div>
      </div>
    </section>
  )
}
