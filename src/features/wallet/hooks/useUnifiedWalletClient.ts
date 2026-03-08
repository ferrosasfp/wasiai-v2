'use client'

import { useCallback } from 'react'
import { type Abi, type Address, type Hash, encodeFunctionData } from 'viem'
import { useWalletClient } from 'wagmi'
import { useActiveAccount, useActiveWallet } from 'thirdweb/react'
import { prepareTransaction, sendTransaction } from 'thirdweb'
import { avalancheFuji } from 'thirdweb/chains'
import { thirdwebClient } from '@/shared/lib/web3/thirdwebClient'
import { getPublicClient } from '@/shared/lib/web3/client'

/**
 * Unified contract-write interface that works for both thirdweb embedded
 * wallets and external wagmi wallets.
 *
 * - thirdweb path: `prepareTransaction` + `sendTransaction` (no wagmi hooks)
 * - wagmi path: simulate → writeContract via viem WalletClient
 */
export function useUnifiedWalletClient() {
  const thirdwebAccount = useActiveAccount()
  const thirdwebWallet  = useActiveWallet()
  const { data: wagmiWalletClient } = useWalletClient()

  // isThirdweb for UI guard: true ONLY for embedded wallets (Google/email via inApp)
  // Used by WithdrawButton to block bundler path — same logic as useWallet.ts
  const isThirdweb = !!thirdwebAccount && thirdwebWallet?.id === 'inApp'

  // isThirdwebConnected: true for ANY wallet connected via thirdweb UI (inApp OR external EOA)
  // Used internally for signing — thirdweb handles signing for all its connected wallets
  const isThirdwebConnected = !!thirdwebAccount

  const writeContract = useCallback(
    async ({
      address,
      abi,
      functionName,
      args = [],
      chainId,
    }: {
      address: Address
      abi: Abi
      functionName: string
      args?: readonly unknown[]
      chainId?: number
    }): Promise<Hash> => {
      if (isThirdwebConnected && thirdwebAccount) {
        // ── thirdweb path (inApp + external EOA via thirdweb UI) ───
        const data = encodeFunctionData({ abi, functionName, args: args as unknown[] })

        const tx = prepareTransaction({
          chain: avalancheFuji,
          client: thirdwebClient,
          to: address,
          data,
        })

        const receipt = await sendTransaction({
          transaction: tx,
          account: thirdwebAccount,
        })

        return receipt.transactionHash as Hash
      }

      // ── wagmi path ───────────────────────────────────────────────
      if (!wagmiWalletClient) {
        throw new Error('Wallet not connected')
      }

      const client = getPublicClient(chainId)
      const { request } = await client.simulateContract({
        address,
        abi,
        functionName,
        args: args as unknown[],
        account: wagmiWalletClient.account,
      })

      return wagmiWalletClient.writeContract(request)
    },
    [isThirdwebConnected, thirdwebAccount, wagmiWalletClient],
  )

  /**
   * Sign EIP-712 typed data. Works with both wagmi and thirdweb wallets.
   * Thirdweb embedded wallets support signTypedData via smart account (ERC-1271).
   */
  const signTypedData = useCallback(
    async (params: Parameters<NonNullable<typeof wagmiWalletClient>['signTypedData']>[0]) => {
      if (isThirdwebConnected && thirdwebAccount) {
        // thirdweb v5 smart accounts support signTypedData
        // Use the account's signTypedData method directly
        if (!thirdwebAccount.signTypedData) {
          throw new Error('signTypedData not available on this account')
        }
        const sig = await thirdwebAccount.signTypedData(params as Parameters<NonNullable<typeof thirdwebAccount.signTypedData>>[0])
        return sig as `0x${string}`
      }
      if (!wagmiWalletClient) {
        throw new Error('Wallet not connected')
      }
      return wagmiWalletClient.signTypedData(params)
    },
    [isThirdwebConnected, thirdwebAccount, wagmiWalletClient],
  )

  /**
   * Sign a plain message (personal_sign / EIP-191).
   * Works with ALL wallet types including thirdweb embedded wallets.
   */
  const signMessage = useCallback(
    async (message: string): Promise<Hash> => {
      if (isThirdwebConnected && thirdwebAccount) {
        const { signMessage: twSignMessage } = await import('thirdweb/utils')
        const sig = await twSignMessage({ account: thirdwebAccount, message })
        return sig as Hash
      }
      if (!wagmiWalletClient) {
        throw new Error('Wallet not connected')
      }
      return wagmiWalletClient.signMessage({ message })
    },
    [isThirdwebConnected, thirdwebAccount, wagmiWalletClient],
  )

  return {
    isThirdweb,
    isReady: isThirdwebConnected ? !!thirdwebAccount : !!wagmiWalletClient,
    writeContract,
    signTypedData,
    signMessage,
  }
}
