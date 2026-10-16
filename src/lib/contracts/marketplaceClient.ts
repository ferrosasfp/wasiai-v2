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
 *
 * Holds OPERATOR_PRIVATE_KEY — server-only so a client import fails at build time.
 */

import 'server-only'
import { createWalletClient, createPublicClient, http, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { avalanche, avalancheFuji } from 'viem/chains'
import { WASIAI_MARKETPLACE_ABI, toUSDCAtomics } from './WasiAIMarketplace'
import { getMarketplaceAddresses } from './config'
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
 * WKH-126 (AC-1): the optional LEGACY (old, non-upgradeable) marketplace address
 * for the active chain. Resolved via the central config resolver so there is a
 * single source of truth. Returns `null` when the legacy env is unset — in which
 * case every legacy-aware reader short-circuits and behaves exactly as the
 * single-address path did before (AC-7 / CD-1).
 *
 * NOTE: legacy is READ-ONLY / withdraw-only. It is NEVER used as a write target
 * — all writes (deposit/settle/register/...) keep using getContractAddress()
 * (the PRIMARY contract).
 */
function getLegacyContractAddress(): Address | null {
  return getMarketplaceAddresses().legacy ?? null
}

/**
 * WKH-126: read a key's on-chain USDC balance from an arbitrary marketplace
 * address (PRIMARY or LEGACY). Internal helper used by getKeyBalanceOnChain and
 * the dual-read breakdown. Returns dollars; throws on RPC error (callers wrap).
 */
async function readKeyBalanceAt(contractAddress: Address, keyId: string): Promise<number> {
  const { public: pub } = getOperatorClient()
  const bytes32KeyId = keyHashToBytes32(keyId)
  const atomics = await pub.readContract({
    address:      contractAddress,
    abi:          WASIAI_MARKETPLACE_ABI,
    functionName: 'getKeyBalance',
    args:         [bytes32KeyId],
  }) as bigint
  return Number(atomics) / 1_000_000
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
    logger.info('[marketplace] settleKeyBatch tx submitted', { txHash, keyHash: keyHash.slice(0, 8), batchSize: slugs.length })

    // HAL-025: wait for confirmation — caller must not mark settled_at if tx reverts on-chain
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash as `0x${string}`, timeout: 30_000 })
    if (receipt.status !== 'success') {
      logger.error('[marketplace] settleKeyBatch reverted on-chain', { txHash, keyHash: keyHash.slice(0, 8) })
      return null
    }

    logger.info('[marketplace] settleKeyBatch confirmed', { txHash, keyHash: keyHash.slice(0, 8), batchSize: slugs.length })
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
export async function getKeyBalanceOnChain(
  keyId: string,
  opts: { includeLegacy?: boolean } = {},
): Promise<number> {
  const contractAddress = getContractAddress()
  if (!contractAddress) {
    logger.warn('[marketplace] getKeyBalance: contract not configured')
    return 0
  }

  // PRIMARY read — unchanged path. On error → 0 (backward-compat).
  let primaryBalance = 0
  try {
    primaryBalance = await readKeyBalanceAt(contractAddress, keyId)
  } catch (err) {
    logger.error('[marketplace] getKeyBalance failed', { err: String(err).slice(0, 200) })
    primaryBalance = 0
  }

  // WKH-126 (AC-2): opt-in legacy aggregation. When includeLegacy is falsy OR
  // the legacy env is unset, this is a no-op and the return value is byte-
  // identical to the historical single-address behavior (AC-7 / CD-1).
  if (!opts.includeLegacy) return primaryBalance
  const legacyAddress = getLegacyContractAddress()
  if (!legacyAddress) return primaryBalance

  let legacyBalance = 0
  try {
    legacyBalance = await readKeyBalanceAt(legacyAddress, keyId)
  } catch (err) {
    logger.error('[marketplace] getKeyBalance(legacy) failed', { err: String(err).slice(0, 200) })
    legacyBalance = 0
  }
  return primaryBalance + legacyBalance
}

