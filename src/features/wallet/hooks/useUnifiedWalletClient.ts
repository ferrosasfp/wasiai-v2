'use client'

import { useCallback } from 'react'
import { type Abi, type Address, type Hash } from 'viem'
import { useWalletClient } from 'wagmi'
import { getPublicClient } from '@/shared/lib/web3/client'

/**
 * Unified contract-write interface — wagmi/viem only (HU-071: Thirdweb removed).
 * Uses viem WalletClient for writeContract, signTypedData, and signMessage.
 */
export function useUnifiedWalletClient() {
  const { data: wagmiWalletClient } = useWalletClient()

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
      if (!wagmiWalletClient) throw new Error('Wallet not connected')

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
    [wagmiWalletClient],
  )

  const signTypedData = useCallback(
    async (params: Parameters<NonNullable<typeof wagmiWalletClient>['signTypedData']>[0]) => {
      if (!wagmiWalletClient) throw new Error('Wallet not connected')
      return wagmiWalletClient.signTypedData(params)
    },
    [wagmiWalletClient],
  )

  const signMessage = useCallback(
    async (message: string): Promise<Hash> => {
      if (!wagmiWalletClient) throw new Error('Wallet not connected')
      return wagmiWalletClient.signMessage({ message })
    },
    [wagmiWalletClient],
  )

  return {
    isReady:      !!wagmiWalletClient,
    writeContract,
    signTypedData,
    signMessage,
  }
}
