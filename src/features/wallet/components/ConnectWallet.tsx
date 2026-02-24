'use client'

import { useTranslations } from 'next-intl'
import { useWallet } from '../hooks/useWallet'
import { CHAIN_ID, CHAIN_LABEL } from '@/lib/chain'

/**
 * A-05: WrongNetworkBanner shown when user is on wrong chain.
 * Prompts them to switch to the expected Avalanche network.
 */
function WrongNetworkBanner({ currentChainName }: { currentChainName?: string }) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm"
    >
      <span aria-hidden="true">⚠️</span>
      <span className="text-amber-800">
        Wrong network
        {currentChainName ? ` (${currentChainName})` : ''}
        {' — '}switch to{' '}
        <strong>{CHAIN_LABEL}</strong>
      </span>
    </div>
  )
}

export function ConnectWallet() {
  const t = useTranslations('wallet')
  const { address, isConnected, isConnecting, chain, connectWallet, disconnect } = useWallet()

  // A-05: Validate the connected chain matches the expected network
  const isWrongNetwork = isConnected && chain && chain.id !== CHAIN_ID

  if (isConnected && address) {
    return (
      <div className="flex flex-col gap-2">
        {/* A-05: Show wrong network banner when on wrong chain */}
        {isWrongNetwork && <WrongNetworkBanner currentChainName={chain?.name} />}

        <div className="flex items-center gap-2">
          <span className="rounded-md bg-green-100 px-3 py-1 text-sm text-green-800">
            {address.slice(0, 6)}...{address.slice(-4)}
          </span>
          <button
            onClick={() => disconnect()}
            className="rounded-md border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100"
          >
            {t('disconnect')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      onClick={connectWallet}
      disabled={isConnecting}
      aria-label={isConnecting ? 'Connecting wallet...' : 'Connect your Web3 wallet'}
      className="rounded-md bg-avax-500 px-4 py-2 text-white hover:bg-avax-600 disabled:opacity-50"
    >
      {isConnecting ? '...' : t('connect')}
    </button>
  )
}