/**
 * WKH-126 (AC-2): read a key's balance on PRIMARY and LEGACY separately so the
 * UI can show them as distinct line items (and prompt migration of the legacy
 * portion). When the legacy env is unset, `legacy` is `null` and `total ===
 * primary` — equivalent to today.
 *
 * Each leg fails soft to 0 (RPC error never throws here); the caller treats 0 as
 * "nothing to migrate", which is the safe default.
 */
export async function getKeyBalanceBreakdownOnChain(
  keyId: string,
): Promise<{ primary: number; legacy: number | null; total: number }> {
  const contractAddress = getContractAddress()
  if (!contractAddress) {
    logger.warn('[marketplace] getKeyBalanceBreakdown: contract not configured')
    return { primary: 0, legacy: null, total: 0 }
  }

  let primary = 0
  try {
    primary = await readKeyBalanceAt(contractAddress, keyId)
  } catch (err) {
    logger.error('[marketplace] getKeyBalanceBreakdown(primary) failed', { err: String(err).slice(0, 200) })
    primary = 0
  }

  const legacyAddress = getLegacyContractAddress()
  if (!legacyAddress) return { primary, legacy: null, total: primary }

  let legacy = 0
  try {
    legacy = await readKeyBalanceAt(legacyAddress, keyId)
  } catch (err) {
    logger.error('[marketplace] getKeyBalanceBreakdown(legacy) failed', { err: String(err).slice(0, 200) })
    legacy = 0
  }
  return { primary, legacy, total: primary + legacy }
}

/**
 * WKH-126 (AC-3): assisted "migrate balance" backend orchestrator.
 *
 * Moves a key's funds from the LEGACY contract to the PRIMARY contract:
 *   1. withdrawKey(legacy)   — USER-SIGNED in their wallet (CD-2 non-custodial:
 *      the operator can NOT move a user's legacy funds; only the owner can call
 *      withdrawKey). The caller passes the confirmed `withdrawTxHash` once the
 *      user has signed/broadcast it.
 *   2. approve(primary)      — implicit in the ERC-3009 deposit auth the user
 *      signs (no separate ERC-20 approve tx is needed; depositForKey pulls via
 *      transferWithAuthorization). Represented by `deposit.{validAfter,...,s}`.
 *   3. depositForKey(primary) — operator submits the user's signed ERC-3009 auth
 *      (same path as a normal deposit). This is the only on-chain tx this helper
 *      itself broadcasts.
 *
 * PARTIAL-FAILURE SAFETY / IDEMPOTENT RETRY:
 *  - If the withdraw already happened (legacy balance == 0) but a previous
 *    deposit attempt failed, calling this again re-attempts ONLY the deposit. The
 *    ERC-3009 `nonce` makes the deposit itself replay-safe on-chain: a duplicate
 *    of an already-settled deposit reverts (depositForKeyOnChain returns null),
 *    so funds can never be double-credited.
 *  - The withdraw step is never performed by this helper, so a retry can never
 *    re-trigger a withdraw.
 *
 * @returns a result describing which steps ran. `depositTxHash` is null when the
 *   deposit could not be (re)submitted; the caller decides whether to surface a
 *   retry to the user.
 */
