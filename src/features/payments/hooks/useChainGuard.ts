'use client'

import { useWalletClient, useSwitchChain } from 'wagmi'
import { useWallet } from '@/features/wallet/hooks/useWallet'
import { FUJI_CHAIN_ID, FUJI_CHAIN_PARAMS } from '@/shared/lib/web3/fuji'

export function useChainGuard() {
  const { isConnected, chain, isThirdweb } = useWallet()
  const isReconnecting = false // unified hook handles reconnection internally
  const { data: walletClient } = useWalletClient()
  const { switchChainAsync } = useSwitchChain()

  // thirdweb embedded wallets are chain-agnostic: transactions specify chain
  // at send-time, so we always treat them as "correct chain".
  const chainSettled = isConnected && !isReconnecting && chain !== undefined
  const isCorrectChain = isThirdweb
    ? true
    : chainSettled
      ? chain.id === FUJI_CHAIN_ID
      : true

  /** CRÍTICO: esta función SOLO debe llamarse desde un onClick del usuario.
   *  NUNCA llamarla desde un useEffect — los browsers bloquean el popup de wallet.
   *  Para thirdweb wallets es un no-op (chain is set at tx time). */
  async function switchToFuji(): Promise<void> {
    if (isThirdweb) return // thirdweb handles chain at tx time

    try {
      await switchChainAsync({ chainId: FUJI_CHAIN_ID })
    } catch (err: unknown) {
      // Error 4902 = chain desconocida para la wallet → añadirla primero
      const code = (err as { code?: number })?.code
      if (code === 4902 && walletClient) {
        // wallet_addEthereumChain requires a raw request cast
        await (walletClient.request as (args: { method: string; params: unknown[] }) => Promise<unknown>)({
          method: 'wallet_addEthereumChain',
          params: [FUJI_CHAIN_PARAMS],
        })
        // Reintentar switch después de añadir
        await switchChainAsync({ chainId: FUJI_CHAIN_ID })
      } else {
        throw err
      }
    }
  }

  return {
    isConnected,
    isCorrectChain,
    currentChainName: chain?.name ?? 'red desconocida',
    switchToFuji,
  }
}
