/**
 * usdcSettler.ts
 *
 * Self-hosted x402 settlement for Avalanche (Fuji testnet + mainnet).
 *
 * WAS-134: WasiAI es su propio facilitador x402 — no dependencia de UltravioletaDAO.
 * settlePaymentDirectly() soporta ambas chains (43113 Fuji / 43114 mainnet):
 *   1. Verifica la firma EIP-712 TransferWithAuthorization
 *   2. Ejecuta transferWithAuthorization en el contrato USDC via operator wallet
 *
 * El operator wallet paga gas AVAX — el usuario paga cero gas.
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  recoverTypedDataAddress,
  type Address,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { avalanche, avalancheFuji } from 'viem/chains'
import { logger } from '@/lib/logger'

// ─── Constants ────────────────────────────────────────────────────────────────

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
const IS_FUJI  = CHAIN_ID === 43113

const USDC_ADDR: Record<number, Address> = {
  43114: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', // Avalanche mainnet
  43113: '0x5425890298aed601595a70AB815c96711a31Bc65', // Fuji testnet
}

const RPC: Record<number, string | undefined> = {
  43114: process.env.NEXT_PUBLIC_RPC_MAINNET,
  43113: process.env.NEXT_PUBLIC_RPC_TESTNET ?? 'https://avalanche-fuji-c-chain-rpc.publicnode.com',
}

// USDC EIP-712 domain
const USDC_DOMAIN = {
  name:              'USD Coin',
  version:           '2',
  chainId:           CHAIN_ID,
  verifyingContract: USDC_ADDR[CHAIN_ID],
} as const

// Circle USDC v2 ABI — transferWithAuthorization with (v, r, s)
const TRANSFER_WITH_AUTH_ABI = [
  {
    name:    'transferWithAuthorization',
    type:    'function',
    inputs:  [
      { name: 'from',        type: 'address' },
      { name: 'to',          type: 'address' },
      { name: 'value',       type: 'uint256' },
      { name: 'validAfter',  type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce',       type: 'bytes32' },
      { name: 'v',           type: 'uint8'   },
      { name: 'r',           type: 'bytes32' },
      { name: 's',           type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

// EIP-3009 typed data types
const TRANSFER_TYPES = {
  TransferWithAuthorization: [
    { name: 'from',        type: 'address' },
    { name: 'to',          type: 'address' },
    { name: 'value',       type: 'uint256' },
    { name: 'validAfter',  type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce',       type: 'bytes32' },
  ],
} as const

// ─── Types ────────────────────────────────────────────────────────────────────

export interface X402Authorization {
  from:        string
  to:          string
  value:       string   // atomic USDC units as string, e.g. "1000"
  validAfter:  string
  validBefore: string
  nonce:       string   // 0x-prefixed bytes32
}

export interface X402EVMPayload {
  signature:     string
  authorization: X402Authorization
}

export interface SettlementResult {
  verified: boolean
  settled:  boolean
  transactionHash?: string
  error?: string
}

// ─── Main settler function ────────────────────────────────────────────────────

/**
 * Verify + settle an x402 EVM payment directly (no external facilitator).
 *
 * @param payload   - The decoded x402 EVM payload (signature + authorization)
 * @param required  - Amount required in atomic units (e.g. "1000" = $0.001 USDC)
 */
