'use client'

/**
 * WAS-160c: Button + modal to upgrade an off-chain agent to on-chain.
 * Only renders if registration_type === 'off_chain' and user is the owner.
 * HU-069: Validates connected wallet matches registered withdrawal wallet.
 */

import { useState } from 'react'
import { useWallet } from '@/features/wallet/hooks/useWallet'
import { useTranslations } from 'next-intl'
import { ShieldCheck } from 'lucide-react'
import { UpgradeOnChainModal } from './UpgradeOnChainModal'

interface Props {
  slug: string
  pricePerCall: number
  registrationType: string
  isOwner: boolean
  registeredWallet?: string | null  // HU-069: creator_profiles.wallet_address
}

export function UpgradeOnChainButton({ slug, pricePerCall, registrationType, isOwner, registeredWallet }: Props) {
  const t = useTranslations('agent')
  const { address, isConnected } = useWallet()
  const [showModal, setShowModal] = useState(false)
  const [walletError, setWalletError] = useState<string | null>(null)

  // AC9: Only show if off-chain AND owner AND wallet connected
  if (registrationType !== 'off_chain' || !isOwner || !isConnected || !address) {
    return null
  }

  function handleClick() {
    setWalletError(null)

    // HU-069 AC-6: Block if no registered wallet
    if (!registeredWallet) {
      setWalletError('Configure your withdrawal wallet in Dashboard first.')
      return
    }

    // HU-069 AC-7: Validate connected wallet matches registered
    if (address?.toLowerCase() !== registeredWallet.toLowerCase()) {
      setWalletError(
        `Please connect wallet ${registeredWallet.slice(0, 6)}…${registeredWallet.slice(-4)}`
      )
      return
    }

    setShowModal(true)
  }

  return (
    <>
      <div>
        <button
          onClick={handleClick}
          className="inline-flex items-center gap-1.5 rounded-xl border-2 border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 hover:border-emerald-300 transition"
        >
          <ShieldCheck className="h-4 w-4" />
          {t('upgrade.button')}
        </button>
        {walletError && <p className="text-xs text-red-500 mt-1">{walletError}</p>}
      </div>
      {showModal && (
        <UpgradeOnChainModal
          slug={slug}
          pricePerCall={pricePerCall}
          creatorAddress={address}
          contractAddress={
            Number(process.env.NEXT_PUBLIC_CHAIN_ID) === 43114
              ? (process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET ?? '')
              : (process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI ?? '')
          }
          chainId={Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}
