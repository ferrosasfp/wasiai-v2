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
        className: 'rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600',
      }}
      connectModal={{
        showThirdwebBranding: false,
      }}
    />
  )
}