export async function settlePaymentDirectly(
  payload:  X402EVMPayload,
  required: string,
): Promise<SettlementResult> {
  const { signature, authorization: auth } = payload

  try {
    // ── 1. Timing checks ────────────────────────────────────────────────────
    const now = Math.floor(Date.now() / 1000)

    // HAL-019: validBefore check — rejects expired authorizations before hitting the chain
    // Prevents creator not getting paid when RPC is slow and deadline has passed
    if (Number(auth.validBefore) < now) {
      return { verified: false, settled: false, error: 'Authorization expired (validBefore < now)' }
    }
    if (Number(auth.validAfter) > now) {
      return { verified: false, settled: false, error: 'Authorization not yet valid (validAfter > now)' }
    }

    // ── 2. Amount check ─────────────────────────────────────────────────────
    if (BigInt(auth.value) < BigInt(required)) {
      return {
        verified: false,
        settled: false,
        error: `Insufficient amount: got ${auth.value}, need ${required}`,
      }
    }

    // ── 3. Setup clients (needed for both verification and settlement) ────
    const pkRaw = process.env.OPERATOR_PRIVATE_KEY
    if (!pkRaw) throw new Error('OPERATOR_PRIVATE_KEY not set')
    const pkHex = pkRaw.trim().replace(/^0x/i, '')
    const account = privateKeyToAccount(`0x${pkHex}` as `0x${string}`)
    const chain   = IS_FUJI ? avalancheFuji : avalanche
    const rpcUrl  = RPC[CHAIN_ID] ?? ''

    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    })
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    })

    // ── 4. EIP-712 signature verification ──────────────────────────────────
    const typedDataParams = {
      domain:      USDC_DOMAIN,
      types:       TRANSFER_TYPES,
      primaryType: 'TransferWithAuthorization' as const,
      message: {
        from:        auth.from        as Address,
        to:          auth.to          as Address,
        value:       BigInt(auth.value),
        validAfter:  BigInt(auth.validAfter),
        validBefore: BigInt(auth.validBefore),
        nonce:       auth.nonce as `0x${string}`,
      },
      signature: signature as `0x${string}`,
    }

    // Recover the actual signer via ecrecover for diagnostics
    const recoveredAddress = await recoverTypedDataAddress(typedDataParams)
    const claimedFrom = (auth.from as string).toLowerCase()
    const recovered   = recoveredAddress.toLowerCase()

    logger.info('[settler] signature check', {
      claimedFrom: auth.from,
      recoveredAddress,
      match: claimedFrom === recovered,
      domain: USDC_DOMAIN,
      authTo: auth.to,
      value: auth.value,
    })

    if (claimedFrom !== recovered) {
      // Try ERC-1271 verification (smart account / contract wallet)
      let erc1271Valid = false
      try {
        erc1271Valid = await publicClient.verifyTypedData({
          address: auth.from as Address,
          ...typedDataParams,
        })
      } catch {
        // ERC-1271 call failed — not a smart account or contract not deployed
      }

      if (!erc1271Valid) {
        return {
          verified: false,
          settled: false,
          error: `Invalid EIP-712 signature (ecrecover: ${recoveredAddress}, expected: ${auth.from})`,
        }
      }

      // ERC-1271 verified — but transferWithAuthorization uses ecrecover on-chain
      // so the on-chain settlement will fail for smart accounts
      logger.warn('[settler] ERC-1271 verified but transferWithAuthorization requires EOA signer', {
        smartAccount: auth.from,
        adminEOA: recoveredAddress,
      })
      return {
        verified: false,
        settled: false,
        error: 'Smart account detected — use approve+transfer flow instead of EIP-3009',
      }
    }

    // ── 5. Execute transferWithAuthorization via operator wallet ────────────
    // Split compact signature into v, r, s
    const sig = signature as `0x${string}`
    const r = sig.slice(0, 66) as `0x${string}`
    const s = ('0x' + sig.slice(66, 130)) as `0x${string}`
    // Normalize v: some wallets (Core, EIP-2098) use 0/1, USDC contract expects 27/28
    const vRaw = parseInt(sig.slice(130, 132), 16)
    const v = vRaw < 27 ? vRaw + 27 : vRaw

    const txHash = await walletClient.writeContract({
      address:      USDC_ADDR[CHAIN_ID],
      abi:          TRANSFER_WITH_AUTH_ABI,
      functionName: 'transferWithAuthorization',
      args: [
        auth.from        as Address,
        auth.to          as Address,
        BigInt(auth.value),
        BigInt(auth.validAfter),
        BigInt(auth.validBefore),
        auth.nonce       as `0x${string}`,
        v,
        r,
        s,
      ],
    })

    // Wait for confirmation (max 30s)
    const receipt = await publicClient.waitForTransactionReceipt({
      hash:    txHash,
      timeout: 30_000,
    })

    if (receipt.status !== 'success') {
      return { verified: true, settled: false, error: `Transaction reverted (${txHash})` }
    }

    logger.info('[settler] USDC transfer confirmed', { txHash })
    return { verified: true, settled: true, transactionHash: txHash }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('[settler] settlement error', { msg })
    return { verified: false, settled: false, error: msg }
  }
}
