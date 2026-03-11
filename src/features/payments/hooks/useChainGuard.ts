'use client'

import { useWalletClient, useSwitchChain } from 'wagmi'
import { useWallet } from '@/features/wallet/hooks/useWallet'
import { CHAIN_ID, CHAIN_PARAMS } from '@/lib/chain'

export function useChainGuard() {
  const { isConnected, chain } = useWallet()
  const { data: walletClient } = useWalletClient()
  const { switchChainAsync }   = useSwitchChain()

  const chainSettled   = isConnected && chain !== undefined
  const isCorrectChain = chainSettled ? chain.id === CHAIN_ID : true

  /** CRÍTICO: llamar SOLO desde un onClick del usuario — browsers bloquean popup de wallet en useEffect. */
  async function switchToChain(): Promise<void> {
    try {
      await switchChainAsync({ chainId: CHAIN_ID })
    } catch (err: unknown) {
      // Error 4902 = chain desconocida para la wallet → añadirla primero
      const code = (err as { code?: number })?.code
      if (code === 4902 && walletClient) {
        await (walletClient.request as (args: { method: string; params: unknown[] }) => Promise<unknown>)({
          method: 'wallet_addEthereumChain',
          params: [CHAIN_PARAMS],
        })
        await switchChainAsync({ chainId: CHAIN_ID })
      } else {
        throw err
      }
    }
  }

  return {
    isConnected,
    isCorrectChain,
    currentChainName: chain?.name ?? 'red desconocida',
    switchToChain,
    /** @deprecated usar switchToChain */
    switchToFuji: switchToChain,
  }
}
