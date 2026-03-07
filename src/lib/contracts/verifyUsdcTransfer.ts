import { createPublicClient, http } from 'viem'
import { avalancheFuji, avalanche } from 'viem/chains'
import { logger } from '@/lib/logger'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
const chain = CHAIN_ID === 43114 ? avalanche : avalancheFuji
const USDC_ADDRESS = (CHAIN_ID === 43114
  ? '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
  : '0x5425890298aed601595a70AB815c96711a31Bc65').toLowerCase()
const OPERATOR_ADDRESS = (
  process.env.NEXT_PUBLIC_WASIAI_OPERATOR
  ?? process.env.NEXT_PUBLIC_OPERATOR_ADDRESS
  ?? '0x2dd1Bd5D69Fe05205C0eecB9e22Bc8Ec99eE7aaB'
).toLowerCase()
const RPC_URL = CHAIN_ID === 43114
  ? 'https://api.avax.network/ext/bc/C/rpc'
  : 'https://api.avax-test.network/ext/bc/C/rpc'

// ERC-20 Transfer event: keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

/**
 * Verify that a transaction contains a USDC Transfer to the operator
 * with at least the expected amount. Retries up to 15s for unmined txs.
 */
export async function verifyUsdcTransfer(
  txHash: string,
  expectedAmountUsdc: number,
  expectedRecipient?: string,
): Promise<{ verified: boolean; from?: string; error?: string }> {
  const recipientAddress = (expectedRecipient ?? OPERATOR_ADDRESS).toLowerCase()
  logger.info('[verifyUsdcTransfer] start', {
    txHash,
    expectedAmountUsdc,
    recipientAddress,
    USDC_ADDRESS,
    CHAIN_ID,
  })

  try {
    const client = createPublicClient({ chain, transport: http(RPC_URL) })

    // Wait for receipt (tx may not be mined yet)
    let receipt: Awaited<ReturnType<typeof client.getTransactionReceipt>> | undefined
    for (let i = 0; i < 5; i++) {
      try {
        receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` })
        break
      } catch (e) {
        logger.warn('[verifyUsdcTransfer] receipt attempt failed', { attempt: i, err: String(e).slice(0, 100) })
        if (i === 4) return { verified: false, error: 'Transaction not found after 15s' }
        await new Promise(r => setTimeout(r, 3000))
      }
    }

    if (!receipt) {
      return { verified: false, error: 'No receipt returned' }
    }

    if (receipt.status !== 'success') {
      return { verified: false, error: `Transaction status: ${receipt.status}` }
    }

    const expectedAtomic = BigInt(Math.round(expectedAmountUsdc * 1_000_000))

    logger.info('[verifyUsdcTransfer] receipt', {
      status: receipt.status,
      logsCount: receipt.logs.length,
      to: receipt.to,
    })

    // Log all transfer events for debugging
    for (const log of receipt.logs) {
      if (log.topics[0] !== TRANSFER_TOPIC) continue

      const logAddress = log.address.toLowerCase()
      const logTo = log.topics.length >= 3 ? ('0x' + log.topics[2]!.slice(26)).toLowerCase() : 'unknown'
      const logFrom = log.topics.length >= 2 ? ('0x' + log.topics[1]!.slice(26)).toLowerCase() : 'unknown'
      const logValue = log.data !== '0x' ? BigInt(log.data).toString() : '0'

      logger.info('[verifyUsdcTransfer] Transfer event', {
        token: logAddress,
        from: logFrom,
        to: logTo,
        value: logValue,
        matchesUsdc: logAddress === USDC_ADDRESS,
        matchesRecipient: logTo === recipientAddress,
      })

      if (logAddress !== USDC_ADDRESS) continue
      if (log.topics.length < 3) continue
      if (logTo !== recipientAddress) continue

      const value = BigInt(log.data)
      if (value >= expectedAtomic) {
        return { verified: true, from: logFrom }
      } else {
        return { verified: false, error: `Transfer amount ${value} < expected ${expectedAtomic}` }
      }
    }

    return { verified: false, error: `No USDC Transfer to ${recipientAddress} found in ${receipt.logs.length} logs` }
  } catch (err) {
    logger.error('[verifyUsdcTransfer] error', { err: String(err).slice(0, 300) })
    return { verified: false, error: `Verification error: ${String(err).slice(0, 200)}` }
  }
}
