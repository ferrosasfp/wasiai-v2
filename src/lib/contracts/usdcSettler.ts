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
// WAS-V2-1: External facilitator opt-in wrapper deps (section below).
// Imports moved to top per TS convention; functions remain in the
// `WAS-V2-1: External facilitator opt-in wrapper` section below.
// WAS-V2-2: routing/telemetry delegated to facilitator-router (trySettle).
import type { SettlePaymentX402Ctx } from './x402-facilitator-client'
import { trySettle } from './facilitator-router'

export type { SettlePaymentX402Ctx }

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

// Plain ERC-20 transfer ABI — used for refunds (operator wallet → payer).
// A refund moves USDC FROM the operator's own balance, so no EIP-3009
// authorization is involved (that flow needs the caller's signature).
const ERC20_TRANSFER_ABI = [
  {
    name:    'transfer',
    type:    'function',
    inputs:  [
      { name: 'to',    type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
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

    const usdcAddress = USDC_ADDR[CHAIN_ID]
    if (!usdcAddress) throw new Error(`No USDC address configured for chain ${CHAIN_ID}`)

    const txHash = await walletClient.writeContract({
      address:      usdcAddress,
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

// ─── WAS-V2-2: thin delegator to facilitator-router ──────────────────────────
// CD-3: public signature preserved.
// CD-14: lines 1-338 of this file are intact; only the body of
//        settlePaymentX402 below was refactored.
//
// Routing/telemetry now lives in facilitator-router.trySettle which decides
// between wasiai-facilitator (primary, when toggle on), Ultravioleta DAO
// (fallback) and settlePaymentDirectly (internal baseline). The router emits
// the single structured `[settler]` log entry (CD-10).

/**
 * Settle an x402 payment via the dual facilitator router.
 *
 * Toggle off (WASIAI_FACILITATOR_AS_PRIMARY unset/false): behavior is identical
 * to WAS-V2-1 baseline — UVD if `X402_FACILITATOR_URL` is set, else
 * `settlePaymentDirectly` (zero regression, AC-1/AC-14).
 *
 * Toggle on + chain in allowlist: wasiai-facilitator tried first, transparent
 * fallback to UVD on 5xx / timeout / CHAIN_UNAVAILABLE / INVALID_PAYLOAD.
 * `NONCE_ALREADY_USED` (or HTTP 409) → no fallback (CD-5/AC-10 idempotency).
 *
 * Toggle on + chain NOT in allowlist: routes directly to UVD without trying
 * wasiai (AC-4).
 */
export async function settlePaymentX402(
  payload:  X402EVMPayload,
  required: string,
  ctx:      SettlePaymentX402Ctx,
): Promise<SettlementResult> {
  // WAS-V2-2: routing/telemetry delegated to facilitator-router.
  // The router emits the single structured [settler] log (CD-10).
  return await trySettle(payload, required, ctx)
}

// ─── V6: USDC refund transfer (operator wallet → payer) ──────────────────────

export interface TransferUsdcResult {
  success: boolean
  transactionHash?: string
  error?: string
}

/**
 * V6: Plain ERC-20 USDC transfer from the operator wallet to `to`.
 *
 * Used to refund a caller when an x402 settlement landed on-chain (USDC left the
 * caller's wallet) but the upstream agent failed (caller got no service). The
 * operator wallet pays the USDC out of its own balance + the gas.
 *
 * Unlike settlePaymentDirectly (which uses EIP-3009 transferWithAuthorization and
 * needs the caller's signature), a refund moves the operator's own funds, so a
 * plain ERC-20 transfer is the correct primitive.
 *
 * @param to            recipient (the original payer = authorization.from)
 * @param atomicAmount  amount in atomic micro-USDC units as a string (e.g. "120000")
 */
export async function transferUsdc(
  to:           string,
  atomicAmount: string,
): Promise<TransferUsdcResult> {
  try {
    if (BigInt(atomicAmount) <= 0n) {
      return { success: false, error: `Invalid refund amount: ${atomicAmount}` }
    }

    // Defense-in-depth (audit 2026-06-25 B2): cap the max amount this primitive
    // can move out of the operator wallet. transferUsdc is a raw "transfer from
    // operator" primitive — today the only caller passes a small, on-chain-bounded
    // refund amount, but capping here ensures a future misuse cannot drain funds.
    // Configurable via MAX_OPERATOR_TRANSFER_USDC (whole USDC units, e.g. "100").
    // Default: 100 USDC. Refunds are cents, so they pass with huge margin.
    const maxUsdc = Number(process.env.MAX_OPERATOR_TRANSFER_USDC ?? 100)
    const maxAtomic = BigInt(Math.floor(maxUsdc * 1_000_000)) // USDC has 6 decimals
    if (BigInt(atomicAmount) > maxAtomic) {
      logger.warn('[settler] refund transfer exceeds max cap', { to, atomicAmount, maxAtomic: maxAtomic.toString() })
      return { success: false, error: 'amount exceeds max transfer cap' }
    }

    const pkRaw = process.env.OPERATOR_PRIVATE_KEY
    if (!pkRaw) throw new Error('OPERATOR_PRIVATE_KEY not set')
    const pkHex   = pkRaw.trim().replace(/^0x/i, '')
    const account = privateKeyToAccount(`0x${pkHex}` as `0x${string}`)
    const chain   = IS_FUJI ? avalancheFuji : avalanche
    const rpcUrl  = RPC[CHAIN_ID] ?? ''

    const usdcAddress = USDC_ADDR[CHAIN_ID]
    if (!usdcAddress) throw new Error(`No USDC address configured for chain ${CHAIN_ID}`)

    const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) })
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })

    const txHash = await walletClient.writeContract({
      address:      usdcAddress,
      abi:          ERC20_TRANSFER_ABI,
      functionName: 'transfer',
      args:         [to as Address, BigInt(atomicAmount)],
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 })

    if (receipt.status !== 'success') {
      return { success: false, error: `Refund transaction reverted (${txHash})` }
    }

    logger.info('[settler] USDC refund confirmed', { txHash, to })
    return { success: true, transactionHash: txHash }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('[settler] refund transfer error', { msg, to })
    return { success: false, error: msg }
  }
}
