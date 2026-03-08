'use client'

import { useCallback } from 'react'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { injected } from 'wagmi/connectors'

/**
 * Unified wallet hook — wagmi only (HU-071: Thirdweb removed).
 * EIP-6963 auto-discovers Core Wallet, MetaMask, Rabby, etc. via wagmi injected connector.
 */
export function useWallet() {
  const { address, isConnected, isConnecting, chain } = useAccount()
  const { connect }    = useConnect()
  const { disconnect } = useDisconnect()

  const connectWallet = useCallback(() => {
    connect({ connector: injected() })
  }, [connect])

  const disconnectWallet = useCallback(() => {
    disconnect()
  }, [disconnect])

  return {
    address,
    isConnected,
    isConnecting,
    chain,
    connectWallet,
    disconnect: disconnectWallet,
    // isThirdweb removed — no embedded wallets
  }
}
