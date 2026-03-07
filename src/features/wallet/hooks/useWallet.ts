'use client'

import { useActiveAccount, useActiveWallet, useActiveWalletChain, useDisconnect as useThirdwebDisconnect } from 'thirdweb/react'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { injected } from 'wagmi/connectors'

/**
 * Unified wallet hook that checks thirdweb first, falls back to wagmi.
 * This allows both embedded wallets (thirdweb) and external wallets (wagmi) to coexist.
 */
export function useWallet() {
  // thirdweb state (embedded + thirdweb-connected wallets)
  const thirdwebAccount = useActiveAccount()
  const thirdwebWallet = useActiveWallet()
  const thirdwebChain = useActiveWalletChain()
  const { disconnect: thirdwebDisconnect } = useThirdwebDisconnect()

  // wagmi state (legacy external wallets)
  const wagmiAccount = useAccount()
  const { connect } = useConnect()
  const { disconnect: wagmiDisconnect } = useDisconnect()

  // Prefer thirdweb if connected
  const isThirdweb = !!thirdwebAccount?.address
  const address = thirdwebAccount?.address ?? wagmiAccount.address
  const isConnected = isThirdweb || wagmiAccount.isConnected
  const isConnecting = wagmiAccount.isConnecting
  const chain = isThirdweb
    ? (thirdwebChain ? { id: thirdwebChain.id, name: thirdwebChain.name } : undefined)
    : wagmiAccount.chain

  function connectWallet() {
    connect({ connector: injected() })
  }

  function disconnect() {
    if (isThirdweb && thirdwebWallet) {
      thirdwebDisconnect(thirdwebWallet)
    } else {
      wagmiDisconnect()
    }
  }

  return {
    address: address as `0x${string}` | undefined,
    isConnected,
    isConnecting,
    chain,
    connectWallet,
    disconnect,
    isThirdweb,
  }
}
