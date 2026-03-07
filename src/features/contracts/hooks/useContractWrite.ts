'use client'

import { useState, useCallback } from 'react'
import { type Abi, type Address, type Hash } from 'viem'
import { useUnifiedWalletClient } from '@/features/wallet/hooks/useUnifiedWalletClient'

interface UseContractWriteParams {
  address: Address
  abi: Abi
  functionName: string
  chainId?: number
}

export function useContractWrite({ address, abi, functionName, chainId }: UseContractWriteParams) {
  const { isReady, writeContract } = useUnifiedWalletClient()
  const [hash, setHash] = useState<Hash | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const write = useCallback(async (args: readonly unknown[] = []) => {
    if (!isReady) {
      setError('Wallet not connected')
      return null
    }

    setIsLoading(true)
    setError(null)
    setHash(null)

    try {
      const txHash = await writeContract({
        address,
        abi,
        functionName,
        args,
        chainId,
      })
      setHash(txHash)
      return txHash
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Contract write failed'
      setError(message)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [address, abi, functionName, isReady, writeContract, chainId])

  return { hash, isLoading, error, write }
}
