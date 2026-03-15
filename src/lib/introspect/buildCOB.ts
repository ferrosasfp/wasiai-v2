/**
 * buildCOB.ts — Capability Object Bundle builder + EIP-712 style signature
 *
 * The COB is a signed snapshot of agent introspection data.
 * Signature: keccak256(JSON.stringify(cob)) signed by operator wallet.
 * Follows same pattern as signReceipt.ts (viem, operator wallet).
 */

import { privateKeyToAccount } from 'viem/accounts'
import { keccak256, toBytes } from 'viem'

export type IntrospectDepth = 'shallow' | 'mid' | 'full'

export interface COB {
  agent_slug:         string
  depth:              IntrospectDepth
  state_snapshots:    object[]
  call_trace:         object[]
  memory_diffs:       object[]   // incremental for shallow/mid
  timing_profile:     object
  erc8004_identity:   string     // on-chain identity ref
  operator_signature: string | null
  truncated:          boolean
  truncated_reason?:  string
  generated_at:       number     // unix timestamp (seconds)
}

export interface BuildCOBOptions {
  agentSlug:       string
  depth:           IntrospectDepth
  upstreamData:    unknown       // raw response from upstream
  latencyMs:       number
  truncated:       boolean
  truncatedReason?: string
  erc8004Identity: string
}

/**
 * Build a COB from upstream data + metadata.
 * memory_diffs is kept incremental (not full blob) for shallow/mid.
 */
export function assembleCOB(opts: BuildCOBOptions): Omit<COB, 'operator_signature'> {
  const upstream = (opts.upstreamData && typeof opts.upstreamData === 'object')
    ? opts.upstreamData as Record<string, unknown>
    : {}

  const stateSnapshots: object[] = Array.isArray(upstream['state_snapshots'])
    ? upstream['state_snapshots'] as object[]
    : []

  const callTrace: object[] = Array.isArray(upstream['call_trace'])
    ? upstream['call_trace'] as object[]
    : []

  // AC5: For shallow/mid → incremental only; full → whatever upstream returns
  let memoryDiffs: object[] = []
  if (Array.isArray(upstream['memory_diffs'])) {
    const raw = upstream['memory_diffs'] as object[]
    if (opts.depth === 'full') {
      memoryDiffs = raw
    } else {
      // Incremental: only entries with a "delta" or "diff" key, or first 10
      memoryDiffs = raw
        .filter((e) => typeof e === 'object' && e !== null && ('delta' in e || 'diff' in e))
        .slice(0, opts.depth === 'mid' ? 20 : 10)
    }
  }

  const timingProfile: object = (upstream['timing_profile'] && typeof upstream['timing_profile'] === 'object')
    ? upstream['timing_profile'] as object
    : { total_ms: opts.latencyMs }

  const cob: Omit<COB, 'operator_signature'> = {
    agent_slug:       opts.agentSlug,
    depth:            opts.depth,
    state_snapshots:  stateSnapshots,
    call_trace:       callTrace,
    memory_diffs:     memoryDiffs,
    timing_profile:   timingProfile,
    erc8004_identity: opts.erc8004Identity,
    truncated:        opts.truncated,
    generated_at:     Math.floor(Date.now() / 1000),
  }

  if (opts.truncated && opts.truncatedReason) {
    cob.truncated_reason = opts.truncatedReason
  }

  return cob
}

/**
 * Sign the COB with the operator wallet.
 * Message: keccak256(JSON.stringify(cob)) as raw bytes.
 * Returns null (non-fatal) if OPERATOR_PRIVATE_KEY is not set or signing fails.
 */
export async function signCOB(cob: Omit<COB, 'operator_signature'>): Promise<string | null> {
  try {
    const operatorKey = process.env.OPERATOR_PRIVATE_KEY?.trim()
    if (!operatorKey) return null

    const key = operatorKey.startsWith('0x') ? operatorKey : `0x${operatorKey}`
    const account = privateKeyToAccount(key as `0x${string}`)

    const hash = keccak256(toBytes(JSON.stringify(cob)))
    return await account.signMessage({ message: { raw: toBytes(hash) } })
  } catch {
    return null
  }
}

/**
 * Build and sign a complete COB.
 * If signing fails, operator_signature is null (COB is still returned per SDD).
 */
export async function buildCOB(opts: BuildCOBOptions): Promise<COB> {
  const cobWithoutSig = assembleCOB(opts)
  const signature = await signCOB(cobWithoutSig)
  return {
    ...cobWithoutSig,
    operator_signature: signature,
  }
}
