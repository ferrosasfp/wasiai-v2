'use client'

import { useCallback, useEffect } from 'react'
import { useActiveAccount, useActiveWallet, useDisconnect as useThirdwebDisconnect } from 'thirdweb/react'
import { useAccount, useConnect, useDisconnect as useWagmiDisconnect } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { avalancheFuji as viemAvalancheFuji } from 'viem/chains'

export function useWallet() {
  // thirdweb state
  const thirdwebAccount = useActiveAccount()
  const thirdwebWallet = useActiveWallet()
  // thirdwebChain no longer needed — we normalize to viemAvalancheFuji
  // const thirdwebChain = useActiveWalletChain()
  const { disconnect: thirdwebDisconnect } = useThirdwebDisconnect()

  // wagmi state
  const { address: wagmiAddress, isConnected: wagmiConnected, isConnecting: wagmiConnecting, chain: wagmiChain } = useAccount()
  const { connect } = useConnect()
  const { disconnect: wagmiDisconnect } = useWagmiDisconnect()

  const isThirdweb = !!thirdwebAccount

  // ── Dual-connection guard ───────────────────────────────────────
  // If both providers are connected, auto-disconnect the secondary one
  // to prevent address mismatch between display and signing.
  useEffect(() => {
    if (thirdwebAccount && wagmiConnected) {
      // thirdweb wins (most recent connect) → disconnect wagmi
      wagmiDisconnect()
    }
  }, [thirdwebAccount, wagmiConnected, wagmiDisconnect])

  const address = isThirdweb ? (thirdwebAccount.address as `0x${string}`) : wagmiAddress
  const isConnected = isThirdweb || wagmiConnected
  const isConnecting = wagmiConnecting

  // ── Wave 6c: Normalize chain to wagmi-compatible Chain object ───
  const chain = isThirdweb
    ? viemAvalancheFuji  // thirdweb embedded wallets are chain-agnostic; default to Fuji
    : wagmiChain

  const connectWallet = useCallback(() => {
    connect({ connector: injected() })
  }, [connect])

  // Disconnect ALL providers to prevent dangling connections (Issue 3a)
  const disconnect = useCallback(() => {
    if (thirdwebWallet) {
      thirdwebDisconnect(thirdwebWallet)
    }
    if (wagmiConnected) {
      wagmiDisconnect()
    }
  }, [thirdwebWallet, thirdwebDisconnect, wagmiConnected, wagmiDisconnect])

  return {
    address,
    isConnected,
    isConnecting,
    chain,
    connectWallet,
    disconnect,
    isThirdweb,
  }
}