export async function migrateKeyBalanceToPrimary(params: {
  keyId:          string
  ownerAddress:   string
  /** Confirmed legacy withdrawKey tx hash (user-signed, already broadcast). */
  withdrawTxHash: `0x${string}`
  /** ERC-3009 signed authorization for the PRIMARY depositForKey. */
  deposit: {
    amount:      number
    validAfter:  number
    validBefore: number
    nonce:       string
    v:           number
    r:           string
    s:           string
  }
}): Promise<{
  migrated:       boolean
  withdrawTxHash: `0x${string}`
  depositTxHash:  string | null
  reason?:        string
}> {
  const legacyAddress = getLegacyContractAddress()
  if (!legacyAddress) {
    // No legacy configured → nothing to migrate. Backward-compat: never errors.
    return { migrated: false, withdrawTxHash: params.withdrawTxHash, depositTxHash: null, reason: 'no-legacy-configured' }
  }

  // Idempotency guard: the legacy balance MUST be drained (withdraw confirmed)
  // before we credit the primary, so a retried deposit can never out-run a
  // still-pending withdraw. We read the legacy balance fresh; a non-zero balance
  // means the withdraw hasn't settled — defer the deposit.
  let legacyRemaining = 0
  try {
    legacyRemaining = await readKeyBalanceAt(legacyAddress, params.keyId)
  } catch (err) {
    logger.error('[marketplace] migrate: legacy balance read failed', { err: String(err).slice(0, 200) })
    return { migrated: false, withdrawTxHash: params.withdrawTxHash, depositTxHash: null, reason: 'legacy-read-failed' }
  }

  if (legacyRemaining > 0) {
    logger.warn('[marketplace] migrate: legacy balance not yet drained — deferring deposit', {
      keyId: params.keyId.slice(0, 8), legacyRemaining,
    })
    return { migrated: false, withdrawTxHash: params.withdrawTxHash, depositTxHash: null, reason: 'legacy-not-drained' }
  }

  // Legacy drained → (re)submit the PRIMARY deposit. depositForKeyOnChain targets
  // the PRIMARY contract (getContractAddress) and is replay-safe via the ERC-3009
  // nonce, so this is the idempotent retry point (AC-3, AC-4).
  const depositTxHash = await depositForKeyOnChain({
    keyId:        params.keyId,
    ownerAddress: params.ownerAddress,
    amount:       params.deposit.amount,
    validAfter:   params.deposit.validAfter,
    validBefore:  params.deposit.validBefore,
    nonce:        params.deposit.nonce,
    v:            params.deposit.v,
    r:            params.deposit.r,
    s:            params.deposit.s,
  })

  if (!depositTxHash) {
    return { migrated: false, withdrawTxHash: params.withdrawTxHash, depositTxHash: null, reason: 'deposit-failed' }
  }

  logger.info('[marketplace] migrate: completed', {
    keyId: params.keyId.slice(0, 8), withdrawTxHash: params.withdrawTxHash, depositTxHash,
  })
  return { migrated: true, withdrawTxHash: params.withdrawTxHash, depositTxHash }
}

/**
 * Read the current platformFeeBps from the contract.
 * Returns null on failure so caller can apply a fallback — distinguishes
 * "fee is 0" (valid) from "RPC failed" (should use fallback).
 * SDD #17: used by runSettlement to calculate creator share for api_key calls.
 */
export async function getPlatformFeeBps(): Promise<number | null> {
  const contractAddress = getContractAddress()
  if (!contractAddress) {
    logger.warn('[marketplace] getPlatformFeeBps: contract not configured')
    return null
  }

  try {
    const { public: pub } = getOperatorClient()
    const bps = await pub.readContract({
      address:      contractAddress,
      abi:          WASIAI_MARKETPLACE_ABI,
      functionName: 'platformFeeBps',
    }) as unknown as bigint | number
    return Number(bps)
  } catch (err) {
    logger.error('[marketplace] getPlatformFeeBps failed', { err: String(err).slice(0, 200) })
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

/**
 * Check whether an agent slug is registered on-chain.
 */
export async function isAgentRegisteredOnChain(slug: string): Promise<boolean> {
  const contractAddress = getContractAddress()
  if (!contractAddress) return false
  try {
    const { public: pub } = getOperatorClient()
    const AGENTS_ABI = [{ name: 'agents', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'string' }], outputs: [{ name: 'creator', type: 'address' }, { name: 'pricePerCall', type: 'uint256' }, { name: 'erc8004Id', type: 'uint64' }] }] as const
    const result = await pub.readContract({
      address:      contractAddress,
      abi:          AGENTS_ABI,
      functionName: 'agents',
      args:         [slug],
    })
    const creator = (result as readonly [`0x${string}`, bigint, bigint])[0]
    return creator !== '0x0000000000000000000000000000000000000000'
  } catch {
    return false
  }
}
