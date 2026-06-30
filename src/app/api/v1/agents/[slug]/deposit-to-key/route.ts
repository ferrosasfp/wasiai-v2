/**
 * POST /api/v1/agents/[slug]/deposit-to-key
 *
 * WAS-295: Agent self-deposit — autonomous USDC deposit into agent key.
 * Auth: x-agent-key
 * Gas: operator pays AVAX, charges agent in USDC overhead
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createHash, randomBytes } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import {
  getAgentWalletClient,
  getAgentWalletAddress,
  getAgentWalletUsdcBalance,
} from '@/lib/agent-wallets/agentWallet'
import { depositForKeyOnChain, getDepositedUsdcFromReceipt } from '@/lib/contracts/marketplaceClient'
import { creditKeyBudgetIdempotent } from '@/lib/contracts/creditKeyBudget'
import { calcPlatformOverhead } from '@/lib/pricing/overhead'
import { getSharedRedis } from '@/lib/ratelimit'
import { logger } from '@/lib/logger'
import { Ratelimit } from '@upstash/ratelimit'

const DEPOSIT_CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-agent-key',
}

const MAX_DEPOSIT = Number(process.env.MAX_SELF_DEPOSIT_USDC ?? '1000')

const DepositSchema = z.object({
  amount_usdc: z.number().min(0.01).max(MAX_DEPOSIT),
  key_id:      z.string().uuid().optional(),
})

// ── EIP-712 constants (same as agentPay.ts — CD-1) ───────────────────────────
const CHAIN_ID_NUM = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)

const USDC_ADDR: Record<number, `0x${string}`> = {
  43114: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  43113: '0x5425890298aed601595a70AB815c96711a31Bc65',
}

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

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: DEPOSIT_CORS })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const supabase = createServiceClient()

  // ── 1. Rate limit: 5/hour per agent key ──────────────────────────────────
  const rawKey = req.headers.get('x-agent-key')
  if (!rawKey) {
    return NextResponse.json({ error: 'Missing x-agent-key header' }, { status: 401, headers: DEPOSIT_CORS })
  }

  const keyHash = createHash('sha256').update(rawKey).digest('hex')
  const depositLimiter = new Ratelimit({
    redis:   getSharedRedis(),
    limiter: Ratelimit.slidingWindow(5, '1 h'),
    prefix:  'rl:agent-deposit',
  })
  const { success: rateLimitOk } = await depositLimiter.limit(`deposit:${keyHash}`)
  if (!rateLimitOk) {
    return NextResponse.json({ error: 'Rate limit exceeded — max 5 deposits/hour' }, { status: 429, headers: DEPOSIT_CORS })
  }

  // ── 2. Validate x-agent-key ───────────────────────────────────────────────
  const { data: keyRow } = await supabase
    .from('agent_keys')
    .select('id, owner_id, key_hash, is_active')
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .single()

  if (!keyRow) {
    return NextResponse.json({ error: 'Invalid or inactive agent key' }, { status: 401, headers: DEPOSIT_CORS })
  }

  // ── 3. Validate body ──────────────────────────────────────────────────────
  let body: z.infer<typeof DepositSchema>
  try {
    body = DepositSchema.parse(await req.json())
  } catch (err) {
    return NextResponse.json(
      { error: 'Invalid request body', detail: err instanceof Error ? err.message : String(err) },
      { status: 400, headers: DEPOSIT_CORS },
    )
  }

  const { amount_usdc } = body

  // ── 4. Resolve agent by slug ──────────────────────────────────────────────
  const { data: agentRow } = await supabase
    .from('agents')
    .select('id, creator_id')
    .eq('slug', slug)
    .single()

  if (!agentRow) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404, headers: DEPOSIT_CORS })
  }

  if (agentRow.creator_id !== keyRow.owner_id) {
    return NextResponse.json(
      { error: 'key does not belong to this agent\'s creator' },
      { status: 403, headers: DEPOSIT_CORS },
    )
  }

  const agentId = agentRow.id

  // ── 5. Get agent wallet ───────────────────────────────────────────────────
  const walletAddress = await getAgentWalletAddress(agentId)
  if (!walletAddress) {
    return NextResponse.json(
      { error: 'wallet_not_initialized', hint: 'Initialize wallet first' },
      { status: 409, headers: DEPOSIT_CORS },
    )
  }

  // ── 6. Calculate gas overhead ─────────────────────────────────────────────
  const { overhead: gasOverhead } = await calcPlatformOverhead(0)
  // IGNORE circuitBreaker (irrelevant for deposits per SDD)

  // ── 7. Check USDC balance ─────────────────────────────────────────────────
  const { balanceUsdc: balanceRaw } = await getAgentWalletUsdcBalance(walletAddress)
  const balance = Number(balanceRaw) / 1_000_000
  const totalRequired = amount_usdc + gasOverhead

  if (balance < totalRequired) {
    return NextResponse.json(
      {
        error: 'insufficient_balance',
        balance,
        required: totalRequired,
        breakdown: { deposit: amount_usdc, gas_fee_usdc: gasOverhead, total: totalRequired },
      },
      { status: 402, headers: DEPOSIT_CORS },
    )
  }

  // ── 8. Resolve target key_id ──────────────────────────────────────────────
  let targetKeyId: string = keyRow.id
  let targetKeyHash: string = keyRow.key_hash

  if (body.key_id && body.key_id !== keyRow.id) {
    const { data: targetKey } = await supabase
      .from('agent_keys')
      .select('id, key_hash, owner_id, is_active')
      .eq('id', body.key_id)
      .single()

    if (!targetKey || !targetKey.is_active) {
      return NextResponse.json({ error: 'Target key not found or inactive' }, { status: 404, headers: DEPOSIT_CORS })
    }

    if (targetKey.owner_id !== keyRow.owner_id) {
      return NextResponse.json({ error: 'Target key does not belong to same owner' }, { status: 403, headers: DEPOSIT_CORS })
    }

    targetKeyId   = targetKey.id
    targetKeyHash = targetKey.key_hash
  }

  // ── 9. Insert agent_deposits (status: 'pending') ──────────────────────────
  const { data: depositRecord, error: insertError } = await supabase
    .from('agent_deposits')
    .insert({
      agent_key_id:       targetKeyId,
      agent_id:           agentId,
      owner_id:           keyRow.owner_id,
      wallet_address:     walletAddress,
      amount_usdc,
      gas_fee_usdc:       gasOverhead,
      total_debited_usdc: amount_usdc + gasOverhead,
      status:             'pending',
    })
    .select('id')
    .single()

  if (insertError || !depositRecord) {
    logger.error('[agent-self-deposit] failed to insert deposit record', { insertError })
    return NextResponse.json({ error: 'Failed to create deposit record' }, { status: 500, headers: DEPOSIT_CORS })
  }

  const depositId = depositRecord.id

  // ── 10. Sign EIP-712 TransferWithAuthorization ────────────────────────────
  // Follow EXACT pattern from agentPay.ts lines 100-145
  const nonceBytes = randomBytes(32)
  const nonceHex   = ('0x' + nonceBytes.toString('hex')) as `0x${string}`

  const validBefore = Math.floor(Date.now() / 1000) + 300  // 5 min
  const amountWei   = BigInt(Math.round(amount_usdc * 1_000_000))

  const contractAddress = process.env.MARKETPLACE_CONTRACT_ADDRESS

  let signature: `0x${string}`
  try {
    const walletClient = await getAgentWalletClient(agentId)

    signature = await walletClient.signTypedData({
      domain:      USDC_DOMAIN,
      types:       TRANSFER_TYPES,
      primaryType: 'TransferWithAuthorization',
      message: {
        from:        walletAddress  as `0x${string}`,
        to:          contractAddress as `0x${string}`,
        value:       amountWei,
        validAfter:  0n,
        validBefore: BigInt(validBefore),
        nonce:       nonceHex,
      },
    })
  } catch (err) {
    await supabase.from('agent_deposits').update({ status: 'failed' }).eq('id', depositId)
    logger.error('[agent-self-deposit] EIP-712 signing failed', { agentId, err: String(err).slice(0, 300) })
    return NextResponse.json({ error: 'deposit_failed', detail: 'EIP-712 signing error' }, { status: 500, headers: DEPOSIT_CORS })
  }

  // Split signature into v, r, s (same pattern as existing deposit route)
  const r = signature.slice(0, 66) as `0x${string}`
  const s = ('0x' + signature.slice(66, 130)) as `0x${string}`
  const v = parseInt(signature.slice(130, 132), 16)

  // ── 11. Execute depositForKeyOnChain ──────────────────────────────────────
  let txHash: string | null
  try {
    txHash = await depositForKeyOnChain({
      keyId:        targetKeyHash,
      ownerAddress: walletAddress,
      amount:       amount_usdc,
      validAfter:   0,
      validBefore,
      nonce:        nonceHex,
      v,
      r,
      s,
    })
  } catch (err) {
    await supabase.from('agent_deposits').update({ status: 'failed' }).eq('id', depositId)
    logger.error('[agent-self-deposit] depositForKeyOnChain threw', { depositId, err: String(err).slice(0, 300) })
    return NextResponse.json({ error: 'deposit_failed' }, { status: 500, headers: DEPOSIT_CORS })
  }

  if (txHash === null) {
    await supabase.from('agent_deposits').update({ status: 'failed' }).eq('id', depositId)
    return NextResponse.json({ error: 'contract_not_configured' }, { status: 503, headers: DEPOSIT_CORS })
  }

  // ── 12. Update DB on success ──────────────────────────────────────────────
  await supabase
    .from('agent_deposits')
    .update({ status: 'success', tx_hash: txHash })
    .eq('id', depositId)

  // TB-06: credit the amount DECODED FROM THE RECEIPT Transfer log (capped at
  // the requested amount), not the trusted body amount.
  const usdcAddress = USDC_ADDR[CHAIN_ID_NUM] ?? null
  let creditAmount = amount_usdc
  if (usdcAddress) {
    const decoded = await getDepositedUsdcFromReceipt(
      txHash as `0x${string}`,
      usdcAddress,
      walletAddress as `0x${string}`,
    )
    if (decoded !== null) {
      creditAmount = Math.min(decoded, amount_usdc)
      if (decoded !== amount_usdc) {
        logger.warn('[agent-self-deposit] receipt amount differs from requested', { decoded, requested: amount_usdc, txHash })
      }
    }
  }

  // TB-06: atomic, idempotent budget credit keyed by (chain_id, tx_hash).
  const credit = await creditKeyBudgetIdempotent(supabase, {
    keyId:   targetKeyId,
    amount:  creditAmount,
    ownerId: keyRow.owner_id,
    chainId: CHAIN_ID_NUM,
    txHash,
  })
  if (!credit.ok && credit.alreadyCredited) {
    logger.warn('[agent-self-deposit] deposit already credited (idempotent no-op)', { txHash })
  } else if (!credit.ok) {
    logger.error('[agent-self-deposit] budget_usdc atomic update failed (tx already submitted)', { error: credit.error, txHash })
  }

  // Fetch updated budget for response
  const { data: updatedKey } = await supabase
    .from('agent_keys')
    .select('budget_usdc')
    .eq('id', targetKeyId)
    .single()

  const newBudget = Number(updatedKey?.budget_usdc ?? 0)

  // ── 13. Return success ────────────────────────────────────────────────────
  logger.info('[agent-self-deposit] completed', {
    agentSlug:  slug,
    keyId:      targetKeyId,
    amount:     amount_usdc,
    gasFee:     gasOverhead,
    txHash,
  })

  return NextResponse.json(
    {
      success:            true,
      tx_hash:            txHash,
      deposited_usdc:     creditAmount,
      gas_fee_usdc:       gasOverhead,
      total_debited_usdc: amount_usdc + gasOverhead,
      new_budget_usdc:    newBudget,
    },
    { status: 200, headers: DEPOSIT_CORS },
  )
}
