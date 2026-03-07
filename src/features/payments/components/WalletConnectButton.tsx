'use client'

import { useEffect, useReducer } from 'react'
import { ConnectButton } from 'thirdweb/react'
import { inAppWallet, createWallet } from 'thirdweb/wallets'
import { avalancheFuji } from 'thirdweb/chains'
import { thirdwebClient } from '@/shared/lib/web3/thirdwebClient'

interface WalletConnectButtonProps {
  locale: string
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

// locale prop reserved for future use
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function WalletConnectButton({ locale: _locale }: WalletConnectButtonProps) {
  const [mounted, markMounted] = useReducer(() => true, false)
  useEffect(markMounted, [markMounted])

  if (!mounted) {
    return (
      <button className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600">
        Connect
      </button>
    )
  }

  return (
    <ConnectButton
      client={thirdwebClient}
      wallets={wallets}
      chain={avalancheFuji}
      theme="light"
      connectButton={{
        label: 'Connect Wallet',
        style: {
          fontSize: '0.75rem',
          fontWeight: '500',
          padding: '0.375rem 0.75rem',
          borderRadius: '0.5rem',
          border: '1px solid #e5e7eb',
          backgroundColor: 'white',
          color: '#374151',
          height: 'auto',
        },
      }}
      connectModal={{
        size: 'compact',
        title: 'Connect to WasiAI',
        showThirdwebBranding: false,
      }}
    />
  )
}
