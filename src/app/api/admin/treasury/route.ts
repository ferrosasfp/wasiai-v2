import { NextResponse } from 'next/server'
import { createPublicClient, http } from 'viem'
import { avalanche, avalancheFuji } from 'viem/chains'
import { jsonError } from '@/lib/api/jsonError'


// Chain-agnostic: usa las mismas vars que el resto del sistema
const IS_MAINNET  = process.env.NEXT_PUBLIC_CHAIN_ID === '43114'
const MARKETPLACE = (process.env.MARKETPLACE_CONTRACT_ADDRESS ?? '') as `0x${string}`
const USDC_ADDR   = (IS_MAINNET
  ? '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'   // USDC mainnet Avalanche
  : '0x5425890298aed601595a70AB815c96711a31Bc65'    // USDC Fuji testnet
) as `0x${string}`

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

/**
 * GET /api/admin/treasury
 * Requiere firma EIP-712 admin (NG-C01).
 * Lee estado on-chain del contrato: USDC, key balances, earnings, fee, treasury.
 */
export async function GET() {
  // GET reads public on-chain data — no auth required
  // Mutative operations (POST/PUT/DELETE) require EIP-712 admin signature

  if (!MARKETPLACE) return NextResponse.json({ error: 'Contract not configured' }, { status: 500 })

  const chain  = IS_MAINNET ? avalanche : avalancheFuji
  const rpcUrl = IS_MAINNET
    ? (process.env.NEXT_PUBLIC_RPC_MAINNET ?? 'https://api.avax.network/ext/bc/C/rpc')
    : (process.env.NEXT_PUBLIC_RPC_TESTNET ?? 'https://api.avax-test.network/ext/bc/C/rpc')

  const client = createPublicClient({ chain, transport: http(rpcUrl) })

  try {
    const [contractUsdc, totalKeyBal, totalEarnings, feeBps, treasuryAddr] = await Promise.all([
      client.readContract({ address: USDC_ADDR,   abi: ERC20_ABI,       functionName: 'balanceOf',       args: [MARKETPLACE] }),
      client.readContract({ address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: 'totalKeyBalances' }),
      client.readContract({ address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: 'totalEarnings'    }),
      client.readContract({ address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: 'platformFeeBps'   }),
      client.readContract({ address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: 'treasury'         }),
    ])

    const treasuryBal = await client.readContract({
      address: USDC_ADDR,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [treasuryAddr as `0x${string}`],
    })

    return NextResponse.json({
      total_usdc:             Number(contractUsdc)  / 1e6,
      key_balances_usdc:      Number(totalKeyBal)   / 1e6,
      settled_earnings_usdc:  Number(totalEarnings) / 1e6,
      platform_fee_bps:       Number(feeBps),
      treasury_address:       treasuryAddr,
      treasury_balance_usdc:  Number(treasuryBal)   / 1e6,
      chain:                  IS_MAINNET ? 'mainnet' : 'fuji',
    })
  } catch (err) {
    return jsonError('read_failed', 'Contract read failed', 500, { logDetail: err })
  }
}
