// ═══════════════════════════════════════════════════════════════════
// @wasiai/sdk — x402 Payment Verification
// ═══════════════════════════════════════════════════════════════════

import {
  FacilitatorClient,
  extractPaymentFromHeaders,
  buildErc8004PaymentRequirements,
  create402Response,
  X402_CORS_HEADERS,
} from 'uvd-x402-sdk/backend'

export { X402_CORS_HEADERS }

const DEFAULT_FACILITATOR = 'https://facilitator.ultravioletadao.xyz'
const DEFAULT_CHAIN = 'avalanche'

export interface PaymentContext {
  verified: boolean
  txHash: string | null
  payer: string | null
  error?: string
}

export interface RequirementsConfig {
  price: number
  treasury: string
  resourceUrl: string
  agentName: string
  facilitatorUrl?: string
  chain?: string
}

/**
 * Verifica el pago x402 de un request entrante.
 * Devuelve null si no hay payment header (→ debes responder 402).
 * Devuelve { verified: false } si el pago es inválido.
 * Devuelve { verified: true } si el pago es válido.
 */
export async function verifyX402Payment(
  headers: Record<string, string | string[] | undefined>,
  config: RequirementsConfig,
): Promise<PaymentContext | null> {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v ?? '']),
  )

  const paymentHeader = extractPaymentFromHeaders(normalizedHeaders)
  if (!paymentHeader) return null

  const requirements = buildErc8004PaymentRequirements({
    amount: String(config.price),
    recipient: config.treasury,
    resource: config.resourceUrl,
    chainName: config.chain ?? DEFAULT_CHAIN,
    description: `Access to ${config.agentName} on WasiAI`,
    mimeType: 'application/json',
  })

  const facilitator = new FacilitatorClient({
    baseUrl: config.facilitatorUrl ?? DEFAULT_FACILITATOR,
  })

  const settlement = await facilitator.verifyAndSettle(paymentHeader, requirements)

  return {
    verified: settlement.verified,
    txHash: settlement.transactionHash ?? null,
    payer: null, // extract from paymentHeader if needed
    error: settlement.error,
  }
}

/**
 * Construye la respuesta 402 con las instrucciones de pago.
 */
export function build402Response(config: RequirementsConfig) {
  const { status, headers, body } = create402Response({
    amount: String(config.price),
    recipient: config.treasury,
    resource: config.resourceUrl,
    chainName: config.chain ?? DEFAULT_CHAIN,
    description: `Access to ${config.agentName} on WasiAI`,
    mimeType: 'application/json',
  })

  return {
    status,
    headers: { ...headers, ...X402_CORS_HEADERS },
    body: {
      ...body,
      docs: 'https://wasiai.vercel.app/docs/x402',
    },
  }
}
