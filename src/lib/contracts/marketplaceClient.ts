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

// HAL-024: Singleton — evita crear N conexiones RPC en el cron
let _operatorClientInstance: ReturnType<typeof _createOperatorClient> | null = null

function _createOperatorClient() {
  const pkRaw = process.env.OPERATOR_PRIVATE_KEY
  if (!pkRaw) throw new Error('OPERATOR_PRIVATE_KEY not set')
  const pkHex = pkRaw.trim().replace(/^0x/i, '')
  const account = privateKeyToAccount(`0x${pkHex}` as `0x${string}`)
  const chain   = getChain()

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

function getOperatorClient() {
  if (!_operatorClientInstance) {
    _operatorClientInstance = _createOperatorClient()
  }
  return _operatorClientInstance
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
  paymentId,  // bytes32 idempotency key — keccak256(txHash + slug)
}: {
  slug:         string
  payerAddress: string
  amountUSDC:   number
  paymentId:    `0x${string}`
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
      args:         [slug, payerAddress as Address, toUSDCAtomics(amountUSDC), paymentId],
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
 * WAS-161: Sync agent price/status on-chain after edit.
 * Called by operator (fire-and-forget) when creator edits an on-chain agent.
 */
export async function updateAgentOnChain({
  slug,
  pricePerCallUSDC,
}: {
  slug: string
  pricePerCallUSDC: number
}): Promise<string | null> {
  const contractAddress = getContractAddress()
  if (!contractAddress) {
    logger.warn('[marketplace] Contract not configured — skipping updateAgent')
    return null
  }

  try {
    const { wallet, public: pub, account } = getOperatorClient()

    const { request } = await pub.simulateContract({
      address: contractAddress,
      abi: WASIAI_MARKETPLACE_ABI,
      functionName: 'updateAgent',
      args: [slug, toUSDCAtomics(pricePerCallUSDC)],
      account,
    })

    const txHash = await wallet.writeContract(request)
    logger.info('[marketplace] updateAgent tx', { txHash, slug })
    return txHash
  } catch (err) {
    logger.error('[marketplace] updateAgent failed', { err: String(err).slice(0, 300) })
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
    // HAL-025: receipt.status 'reverted' = on-chain failure — return null so caller won't update DB
    if (receipt.status !== 'success') {
      logger.error('[marketplace] withdrawFor reverted on-chain', { creatorWallet, txHash })
      return null
    }
    return txHash
  } catch (err) {
    logger.error('[marketplace] withdrawFor failed', { err: String(err).slice(0, 300) })
    return null
  }
}

// ── Pre-funded API Key Functions ───────────────────────────────────────────
// Contract v2 deployed 2026-02-25 — includes USDC pre-funded key support

/**
 * Convert a DB key_hash hex string to a bytes32 for on-chain use.
 * key_hash is the SHA-256 hex of the raw key (64 hex chars = 32 bytes).
 * We left-pad to 32 bytes if shorter, or take first 32 bytes if longer.
 */
export function keyHashToBytes32(keyHash: string): `0x${string}` {
  // Normalize: strip 0x prefix if present, then pad/truncate to 64 hex chars (32 bytes)
  const hex = keyHash.replace(/^0x/i, '').toLowerCase()
  const padded = hex.padEnd(64, '0').slice(0, 64)
  return `0x${padded}`
}

/**
 * Settle a batch of key-based agent calls on-chain in a single tx.
 * Gas amortizado: una tx cubre cientos de llamadas.
 * Non-fatal: logs error and returns null on failure — caller must not block response.
 *
 * @param keyHash     SHA-256 hex string from agent_keys.key_hash
 * @param slugs       Array of agent slugs (1-to-1 with amountsUsdc)
 * @param amountsUsdc Array of amounts in USDC dollars (e.g. [0.02, 0.01])
 */
export async function settleKeyBatchOnChain(
  keyHash: string,
  slugs: string[],
  amountsUsdc: number[]
): Promise<string | null> {
  const contractAddress = getContractAddress()
  if (!contractAddress) {
    logger.warn('[marketplace] Contract not configured — skipping settleKeyBatch')
    return null
  }

  try {
    const { wallet, public: pub, account } = getOperatorClient()
    const bytes32KeyId  = keyHashToBytes32(keyHash)
    const atomicAmounts = amountsUsdc.map(a => toUSDCAtomics(a))

    const { request } = await pub.simulateContract({
      address:      contractAddress,
      abi:          WASIAI_MARKETPLACE_ABI,
      functionName: 'settleKeyBatch',
      args:         [bytes32KeyId, slugs, atomicAmounts],
      account,
    })

    const txHash = await wallet.writeContract(request)
    logger.info('[marketplace] settleKeyBatch tx', { txHash, keyHash: keyHash.slice(0, 8), batchSize: slugs.length })
    return txHash
  } catch (err) {
    logger.error('[marketplace] settleKeyBatch failed', { err: String(err).slice(0, 300) })
    return null
  }
}

/**
 * Move remaining key balance to earnings of the key owner.
 * Called when the user closes their key (refund flow).
 * The owner can then call withdraw() like any creator.
 */
export async function refundKeyToEarningsOnChain(keyHash: string): Promise<string | null> {
  const contractAddress = getContractAddress()
  if (!contractAddress) {
    logger.warn('[marketplace] Contract not configured — skipping refundKeyToEarnings')
    return null
  }

  try {
    const { wallet, public: pub, account } = getOperatorClient()
    const bytes32KeyId = keyHashToBytes32(keyHash)

    const { request } = await pub.simulateContract({
      address:      contractAddress,
      abi:          WASIAI_MARKETPLACE_ABI,
      functionName: 'refundKeyToEarnings',
      args:         [bytes32KeyId],
      account,
    })

    const txHash = await wallet.writeContract(request)
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash as `0x${string}`, timeout: 30_000 })
    logger.info('[marketplace] refundKeyToEarnings tx', { txHash, status: receipt.status })
    // HAL-025: check on-chain status before returning
    if (receipt.status !== 'success') {
      logger.error('[marketplace] refundKeyToEarnings reverted on-chain', { txHash })
      return null
    }
    return txHash
  } catch (err) {
    logger.error('[marketplace] refundKeyToEarnings failed', { err: String(err).slice(0, 300) })
    return null
  }
}

