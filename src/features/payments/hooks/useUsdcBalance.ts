import { useReadContract } from 'wagmi'
import { useWallet } from '@/features/wallet/hooks/useWallet'
import { USDC_FUJI_ADDRESS, FUJI_CHAIN_ID } from '@/shared/lib/web3/fuji'

const ERC20_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export function useUsdcBalance(priceUsdc: number) {
  const { address } = useWallet()

  const { data, isLoading } = useReadContract({
    address: USDC_FUJI_ADDRESS,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: FUJI_CHAIN_ID,
    query: {
      enabled: !!address,
      staleTime: 30_000,  // máx 30s de cache — no confiar en dato viejo
    },
  })

  const usdcBalance = data !== undefined ? Number(data as bigint) / 1e6 : undefined
  const hasEnoughBalance = usdcBalance !== undefined && usdcBalance >= priceUsdc

  return { usdcBalance, hasEnoughBalance, isLoading }
}
