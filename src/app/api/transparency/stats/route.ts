import { NextResponse } from 'next/server'
import { createPublicClient, http } from 'viem'
import { avalanche, avalancheFuji } from 'viem/chains'
import { WASIAI_MARKETPLACE_ABI, fromUSDCAtomics } from '@/lib/contracts/WasiAIMarketplace'
import { getContractAddress } from '@/lib/contracts/config'

export const revalidate = 60

export async function GET() {
  try {
    const contractAddress = getContractAddress()
    const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
    const chain = chainId === 43114 ? avalanche : avalancheFuji

    const client = createPublicClient({ chain, transport: http() })

    const result = await client.readContract({
      address: contractAddress,
      abi: WASIAI_MARKETPLACE_ABI,
      functionName: 'getStats',
    })

    const [totalVolume, totalInvocations, feeBps] = result as [bigint, bigint, number]

    return NextResponse.json({
      volume: fromUSDCAtomics(totalVolume),
      invocations: Number(totalInvocations),
      feePercent: Number(feeBps) / 100,
    })
  } catch {
    return NextResponse.json({ volume: null, invocations: null, feePercent: null })
  }
}
