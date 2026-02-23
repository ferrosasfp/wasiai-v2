'use client'

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { type Abi, type Address } from 'viem'
import { getPublicClient } from '@/shared/lib/web3/client'

interface UseContractReadParams {
  address: Address
  abi: Abi
  functionName: string
  args?: readonly unknown[]
  enabled?: boolean
  chainId?: number
}

export function useContractRead({ address, abi, functionName, args = [], enabled = true, chainId }: UseContractReadParams) {
  const [data, setData] = useState<unknown>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // P-12: Stabilize args reference using serialized key to avoid infinite re-render loops.
  // The argsKey is itself memoized so JSON.stringify only runs when args actually change.
  // P-12: Memoize argsKey to avoid expensive JSON.stringify every render
  const argsKey = useMemo(() => JSON.stringify(args), [args])
  // stableArgs uses argsKey as dep so it only changes when args values actually change
  const stableArgs = useMemo(() => args, [argsKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const abiRef = useRef(abi)
  abiRef.current = abi

  const refetch = useCallback(async () => {
    if (!enabled) return

    setIsLoading(true)
    setError(null)

    try {
      const client = getPublicClient(chainId)
      const result = await client.readContract({
        address,
        abi: abiRef.current,
        functionName,
        args: stableArgs as unknown[],
      })
      setData(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Contract read failed'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [address, functionName, stableArgs, enabled, chainId])

  useEffect(() => {
    if (enabled) {
      refetch()
    }
  }, [enabled, refetch])

  return { data, isLoading, error, refetch }
}
