/**
 * agentPay.ts — Pagos autónomos agente→agente (WAS-140)
 *
 * Permite que un agente pague a otro agente usando su agentWallet self-custody.
 * Implementa el flujo x402 server-to-server completo:
 *   1. Probe → obtener requirements del agente destino
 *   2. Firmar EIP-712 TransferWithAuthorization con la wallet del agente invocador
 *   3. Retry con X-PAYMENT header
 *
 * SEGURIDAD:
 * - Private key nunca sale de getAgentWalletClient()
 * - Balance check antes del probe (fail-fast)
 * - nonce único por pago (crypto.randomBytes)
 */

import crypto from 'crypto'
import {
  getAgentWalletClient,
  getAgentWalletAddress,
  getAgentWalletUsdcBalance,
} from './agentWallet'
import { SITE_URL } from '@/lib/constants'
import { logger } from '@/lib/logger'

// ── Constants (CD-1: igual que usdcSettler.ts) ────────────────────────────────
const CHAIN_ID_NUM = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)

const USDC_ADDR: Record<number, `0x${string}`> = {
  43114: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  43113: '0x5425890298aed601595a70AB815c96711a31Bc65',
}

// CD-1: Dominio EIP-712 idéntico al de usdcSettler.ts
const USDC_DOMAIN = {
  name:              'USD Coin',
  version:           '2',
  chainId:           CHAIN_ID_NUM,
  verifyingContract: USDC_ADDR[CHAIN_ID_NUM],
} as const

