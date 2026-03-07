'use client'

import { useCallback } from 'react'
import { type Abi, type Address, type Hash, encodeFunctionData } from 'viem'
import { useWalletClient } from 'wagmi'
import { useActiveAccount } from 'thirdweb/react'
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
  const { data: wagmiWalletClient } = useWalletClient()

  const isThirdweb = !!thirdwebAccount

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
      if (isThirdweb && thirdwebAccount) {
        // ── thirdweb path ──────────────────────────────────────────
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
    [isThirdweb, thirdwebAccount, wagmiWalletClient],
  )

  /**
   * Sign EIP-712 typed data. Only works with wagmi wallets (external).
   * Thirdweb embedded wallets should use the thirdweb transaction path instead.
   */
  const signTypedData = useCallback(
    async (params: Parameters<NonNullable<typeof wagmiWalletClient>['signTypedData']>[0]) => {
      if (isThirdweb) {
        throw new Error('EIP-712_NOT_SUPPORTED_THIRDWEB')
      }
      if (!wagmiWalletClient) {
        throw new Error('Wallet not connected')
      }
      return wagmiWalletClient.signTypedData(params)
    },
    [isThirdweb, wagmiWalletClient],
  )

  return {
    isThirdweb,
    isReady: isThirdweb ? !!thirdwebAccount : !!wagmiWalletClient,
    writeContract,
    signTypedData,
  }
}
