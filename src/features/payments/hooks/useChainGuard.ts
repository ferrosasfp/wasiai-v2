import { useAccount, useWalletClient, useSwitchChain } from 'wagmi'
import { FUJI_CHAIN_ID, FUJI_CHAIN_PARAMS } from '@/shared/lib/web3/fuji'

export function useChainGuard() {
  const { isConnected, isReconnecting, chain } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { switchChainAsync } = useSwitchChain()

  // Esperar a que wagmi estabilice el chain antes de evaluar red incorrecta.
  // isReconnecting=true o chain=undefined justo después de conectar → no es wrong_network todavía.
  const chainSettled = isConnected && !isReconnecting && chain !== undefined
  const isCorrectChain = chainSettled ? chain.id === FUJI_CHAIN_ID : true

  /** CRÍTICO: esta función SOLO debe llamarse desde un onClick del usuario.
   *  NUNCA llamarla desde un useEffect — los browsers bloquean el popup de wallet. */
  async function switchToFuji(): Promise<void> {
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
