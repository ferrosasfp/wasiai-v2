'use client'

/**
 * WAS-160c: Button + modal to upgrade an off-chain agent to on-chain.
 * Only renders if registration_type === 'off_chain' and user is the owner.
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
}

export function UpgradeOnChainButton({ slug, pricePerCall, registrationType, isOwner }: Props) {
  const t = useTranslations('agent')
  const { address, isConnected } = useWallet()
  const [showModal, setShowModal] = useState(false)

  // AC9: Only show if off-chain AND owner AND wallet connected
  if (registrationType !== 'off_chain' || !isOwner || !isConnected || !address) {
    return null
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="inline-flex items-center gap-1.5 rounded-xl border-2 border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 hover:border-emerald-300 transition"
      >
        <ShieldCheck className="h-4 w-4" />
        {t('upgrade.button')}
      </button>
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
