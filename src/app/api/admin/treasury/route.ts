import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createPublicClient, http } from 'viem'
import { avalancheFuji } from 'viem/chains'

const MARKETPLACE = (process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI ?? '') as `0x${string}`
const USDC_FUJI   = '0x5425890298aed601595a70AB815c96711a31Bc65' as `0x${string}`

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function' as const, stateMutability: 'view' as const, inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'uint256' }] },
]
const MARKETPLACE_ABI = [
  { name: 'totalKeyBalances', type: 'function' as const, stateMutability: 'view' as const, inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'totalEarnings',    type: 'function' as const, stateMutability: 'view' as const, inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'platformFeeBps',   type: 'function' as const, stateMutability: 'view' as const, inputs: [], outputs: [{ type: 'uint16'  }] },
  { name: 'treasury',         type: 'function' as const, stateMutability: 'view' as const, inputs: [], outputs: [{ type: 'address' }] },
  { name: 'earnings',         type: 'function' as const, stateMutability: 'view' as const, inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'uint256' }] },
]

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })


  if (!MARKETPLACE) return NextResponse.json({ error: 'Contract not configured' }, { status: 500 })

  const rpcUrl = process.env.FUJI_RPC_URL ?? 'https://api.avax-test.network/ext/bc/C/rpc'
  const client = createPublicClient({ chain: avalancheFuji, transport: http(rpcUrl) })

  const [contractUsdc, totalKeyBal, totalEarnings, feeBps, treasuryAddr] = await Promise.all([
    client.readContract({ address: USDC_FUJI,   abi: ERC20_ABI,      functionName: 'balanceOf',      args: [MARKETPLACE] }),
    client.readContract({ address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: 'totalKeyBalances' }),
    client.readContract({ address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: 'totalEarnings'    }),
    client.readContract({ address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: 'platformFeeBps'   }),
    client.readContract({ address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: 'treasury'         }),
  ])

  const treasuryBal = await client.readContract({ address: USDC_FUJI, abi: ERC20_ABI, functionName: 'balanceOf', args: [treasuryAddr as `0x${string}`] })

  return NextResponse.json({
    total_usdc:             Number(contractUsdc)    / 1e6,
    key_balances_usdc:      Number(totalKeyBal)     / 1e6,
    settled_earnings_usdc:  Number(totalEarnings)   / 1e6,
    platform_fee_bps:       Number(feeBps),
    treasury_address:       treasuryAddr,
    treasury_balance_usdc:  Number(treasuryBal)     / 1e6,
  })
}
