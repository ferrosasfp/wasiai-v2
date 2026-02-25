import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { depositForKeyOnChain, getKeyBalanceOnChain } from '@/lib/contracts/marketplaceClient'
import { logger } from '@/lib/logger'

const depositSchema = z.object({
  ownerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid Ethereum address'),
  amount:       z.number().min(1).max(1000),
  validAfter:   z.number().int().min(0),
  validBefore:  z.number().int().min(1),
  nonce:        z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid nonce (must be 0x + 64 hex chars)'),
  v:            z.number().int().min(27).max(28),
  r:            z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid r value'),
  s:            z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid s value'),
})

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

    // 4. Submit ERC-3009 deposit on-chain (operator-mediated)
    logger.info('[deposit] initiating depositForKey', { keyId: keyRow.key_hash.slice(0, 8), amount: body.amount })

    const txHash = await depositForKeyOnChain({
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

    if (!txHash) {
      return NextResponse.json(
        { error: 'On-chain deposit failed — check contract configuration' },
        { status: 500 },
      )
    }

    logger.info('[deposit] on-chain tx submitted', { txHash })

    // 5. Update budget_usdc in DB (read-then-write)
    const currentBudget = Number(keyRow.budget_usdc) || 0
    const newBudget = currentBudget + body.amount

    const { error: updateError } = await supabase
      .from('agent_keys')
      .update({ budget_usdc: newBudget })
      .eq('id', id)
      .eq('owner_id', user.id)

    if (updateError) {
      // On-chain tx succeeded, DB update failed — log but return partial success
      logger.error('[deposit] DB budget_usdc update failed (tx already submitted)', { updateError, txHash })
    }

    // 6. Fetch on-chain balance for response
    const onChainBalance = await getKeyBalanceOnChain(keyRow.key_hash)

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
