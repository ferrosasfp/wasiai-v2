import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { depositForKeyOnChain, getKeyBalanceOnChain } from '@/lib/contracts/marketplaceClient'
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

const depositSchema = depositSchemaEOA

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
      .select('id, key_hash, budget_usdc, is_active, owner_id, owner_wallet_address')
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

    // ── HU-058: Owner wallet enforcement ───────────────────────────────────────
    const registeredWallet = (keyRow as { owner_wallet_address?: string | null }).owner_wallet_address?.toLowerCase()
    const incomingWallet   = body.ownerAddress.toLowerCase()
    const ownerDiffers     = !!registeredWallet && registeredWallet !== incomingWallet
    // ownerDiffers → depósito se permite, warning en response (RN-3)

    // 4. Submit deposit on-chain — EIP-3009 TransferWithAuthorization (EOA)
    let txHash: string

    {
      // ── EOA — EIP-3009 TransferWithAuthorization ──────────────────────────
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

    // 6. Persistir owner_wallet_address en primer depósito (HAL-025: solo después de tx OK)
    if (!registeredWallet) {
      await supabase
        .from('agent_keys')
        .update({ owner_wallet_address: body.ownerAddress })
        .eq('id', id)
        .eq('owner_id', user.id)
    }

    // 7. Fetch on-chain balance for response
    const onChainBalance = await getKeyBalanceOnChain(keyRow.key_hash)
    const newBudget = Number(keyRow.budget_usdc) + body.amount  // optimistic estimate

    return NextResponse.json({
      ok:            true,
      txHash,
      newBudgetDb:   newBudget,
      onChainBalance,
      ...(ownerDiffers ? {
        warning: `Este depósito se acreditó a la key. El retiro solo se puede hacer con ${keyRow.owner_wallet_address}.`,
      } : {}),
    })
  } catch (err) {
    logger.error('[deposit] unhandled error', { err })
    return NextResponse.json(
      { error: 'Internal server error', detail: process.env.NODE_ENV === 'development' ? String(err) : undefined },
      { status: 500 },
    )
  }
}
