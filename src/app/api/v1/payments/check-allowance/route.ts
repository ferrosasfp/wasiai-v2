import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, http, parseAbi } from 'viem'
import { avalancheFuji, avalanche } from 'viem/chains'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
const chain = CHAIN_ID === 43114 ? avalanche : avalancheFuji
const RPC_URL = CHAIN_ID === 43114
  ? 'https://api.avax.network/ext/bc/C/rpc'
  : 'https://api.avax-test.network/ext/bc/C/rpc'
const USDC_ADDRESS = (CHAIN_ID === 43114
  ? '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
  : '0x5425890298aed601595a70AB815c96711a31Bc65') as `0x${string}`
const OPERATOR_ADDRESS = (
  process.env.NEXT_PUBLIC_WASIAI_OPERATOR
  ?? '0xf432baf1315ccDB23E683B95b03fD54Dd3e447Ba'
) as `0x${string}`

const usdcAbi = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
])

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get('address')
  const amount = request.nextUrl.searchParams.get('amount')

  if (!address || !amount) {
    return NextResponse.json({ error: 'Missing address or amount' }, { status: 400 })
  }

  const client = createPublicClient({ chain, transport: http(RPC_URL) })

  const allowance = await client.readContract({
    address: USDC_ADDRESS,
    abi: usdcAbi,
    functionName: 'allowance',
    args: [address as `0x${string}`, OPERATOR_ADDRESS],
  })

  return NextResponse.json({
    approved: allowance >= BigInt(amount),
    allowance: allowance.toString(),
  })
}
