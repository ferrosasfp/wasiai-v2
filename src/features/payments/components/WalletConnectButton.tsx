'use client'

import { ConnectButton } from 'thirdweb/react'
import { inAppWallet, createWallet } from 'thirdweb/wallets'
import { avalancheFuji } from 'thirdweb/chains'
import { thirdwebClient } from '@/shared/lib/web3/thirdwebClient'

interface WalletConnectButtonProps {
  locale: string
}

const wallets = [
  inAppWallet({ auth: { options: ['google', 'email'] } }),
  createWallet('io.metamask'),
  createWallet('app.core.extension'),
  createWallet('com.coinbase.wallet'),
]

// locale prop reserved for future use
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function WalletConnectButton({ locale: _locale }: WalletConnectButtonProps) {
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
          fontWeight: 500,
          padding: '6px 12px',
          borderRadius: '0.5rem',
          border: '1px solid #e5e7eb',
          backgroundColor: 'transparent',
          color: '#4b5563',
          height: 'auto',
          minWidth: 'auto',
        },
      }}
      detailsButton={{
        style: {
          fontSize: '0.75rem',
          fontWeight: 500,
          padding: '4px 10px',
          borderRadius: '0.5rem',
          border: '1px solid #e5e7eb',
          backgroundColor: 'transparent',
          color: '#4b5563',
          height: 'auto',
          minWidth: 'auto',
          maxHeight: '32px',
        },
      }}
      connectModal={{
        showThirdwebBranding: false,
      }}
      
    />
  )
}
