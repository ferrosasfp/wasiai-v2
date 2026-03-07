'use client'

import { useSwitchChain } from 'wagmi'
import { useWallet } from '@/features/wallet/hooks/useWallet'
import { supportedChains, defaultChain, getChainById } from '@/shared/lib/web3/chains'

export function useNetwork() {
  const { chain, isThirdweb } = useWallet()
  const { switchChain } = useSwitchChain()

  const isCorrectNetwork = chain?.id === defaultChain.id

  function switchToDefault() {
    if (isThirdweb) return // thirdweb handles chain at tx time
    switchChain({ chainId: defaultChain.id })
  }

  function switchToChain(chainId: number) {
    if (isThirdweb) return // thirdweb handles chain at tx time
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
