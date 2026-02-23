/**
 * Server-side client for WasiAIMarketplace.sol
 *
 * Used by:
 *  - /api/v1/agents/[slug]/invoke → calls recordInvocation() after payment
 *  - /api/models (POST)           → calls registerAgent() when agent is published
 *
 * Requires env vars:
 *  OPERATOR_PRIVATE_KEY              → backend wallet private key (operator role)
 *  MARKETPLACE_CONTRACT_ADDRESS      → deployed contract address
 *  NEXT_PUBLIC_RPC_MAINNET           → Avalanche RPC
 */

import { createWalletClient, createPublicClient, http, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { avalanche, avalancheFuji } from 'viem/chains'
import { WASIAI_MARKETPLACE_ABI, toUSDCAtomics } from './WasiAIMarketplace'
import { logger } from '@/lib/logger'

function getChain() {
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
  return chainId === 43114 ? avalanche : avalancheFuji
}

function getOperatorClient() {
  const pkRaw = process.env.OPERATOR_PRIVATE_KEY
  if (!pkRaw) throw new Error('OPERATOR_PRIVATE_KEY not set')
  const pkHex = pkRaw.trim().replace(/^0x/i, '')
  const account = privateKeyToAccount(`0x${pkHex}` as `0x${string}`)
  const chain   = getChain()

  // Trim to prevent whitespace bugs (Vercel env vars can have trailing \n)
  const rpcUrl = (chain.id === 43114
    ? process.env.NEXT_PUBLIC_RPC_MAINNET
    : process.env.NEXT_PUBLIC_RPC_TESTNET
  )?.trim() || undefined

  return {
    wallet: createWalletClient({ account, chain, transport: http(rpcUrl) }),
    public: createPublicClient({ chain, transport: http(rpcUrl) }),
    account,
  }
}

function getContractAddress(): Address {
  const addr = process.env.MARKETPLACE_CONTRACT_ADDRESS
  if (!addr || addr === '0x0000000000000000000000000000000000000000') {
    return null as unknown as Address // contract not deployed yet
  }
  return addr as Address
}

/**
 * Record an invocation on-chain after x402 payment is confirmed.
 * Returns the tx hash, or null if contract is not configured.
 */
export async function recordInvocationOnChain({
  slug,
  payerAddress,
  amountUSDC, // in dollars, e.g. 0.02
}: {
  slug:         string
  payerAddress: string
  amountUSDC:   number
}): Promise<string | null> {
  const contractAddress = getContractAddress()
  if (!contractAddress) {
    logger.warn('[marketplace] Contract not configured — skipping recordInvocation')
    return null
  }

  try {
    const { wallet, public: pub, account } = getOperatorClient()

    const { request } = await pub.simulateContract({
      address:      contractAddress,
      abi:          WASIAI_MARKETPLACE_ABI,
      functionName: 'recordInvocation',
      args:         [slug, payerAddress as Address, toUSDCAtomics(amountUSDC)],
      account,
    })

    const txHash = await wallet.writeContract(request)
    logger.info('[marketplace] recordInvocation tx', { txHash })
    return txHash
  } catch (err) {
    // Non-fatal: DB already recorded the payment. Log and continue.
    logger.error('[marketplace] recordInvocation failed', { err })
    return null
  }
}

/**
 * Register a new agent on-chain when it's published.
 * Returns the tx hash, or null if contract is not configured.
 */
export async function registerAgentOnChain({
  slug,
  pricePerCallUSDC,
  creatorWallet,
  erc8004Id = 0,
}: {
  slug:             string
  pricePerCallUSDC: number
  creatorWallet:    string
  erc8004Id?:       number
}): Promise<string | null> {
  const contractAddress = getContractAddress()
  if (!contractAddress) {
    logger.warn('[marketplace] Contract not configured — skipping registerAgent')
    return null
  }

  if (!creatorWallet || creatorWallet === '0x0000000000000000000000000000000000000000') {
    logger.warn('[marketplace] No creator wallet — skipping registerAgent')
    return null
  }

  try {
    const { wallet, public: pub, account } = getOperatorClient()

    const { request } = await pub.simulateContract({
      address:      contractAddress,
      abi:          WASIAI_MARKETPLACE_ABI,
      functionName: 'registerAgent',
      args:         [
        slug,
        toUSDCAtomics(pricePerCallUSDC),
        creatorWallet as Address,
        BigInt(erc8004Id),
      ],
      account,
    })

    const txHash = await wallet.writeContract(request)
    logger.info('[marketplace] registerAgent tx', { txHash })
    return txHash
  } catch (err) {
    logger.error('[marketplace] registerAgent failed', { err })
    return null
  }
}

/**
 * Operator-triggered withdrawal on behalf of a creator.
 * Returns tx hash or null if contract not configured / no earnings.
 */
export async function withdrawForCreator(creatorWallet: string): Promise<string | null> {
  const contractAddress = getContractAddress()
  if (!contractAddress) {
    logger.error('[marketplace] withdrawFor: MARKETPLACE_CONTRACT_ADDRESS not set')
    return null
  }

  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
  const rpc     = chainId === 43114 ? process.env.NEXT_PUBLIC_RPC_MAINNET : process.env.NEXT_PUBLIC_RPC_TESTNET
  logger.info('[marketplace] withdrawFor initiated', { chainId, rpc: rpc ?? 'chain-default', contractAddress })

  try {
    const { wallet, public: pub, account } = getOperatorClient()

    const { request } = await pub.simulateContract({
      address:      contractAddress,
      abi:          WASIAI_MARKETPLACE_ABI,
      functionName: 'withdrawFor',
      args:         [creatorWallet as Address],
      account,
    })

    const txHash = await wallet.writeContract(request)
    logger.info('[marketplace] withdrawFor tx', { creatorWallet, txHash })
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash as `0x${string}`, timeout: 30_000 })
    logger.info('[marketplace] withdrawFor confirmed', { status: receipt.status })
    return txHash
  } catch (err) {
    logger.error('[marketplace] withdrawFor failed', { err: String(err).slice(0, 300) })
    return null
  }
}

/**
 * Read pending earnings for a creator wallet.
 */
export async function getPendingEarnings(creatorWallet: string): Promise<number> {
  const contractAddress = getContractAddress()
  if (!contractAddress) {
    logger.warn('[marketplace] getPendingEarnings: contract not configured')
    return 0
  }

  try {
    const { public: pub } = getOperatorClient()
    const atomics = await pub.readContract({
      address:      contractAddress,
      abi:          WASIAI_MARKETPLACE_ABI,
      functionName: 'getPendingEarnings',
      args:         [creatorWallet as Address],
    }) as bigint
    const result = Number(atomics) / 1_000_000
    logger.debug('[marketplace] getPendingEarnings', { wallet: `${creatorWallet.slice(0,8)}...`, result })
    return result
  } catch (err) {
    logger.error('[marketplace] getPendingEarnings failed', { err: String(err).slice(0, 200) })
    return 0
  }
}