/**
 * Deposit USDC into the contract for a given API key via ERC-3009.
 * Called by the deposit API after user provides EIP-712 signature.
 *
 * @param params.keyId       SHA-256 hex string from agent_keys.key_hash
 * @param params.ownerAddress User's wallet address (signed the ERC-3009 auth)
 * @param params.amount      Amount in USDC dollars (e.g. 10.0)
 * @param params.validAfter  Unix timestamp: not valid before
 * @param params.validBefore Unix timestamp: not valid after
 * @param params.nonce       Random bytes32 (hex string, 0x-prefixed)
 * @param params.v           EIP-712 signature v
 * @param params.r           EIP-712 signature r (hex string)
 * @param params.s           EIP-712 signature s (hex string)
 */
export async function depositForKeyOnChain(params: {
  keyId:        string
  ownerAddress: string
  amount:       number
  validAfter:   number
  validBefore:  number
  nonce:        string
  v:            number
  r:            string
  s:            string
}): Promise<string | null> {
  const contractAddress = getContractAddress()
  if (!contractAddress) {
    logger.warn('[marketplace] Contract not configured — skipping depositForKey')
    return null
  }

  try {
    const { wallet, public: pub, account } = getOperatorClient()
    const bytes32KeyId = keyHashToBytes32(params.keyId)
    const atomicAmount = toUSDCAtomics(params.amount)

    const { request } = await pub.simulateContract({
      address:      contractAddress,
      abi:          WASIAI_MARKETPLACE_ABI,
      functionName: 'depositForKey',
      args:         [
        bytes32KeyId,
        params.ownerAddress as `0x${string}`,
        atomicAmount,
        BigInt(params.validAfter),
        BigInt(params.validBefore),
        params.nonce as `0x${string}`,
        params.v,
        params.r as `0x${string}`,
        params.s as `0x${string}`,
      ],
      account,
    })

    const txHash = await wallet.writeContract(request)
    logger.info('[marketplace] depositForKey tx submitted', { txHash, keyId: params.keyId.slice(0, 8) })

    // HAL-025: wait for confirmation before returning — DB must only update after on-chain success
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash, confirmations: 1 })
    if (receipt.status !== 'success') {
      logger.error('[marketplace] depositForKey reverted on-chain', { txHash })
      return null
    }

    logger.info('[marketplace] depositForKey confirmed', { txHash, keyId: params.keyId.slice(0, 8) })
    return txHash
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('[marketplace] depositForKey failed', {
      message: msg.slice(0, 500),
      cause:   (err as { cause?: unknown })?.cause ? String((err as { cause?: unknown }).cause).slice(0, 300) : undefined,
    })
    return null
  }
}

/**
 * Get on-chain USDC balance for an API key.
 *
 * @param keyId SHA-256 hex string from agent_keys.key_hash
 * @returns Balance in USDC dollars (e.g. 9.98), or 0 on error
 */
export async function getKeyBalanceOnChain(keyId: string): Promise<number> {
  const contractAddress = getContractAddress()
  if (!contractAddress) {
    logger.warn('[marketplace] getKeyBalance: contract not configured')
    return 0
  }

  try {
    const { public: pub } = getOperatorClient()
    const bytes32KeyId = keyHashToBytes32(keyId)

    const atomics = await pub.readContract({
      address:      contractAddress,
      abi:          WASIAI_MARKETPLACE_ABI,
      functionName: 'getKeyBalance',
      args:         [bytes32KeyId],
    }) as bigint

    return Number(atomics) / 1_000_000
  } catch (err) {
    logger.error('[marketplace] getKeyBalance failed', { err: String(err).slice(0, 200) })
    return 0
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

    return result
  } catch (err) {
    logger.error('[marketplace] getPendingEarnings failed', { err: String(err).slice(0, 200) })
    return 0
  }
}

/**
 * Read the on-chain owner address for a key.
 * Returns null if contract not configured or key not registered.
 */
export async function getKeyOwnerOnChain(keyHash: string): Promise<string | null> {
  const contractAddress = getContractAddress()
  if (!contractAddress) {
    logger.warn('[marketplace] getKeyOwner: contract not configured')
    return null
  }

  try {
    const { public: pub } = getOperatorClient()
    const bytes32KeyId = keyHashToBytes32(keyHash)

    const owner = await pub.readContract({
      address:      contractAddress,
      abi:          WASIAI_MARKETPLACE_ABI,
      functionName: 'keyOwners',
      args:         [bytes32KeyId],
    }) as string

    if (!owner || owner === '0x0000000000000000000000000000000000000000') return null
    return owner
  } catch (err) {
    logger.error('[marketplace] getKeyOwner failed', { err: String(err).slice(0, 200) })
    return null
  }
}
