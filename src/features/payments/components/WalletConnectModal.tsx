'use client'

import { ConnectEmbed } from 'thirdweb/react'
import { inAppWallet, createWallet } from 'thirdweb/wallets'
import { avalancheFuji } from 'thirdweb/chains'
import { thirdwebClient } from '@/shared/lib/web3/thirdwebClient'

interface WalletConnectModalProps {
  open: boolean
  onClose: () => void
  onConnected?: () => void
}

const wallets = [
  inAppWallet({
    auth: {
      options: ['google', 'email'],
    },
  }),
  createWallet('io.metamask'),
  createWallet('app.core.extension'),
  createWallet('com.coinbase.wallet'),
]

export function WalletConnectModal({ open, onClose, onConnected }: WalletConnectModalProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl p-1 max-w-sm"
        onClick={e => e.stopPropagation()}
      >
        <ConnectEmbed
          client={thirdwebClient}
          wallets={wallets}
          chain={avalancheFuji}
          theme="light"
          showThirdwebBranding={false}
          onConnect={() => {
            onConnected?.()
            onClose()
          }}
        />
      </div>
    </div>
  )
}
