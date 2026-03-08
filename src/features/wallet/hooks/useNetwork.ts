'use client'

import { useSwitchChain } from 'wagmi'
import { useWallet } from '@/features/wallet/hooks/useWallet'
import { supportedChains, defaultChain, getChainById } from '@/shared/lib/web3/chains'

export function useNetwork() {
  const { chain } = useWallet()
  const { switchChain } = useSwitchChain()

  const isCorrectNetwork = chain?.id === defaultChain.id

  function switchToDefault() {
    switchChain({ chainId: defaultChain.id })
  }

  function switchToChain(chainId: number) {
    switchChain({ chainId })
  }

  return {
    currentChain: chain,
    isCorrectNetwork,
    supportedChains,
    defaultChain,
    getChainById,
    switchToDefault,
    switchToChain,
  }
}
