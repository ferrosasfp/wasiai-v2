/**
 * Server-side USDC settlement via operator wallet.
 * The operator (facilitator) pays gas — the user never pays gas.
 * x402 compliant: user signs off-chain, facilitator settles on-chain.
 */
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { avalancheFuji, avalanche } from 'viem/chains'
import { logger } from '@/lib/logger'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
const chain = CHAIN_ID === 43114 ? avalanche : avalancheFuji
const RPC_URL = CHAIN_ID === 43114
  ? 'https://api.avax.network/ext/bc/C/rpc'
  : 'https://api.avax-test.network/ext/bc/C/rpc'

const USDC_ADDRESS = (CHAIN_ID === 43114
  ? '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6'
  : '0x5425890298aed601595a70AB815c96711a31Bc65') as `0x${string}`

const OPERATOR_PRIVATE_KEY = process.env.OPERATOR_PRIVATE_KEY

const usdcAbi = parseAbi([
  'function transferFrom(address from, address to, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
])

/**
 * Execute USDC transferFrom on-chain using operator wallet.
 * Operator pays gas. User must have approved operator beforehand.
 */
export async function settleViaOperator(
  fromAddress: string,
  amountUsdc: number
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  if (!OPERATOR_PRIVATE_KEY) {
    return { success: false, error: 'OPERATOR_PRIVATE_KEY not configured' }
  }

  try {
    const account = privateKeyToAccount(`0x${OPERATOR_PRIVATE_KEY.replace(/^0x/, '')}`)
    const publicClient = createPublicClient({ chain, transport: http(RPC_URL) })
    const walletClient = createWalletClient({ account, chain, transport: http(RPC_URL) })

    const amountAtomic = BigInt(Math.round(amountUsdc * 1_000_000))

    // Check allowance first
    const allowance = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: usdcAbi,
      functionName: 'allowance',
      args: [fromAddress as `0x${string}`, account.address],
    })

    if (allowance < amountAtomic) {
      return {
        success: false,
        error: `Insufficient allowance: ${allowance} < ${amountAtomic}. User must approve operator first.`,
      }
    }

    // Execute transferFrom — operator pays gas
    const txHash = await walletClient.writeContract({
      address: USDC_ADDRESS,
      abi: usdcAbi,
      functionName: 'transferFrom',
      args: [fromAddress as `0x${string}`, account.address, amountAtomic],
    })

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })

    if (receipt.status !== 'success') {
      return { success: false, txHash, error: 'Transaction reverted' }
    }

    logger.info('[operatorSettler] settlement success', {
      from: fromAddress,
      amount: amountUsdc,
      txHash,
    })

    return { success: true, txHash }
  } catch (err) {
    logger.error('[operatorSettler] settlement failed', { err: String(err).slice(0, 300) })
    return { success: false, error: `Settlement error: ${String(err).slice(0, 200)}` }
  }
}
