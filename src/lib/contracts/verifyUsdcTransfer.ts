import { createPublicClient, http } from 'viem'
import { avalancheFuji, avalanche } from 'viem/chains'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
const chain = CHAIN_ID === 43114 ? avalanche : avalancheFuji
const USDC_ADDRESS = (CHAIN_ID === 43114
  ? '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
  : '0x5425890298aed601595a70AB815c96711a31Bc65').toLowerCase()
const OPERATOR_ADDRESS = (process.env.MARKETPLACE_CONTRACT_ADDRESS ?? '').toLowerCase()
const RPC_URL = CHAIN_ID === 43114
  ? 'https://api.avax.network/ext/bc/C/rpc'
  : 'https://api.avax-test.network/ext/bc/C/rpc'

/**
 * Verify that a transaction contains a USDC Transfer to the operator
 * with at least the expected amount. Retries up to 15s for unmined txs.
 */
export async function verifyUsdcTransfer(
  txHash: string,
  expectedAmountUsdc: number
): Promise<{ verified: boolean; from?: string; error?: string }> {
  try {
    const client = createPublicClient({ chain, transport: http(RPC_URL) })

    // Wait for receipt (tx may not be mined yet)
    let receipt: Awaited<ReturnType<typeof client.getTransactionReceipt>> | undefined
    for (let i = 0; i < 5; i++) {
      try {
        receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` })
        break
      } catch {
        if (i === 4) return { verified: false, error: 'Transaction not found after 15s' }
        await new Promise(r => setTimeout(r, 3000))
      }
    }

    if (!receipt || receipt.status !== 'success') {
      return { verified: false, error: 'Transaction reverted' }
    }

    const expectedAtomic = BigInt(Math.round(expectedAmountUsdc * 1_000_000))

    // ERC-20 Transfer event: keccak256("Transfer(address,address,uint256)")
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== USDC_ADDRESS) continue
      if (log.topics[0] !== TRANSFER_TOPIC) continue
      if (log.topics.length < 3) continue

      const to = ('0x' + log.topics[2]!.slice(26)).toLowerCase()
      if (to !== OPERATOR_ADDRESS) continue

      const value = BigInt(log.data)
      if (value >= expectedAtomic) {
        const from = '0x' + log.topics[1]!.slice(26)
        return { verified: true, from }
      }
    }

    return { verified: false, error: 'No matching USDC transfer to operator found' }
  } catch (err) {
    return { verified: false, error: `Verification error: ${String(err).slice(0, 200)}` }
  }
}
