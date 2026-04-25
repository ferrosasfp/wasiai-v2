/**
 * x402/buildRequirements.ts
 *
 * Shared builder for x402 v1 payment requirements (the body returned alongside
 * an HTTP 402 probe response). Extracted from the duplicate `buildRequirements`
 * functions previously living in
 *   - src/app/api/v1/models/[slug]/invoke/route.ts
 *   - src/app/api/v1/agents/[slug]/introspect/route.ts
 * (MNR-CR-4 — DRY).
 *
 * Bypasses the x402 SDK's `getChainByName()` which doesn't recognise
 * 'avalanche-testnet'. Inputs (chain, asset) are passed by the caller so this
 * module stays pure — no env reads, no module-scope side effects.
 */

export type X402Network = 'avalanche' | 'avalanche-testnet'

export interface BuildRequirementsInput {
  /** Decimal USDC amount, e.g. "0.10" — converted to atomic units (6 decimals). */
  amount:      string
  /** payTo address — usually the marketplace contract. */
  recipient:   string
  /** Resource URL used for x402 binding. */
  resource:    string
  /** Free-form human description shown in the 402 body. */
  description: string
  /** Response body content-type advertised by the resource. */
  mimeType:    string
  /** Network identifier — driven by NEXT_PUBLIC_CHAIN_ID at the call site. */
  network:     X402Network
  /** USDC contract address for the network above. */
  asset:       string
}

export interface X402Requirements {
  scheme:            'exact'
  network:           X402Network
  maxAmountRequired: string
  resource:          string
  description:       string
  mimeType:          string
  payTo:             string
  maxTimeoutSeconds: number
  asset:             string
}

/**
 * Build x402 payment requirements manually.
 *
 * Atomic conversion uses USDC's 6-decimal precision; rounded to integer atoms
 * via `Math.round` to mirror the original duplicated helpers bit-exact.
 */
export function buildRequirements(opts: BuildRequirementsInput): X402Requirements {
  const atomicAmount = Math.round(parseFloat(opts.amount) * 1_000_000).toString()
  return {
    scheme:            'exact',
    network:           opts.network,
    maxAmountRequired: atomicAmount,
    resource:          opts.resource,
    description:       opts.description,
    mimeType:          opts.mimeType,
    payTo:             opts.recipient,
    maxTimeoutSeconds: 300,
    asset:             opts.asset,
  }
}