const TRANSFER_TYPES = {
  TransferWithAuthorization: [
    { name: 'from',        type: 'address' },
    { name: 'to',          type: 'address' },
    { name: 'value',       type: 'uint256' },
    { name: 'validAfter',  type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce',       type: 'bytes32'  },
  ],
} as const

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Requirements402 {
  maxAmountRequired: string   // atomic USDC units, e.g. "1000" = $0.001
  payTo:             string   // marketplace contract address
  asset:             string   // USDC contract address
  network:           string   // 'avalanche-testnet' | 'avalanche'
  scheme:            string   // 'exact'
}

export type AgentPayErrorCode =
  | 'no_agent_wallet'
  | 'insufficient_balance'
  | 'target_not_found'
  | 'probe_failed'
  | 'payment_failed'

export class AgentPayError extends Error {
  constructor(
    public readonly code: AgentPayErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AgentPayError'
  }
}

export interface AgentInvokeResult {
  result:  unknown
  meta: {
    model:      string
    latency_ms: number
    charged:    number
    currency:   string
    tx_hash:    string | null
    status:     string
  }
  receipt?: { signature: string }
}

// ── Core: firma EIP-712 server-side ──────────────────────────────────────────

/**
 * Firma un TransferWithAuthorization EIP-712 usando la wallet del agente.
 * Retorna el X-PAYMENT header listo para enviar (base64 JSON).
 *
 * CD-4: formato = btoa(JSON.stringify(paymentHeader)) — igual que useWalletPayment.ts
 */
export async function signAgentPayment(
  agentId:       string,
  requirements:  Requirements402,
  callerAddress: string,
): Promise<string> {
  const walletClient = await getAgentWalletClient(agentId)

  // Nonce único por pago — CD evita replay attacks
  const nonceBytes = crypto.randomBytes(32)
  const nonceHex   = ('0x' + nonceBytes.toString('hex')) as `0x${string}`

  const validBefore = Math.floor(Date.now() / 1000) + 300  // 5 min
  const amountWei   = BigInt(requirements.maxAmountRequired)

  const signature = await walletClient.signTypedData({
    domain: USDC_DOMAIN,
    types:  TRANSFER_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: {
      from:        callerAddress          as `0x${string}`,
      to:          requirements.payTo     as `0x${string}`,
      value:       amountWei,
      validAfter:  0n,
      validBefore: BigInt(validBefore),
      nonce:       nonceHex,
    },
  })

  const paymentHeader = {
    x402Version: 1,
    scheme:      requirements.scheme,
    network:     requirements.network,
    payload: {
      signature,
      authorization: {
        from:        callerAddress,
        to:          requirements.payTo,
        value:       amountWei.toString(),
        validAfter:  '0',
        validBefore: validBefore.toString(),
        nonce:       nonceHex,
      },
    },
  }

  // CD-4: mismo encoding que useWalletPayment.ts:164
  return btoa(JSON.stringify(paymentHeader))
}

// ── Main: flujo completo A2A ──────────────────────────────────────────────────

/**
 * Invoca un agente destino pagando con la wallet del agente invocador.
 *
 * Flujo:
 *   1. Verificar wallet + balance
 *   2. Probe POST sin pago → obtener requirements (402)
 *   3. Firmar EIP-712
 *   4. Retry POST con X-PAYMENT header
 *
 * @param callerAgentId - UUID del agente que paga
 * @param targetSlug    - Slug del agente destino
 * @param input         - Payload a enviar al agente destino
 */
export async function invokeAgentWithPayment(
  callerAgentId: string,
  targetSlug:    string,
  input:         string,
): Promise<AgentInvokeResult> {

  // ── 1. Verificar wallet ─────────────────────────────────────────────────
  const callerAddress = await getAgentWalletAddress(callerAgentId)
  if (!callerAddress) {
    throw new AgentPayError(
      'no_agent_wallet',
      `Agent ${callerAgentId} has no wallet. Generate one first.`,
    )
  }

  // ── 2. Probe: POST sin X-PAYMENT → 402 + requirements ──────────────────
  // CD-3: El probe es POST (no GET — GET retorna el spec técnico del modelo)
  const invokeUrl = `${SITE_URL}/api/v1/models/${targetSlug}/invoke`

  let probeRes: Response
  try {
    probeRes = await fetch(invokeUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ input }),
    })
  } catch (err) {
    throw new AgentPayError('probe_failed', `Probe request failed: ${String(err)}`)
  }

  if (probeRes.status === 404) {
    throw new AgentPayError('target_not_found', `Agent ${targetSlug} not found or inactive`)
  }

  if (probeRes.status !== 402) {
    throw new AgentPayError(
      'probe_failed',
      `Expected 402 from probe, got ${probeRes.status}`,
    )
  }

  const requirements = await probeRes.json() as Requirements402

  // ── 3. Balance check (después de saber el monto exacto) ─────────────────
  // CD-5: balance check antes de firmar — fail-fast sin gastar gas
  const { balanceUsdcFormatted } = await getAgentWalletUsdcBalance(callerAddress)
  const requiredUsdc = Number(requirements.maxAmountRequired) / 1_000_000
  const balanceUsdc  = parseFloat(balanceUsdcFormatted)

  if (balanceUsdc < requiredUsdc) {
    throw new AgentPayError(
      'insufficient_balance',
      `Agent wallet balance ${balanceUsdc} USDC < required ${requiredUsdc} USDC`,
    )
  }

  // ── 4. Firmar EIP-712 ────────────────────────────────────────────────────
  let paymentHeaderB64: string
  try {
    paymentHeaderB64 = await signAgentPayment(callerAgentId, requirements, callerAddress)
  } catch (err) {
    throw new AgentPayError('payment_failed', `EIP-712 signing failed: ${String(err)}`)
  }

  // ── 5. Retry con X-PAYMENT ───────────────────────────────────────────────
  let paidRes: Response
  try {
    paidRes = await fetch(invokeUrl, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PAYMENT':    paymentHeaderB64,
      },
      body: JSON.stringify({ input }),
    })
  } catch (err) {
    throw new AgentPayError('payment_failed', `Paid request failed: ${String(err)}`)
  }

  if (!paidRes.ok) {
    const errBody = await paidRes.json().catch(() => ({})) as { error?: string }
    throw new AgentPayError(
      'payment_failed',
      errBody.error ?? `Payment request returned ${paidRes.status}`,
    )
  }

  const paidData = await paidRes.json() as AgentInvokeResult

  logger.info('[agentPay] A2A payment successful', {
    callerAgentId,
    targetSlug,
    txHash: paidData.meta?.tx_hash,
    charged: paidData.meta?.charged,
  })

  return paidData
}
