/**
 * Server-side client for WasiEscrow.sol
 *
 * Used by:
 *  - /api/v1/agents/[slug]/invoke-long → calls createEscrow() after user signature
 *  - /api/v1/internal/escrow/release-expired → calls releaseExpired()
 *
 * Requires env vars:
 *  OPERATOR_PRIVATE_KEY     → backend wallet private key (operator role)
 *  WASI_ESCROW_ADDRESS      → deployed WasiEscrow contract address (Fuji)
 *  NEXT_PUBLIC_RPC_TESTNET  → Fuji RPC URL
 *
 * @dev Fuji ONLY (chainId: 43113) — NEVER mainnet.
 *      viem v2 — NEVER ethers.js.
 */

import { createWalletClient, createPublicClient, http, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { avalancheFuji } from 'viem/chains'
import { logger } from '@/lib/logger'

// ─── ABI ──────────────────────────────────────────────────────────────────────

const ESCROW_ABI = [
  {
    name: 'createEscrow',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'escrowId',    type: 'bytes32' },
      { name: 'slug',        type: 'string'  },
      { name: 'payer',       type: 'address' },
      { name: 'amount',      type: 'uint256' },
      { name: 'validAfter',  type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce',       type: 'bytes32' },
      { name: 'v',           type: 'uint8'   },
      { name: 'r',           type: 'bytes32' },
      { name: 's',           type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'releaseEscrow',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs:  [{ name: 'escrowId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'releaseExpired',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs:  [{ name: 'escrowId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'refundEscrow',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs:  [{ name: 'escrowId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'getEscrow',
    type: 'function',
    stateMutability: 'view',
    inputs:  [{ name: 'escrowId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'payer',     type: 'address' },
          { name: 'slug',      type: 'string'  },
          { name: 'amount',    type: 'uint256' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'status',    type: 'uint8'   },
        ],
      },
    ],
  },
] as const

// ─── Singleton client ─────────────────────────────────────────────────────────

let _escrowClientInstance: ReturnType<typeof _createEscrowClient> | null = null

function _createEscrowClient() {
  const pkRaw = process.env.OPERATOR_PRIVATE_KEY
  if (!pkRaw) throw new Error('OPERATOR_PRIVATE_KEY not set')
  const pkHex   = pkRaw.trim().replace(/^0x/i, '')
  const account = privateKeyToAccount(`0x${pkHex}` as `0x${string}`)
  const rpcUrl  = process.env.NEXT_PUBLIC_RPC_TESTNET?.trim() || undefined

  return {
    wallet: createWalletClient({ account, chain: avalancheFuji, transport: http(rpcUrl) }),
    public: createPublicClient({ chain: avalancheFuji, transport: http(rpcUrl) }),
    account,
  }
}

function getEscrowClient() {
  if (!_escrowClientInstance) {
    _escrowClientInstance = _createEscrowClient()
  }
  return _escrowClientInstance
}

function getEscrowAddress(): Address | null {
  const addr = process.env.WASI_ESCROW_ADDRESS
  if (!addr || addr === '0x0000000000000000000000000000000000000000') return null
  return addr as Address
}

// ─── Internal helper ──────────────────────────────────────────────────────────

async function _callEscrow(
  functionName: string,
  args: unknown[]
): Promise<string | null> {
  const address = getEscrowAddress()
  if (!address) {
    logger.warn(`[escrow] WASI_ESCROW_ADDRESS not configured — skipping ${functionName}`)
    return null
  }

  try {
    const { wallet, public: pub, account } = getEscrowClient()
    const { request } = await pub.simulateContract({
      address,
      abi: ESCROW_ABI,
      functionName: functionName as never,
      account,
      args: args as never,
    })
    const txHash = await wallet.writeContract(request)
    logger.info(`[escrow] ${functionName} tx`, { txHash, escrowId: args[0] })
    return txHash
  } catch (err) {
    logger.error(`[escrow] ${functionName} failed`, { err: String(err).slice(0, 300) })
    return null
  }
}

// ─── Public functions ─────────────────────────────────────────────────────────

/**
 * Create an escrow on-chain via ERC-3009 transferWithAuthorization.
 * Returns tx hash or null if contract not configured.
 */
export async function createEscrowOnChain(params: {
  escrowId:    `0x${string}`
  slug:        string
  payer:       Address
  amount:      bigint
  validAfter:  bigint
  validBefore: bigint
  nonce:       `0x${string}`
  v:           number
  r:           `0x${string}`
  s:           `0x${string}`
}): Promise<string | null> {
  return _callEscrow('createEscrow', [
    params.escrowId,
    params.slug,
    params.payer,
    params.amount,
    params.validAfter,
    params.validBefore,
    params.nonce,
    params.v,
    params.r,
    params.s,
  ])
}

/**
 * Release escrow to Marketplace (operator only).
 */
export async function releaseEscrowOnChain(escrowId: `0x${string}`): Promise<string | null> {
  return _callEscrow('releaseEscrow', [escrowId])
}

/**
 * Trustless release after 24h timeout. Anyone can call.
 */
export async function releaseExpiredOnChain(escrowId: `0x${string}`): Promise<string | null> {
  return _callEscrow('releaseExpired', [escrowId])
}

/**
 * Refund escrow to payer (operator only, on agent failure).
 */
export async function refundEscrowOnChain(escrowId: `0x${string}`): Promise<string | null> {
  return _callEscrow('refundEscrow', [escrowId])
}
