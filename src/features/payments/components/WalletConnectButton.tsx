'use client'

import { useState } from 'react'
import { useAccount, useDisconnect } from 'wagmi'
import { useTranslations } from 'next-intl'
import { WalletConnectModal } from './WalletConnectModal'

// Fuji chain ID — red correcta
const FUJI_CHAIN_ID = 43113

interface WalletConnectButtonProps {
  locale: string
}

function truncateAddress(addr: `0x${string}` | undefined): string {
  if (!addr) return ''
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

// locale prop reserved for future use (e.g., locale-aware network names)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function WalletConnectButton({ locale: _locale }: WalletConnectButtonProps) {
  const [showModal, setShowModal] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const { address, isConnected, chain } = useAccount()
  const { disconnect } = useDisconnect()
  const t = useTranslations('wallet')

  const isWrongNetwork = isConnected && chain?.id !== FUJI_CHAIN_ID

  // Caso A: No conectado
  if (!isConnected) {
    return (
      <>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition"
        >
          {t('connectWallet')}
        </button>
        <WalletConnectModal open={showModal} onClose={() => setShowModal(false)} />
      </>
    )
  }

  // Caso B/C: Conectado (red correcta o incorrecta)
  return (
    <div className="relative">
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition"
      >
        <span className={`inline-block h-2 w-2 rounded-full ${isWrongNetwork ? 'bg-yellow-400' : 'bg-green-400'}`} />
        {truncateAddress(address)}
        {isWrongNetwork && (
          <span className="text-yellow-600 text-xs">{t('wrongNetwork')}</span>
        )}
      </button>
      {dropdownOpen && (
        <div className="absolute right-0 mt-1 w-40 rounded-xl border border-gray-100 bg-white shadow-lg z-50">
          <button
            onClick={() => { disconnect(); setDropdownOpen(false) }}
            className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 rounded-xl"
          >
            {t('disconnect')}
          </button>
        </div>
      )}
    </div>
  )
}
