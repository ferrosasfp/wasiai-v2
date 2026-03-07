import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { depositForKeyOnChain, getKeyBalanceOnChain } from '@/lib/contracts/marketplaceClient'
import { verifyUsdcTransfer } from '@/lib/contracts/verifyUsdcTransfer'
import { logger } from '@/lib/logger'

// Route B: EOA — EIP-3009 TransferWithAuthorization
const depositSchemaEOA = z.object({
  ownerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid Ethereum address'),
  amount:       z.number().min(0.01).max(1000),
  validAfter:   z.number().int().min(0),
  validBefore:  z.number().int().min(1),
  nonce:        z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid nonce (must be 0x + 64 hex chars)'),
  v:            z.number().int().min(0).max(28).transform(v => v < 27 ? v + 27 : v),
  r:            z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid r value'),
  s:            z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid s value'),
})

// Route C: Embedded wallet — USDC.transfer directo + tx hash
const depositSchemaRouteC = z.object({
  ownerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid Ethereum address'),
  amount:       z.number().min(0.01).max(1000),
  txHash:       z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid tx hash'),
})

const depositSchema = z.union([depositSchemaRouteC, depositSchemaEOA])

/**
 * POST /api/agent-keys/[id]/deposit
 *
 * Body: { ownerAddress, amount, validAfter, validBefore, nonce, v, r, s }
 *
 * Flow:
 *  1. Authenticate user
 *  2. Verify key belongs to user
 *  3. Call depositForKeyOnChain (operator submits ERC-3009 transfer)
 *  4. Update budget_usdc in DB (read-then-write)
 *  5. Return { ok, txHash, newBalance }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    // 1. Authenticate
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Validate request body
    let body: z.infer<typeof depositSchema>
    try {
      body = depositSchema.parse(await request.json())
    } catch (err) {
      return NextResponse.json(
        { error: 'Invalid request body', detail: err instanceof Error ? err.message : String(err) },
        { status: 400 },
      )
    }

    // 3. Get key from DB — verify ownership
    const { data: keyRow, error: keyError } = await supabase
      .from('agent_keys')
      .select('id, key_hash, budget_usdc, is_active, owner_id')
      .eq('id', id)
      .eq('owner_id', user.id)
      .single()

    if (keyError || !keyRow) {
      return NextResponse.json({ error: 'Key not found' }, { status: 404 })
    }

    if (!keyRow.is_active) {
      return NextResponse.json({ error: 'Key is revoked' }, { status: 409 })
    }

    if (!keyRow.key_hash) {
      return NextResponse.json({ error: 'Key has no hash — cannot identify on-chain' }, { status: 500 })
    }

    // HAL-020: Verify ownerAddress matches authenticated user's wallet
    const { data: creatorProfile } = await supabase
      .from('creator_profiles')
      .select('wallet_address')
      .eq('user_id', user.id)
      .single()

    if (!creatorProfile?.wallet_address) {
      // Auto-registrar wallet_address si el creator no lo tiene configurado aún
      await supabase
        .from('creator_profiles')
        .upsert({ user_id: user.id, wallet_address: body.ownerAddress }, { onConflict: 'user_id' })
    } else if (body.ownerAddress.toLowerCase() !== creatorProfile.wallet_address.toLowerCase()) {
      return NextResponse.json(
        { error: 'ownerAddress does not match your configured wallet address' },
        { status: 403 },
      )
    }

    // 4. Submit deposit on-chain — Route C (txHash) or Route B (EIP-3009)
    let txHash: string

    if ('txHash' in body) {
      // ── Route C: Embedded wallet — verificar Transfer event on-chain ──────
      logger.info('[deposit] Route C — verifying USDC transfer on-chain', {
        txHash: body.txHash.slice(0, 10),
        amount: body.amount,
        owner:  body.ownerAddress,
      })

      const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
      const marketplaceAddr = chainId === 43114
        ? (process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET ?? '')
        : (process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI    ?? '')
      const verification = await verifyUsdcTransfer(body.txHash, body.amount, marketplaceAddr)
      if (!verification.verified) {
        return NextResponse.json(
          { error: 'Payment verification failed', detail: verification.error },
          { status: 402 },
        )
      }
      txHash = body.txHash
      logger.info('[deposit] Route C verified', { txHash })
    } else {
      // ── Route B: EOA — EIP-3009 TransferWithAuthorization (existente) ────
      logger.info('[deposit] Route B — initiating depositForKey', {
        keyId:       keyRow.key_hash.slice(0, 8),
        amount:      body.amount,
        owner:       body.ownerAddress,
        v:           body.v,
        r:           body.r.slice(0, 10),
        s:           body.s.slice(0, 10),
        validBefore: body.validBefore,
        nonce:       body.nonce.slice(0, 10),
      })

      const result = await depositForKeyOnChain({
        keyId:        keyRow.key_hash,
        ownerAddress: body.ownerAddress,
        amount:       body.amount,
        validAfter:   body.validAfter,
        validBefore:  body.validBefore,
        nonce:        body.nonce,
        v:            body.v,
        r:            body.r,
        s:            body.s,
      })

      if (!result) {
        return NextResponse.json(
          { error: 'On-chain deposit failed — check contract configuration' },
          { status: 500 },
        )
      }
      txHash = result
      logger.info('[deposit] Route B on-chain tx submitted', { txHash })
    }

    // 5. HAL-011: Update budget_usdc atomically via RPC (prevents race condition)
    const { error: updateError } = await supabase.rpc('increment_key_budget', {
      p_key_id:   id,
      p_amount:   body.amount,
      p_owner_id: user.id,
    })

    if (updateError) {
      // On-chain tx succeeded, DB update failed — log but return partial success
      logger.error('[deposit] DB budget_usdc atomic update failed (tx already submitted)', { updateError, txHash })
    }

    // 6. Fetch on-chain balance for response
    const onChainBalance = await getKeyBalanceOnChain(keyRow.key_hash)
    const newBudget = Number(keyRow.budget_usdc) + body.amount  // optimistic estimate

    return NextResponse.json({
      ok:            true,
      txHash,
      newBudgetDb:   newBudget,
      onChainBalance,
    })
  } catch (err) {
    logger.error('[deposit] unhandled error', { err })
    return NextResponse.json(
      { error: 'Internal server error', detail: process.env.NODE_ENV === 'development' ? String(err) : undefined },
      { status: 500 },
    )
  }
}
