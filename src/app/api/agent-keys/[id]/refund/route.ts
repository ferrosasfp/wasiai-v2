import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { refundKeyToEarningsOnChain, settleKeyBatchOnChain } from '@/lib/contracts/marketplaceClient'
import { validateCsrf } from '@/lib/security/csrf'
import { logger } from '@/lib/logger'

/**
 * POST /api/agent-keys/[id]/refund
 *
 * Cierra una API key y devuelve el saldo restante a los earnings del owner.
 *
 * Flujo:
 *  1. Autenticar usuario
 *  2. Verificar que la key pertenece al usuario
 *  3. Liquidar en batch todas las llamadas pendientes (para que los creators cobren)
 *  4. Llamar refundKeyToEarnings() on-chain → saldo → earnings[owner]
 *  5. Revocar la key en DB (is_active = false)
 *  6. Retornar { ok: true, txHash, refundedUsdc }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // S-02: CSRF protection
  const csrfError = validateCsrf(request)
  if (csrfError) return csrfError

  const { id } = await params

  // 1. Autenticar
  const supabase     = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Verificar que la key pertenece al usuario y está activa
  const { data: keyRow, error: keyError } = await supabase
    .from('agent_keys')
    .select('id, key_hash, is_active, budget_usdc, spent_usdc, owner_id')
    .eq('id', id)
    .eq('owner_id', user.id)
    .single()

  if (keyError || !keyRow) {
    return NextResponse.json({ error: 'Key not found' }, { status: 404 })
  }

  if (!keyRow.is_active) {
    return NextResponse.json({ error: 'Key already revoked' }, { status: 400 })
  }

  const serviceSupabase = createServiceClient()

  // 3. Mini-batch: liquidar todas las llamadas pendientes de esta key
  //    Para que el creator no pierda earnings aunque la key se cierre ahora.
  try {
    const { data: pendingCalls } = await serviceSupabase
      .from('agent_calls')
      .select('id, agent_slug, amount_paid')
      .eq('key_id', id)
      .is('settled_at', null)
      .neq('status', 'error')
      .order('called_at', { ascending: true })

    if (pendingCalls && pendingCalls.length > 0 && keyRow.key_hash) {
      const validCalls  = pendingCalls.filter(c => c.agent_slug && c.amount_paid && Number(c.amount_paid) > 0)
      const slugs       = validCalls.map(c => c.agent_slug as string)
      const amounts     = validCalls.map(c => Number(c.amount_paid))
      const callIds     = validCalls.map(c => c.id)

      if (slugs.length > 0) {
        logger.info('[refund] settling pending calls before refund', { keyId: id, count: slugs.length })

        const txHash = await settleKeyBatchOnChain(keyRow.key_hash, slugs, amounts)
        if (txHash) {
          const now = new Date().toISOString()
          await serviceSupabase
            .from('agent_calls')
            .update({ settled_at: now, settlement_tx_hash: txHash })
            .in('id', callIds)
        }
      }
    }
  } catch (err) {
    // Non-fatal: continue with refund even if mini-batch fails
    logger.error('[refund] mini-batch settle failed (non-fatal)', { keyId: id, err })
  }

  // 4. Llamar refundKeyToEarnings on-chain ANTES de revocar en DB
  // HAL-025: Si hay saldo y el on-chain falla, NO revocar la key (usuario perdería fondos Y key)
  let refundTxHash: string | null = null
  const refundedUsdc = Math.max(0, Number(keyRow.budget_usdc) - Number(keyRow.spent_usdc))

  if (keyRow.key_hash && refundedUsdc > 0) {
    refundTxHash = await refundKeyToEarningsOnChain(keyRow.key_hash)
    if (!refundTxHash) {
      // HAL-025: On-chain refund failed and there's real balance — abort to protect user funds
      logger.error('[refund] refundKeyToEarningsOnChain failed with pending balance — aborting revoke to protect funds', {
        keyId: id,
        refundedUsdc,
      })
      return NextResponse.json(
        {
          error: 'On-chain refund failed. Your key remains active and your USDC is safe. Please try again in a few minutes.',
          code: 'REFUND_ONCHAIN_FAILED',
        },
        { status: 503 },
      )
    }
  }

  // 5. Revocar la key en DB (solo después de confirmar el on-chain o si no había saldo)
  const { error: revokeError } = await supabase
    .from('agent_keys')
    .update({ is_active: false })
    .eq('id', id)
    .eq('owner_id', user.id)

  if (revokeError) {
    logger.error('[refund] failed to revoke key in DB', { keyId: id, revokeError })
    return NextResponse.json({ error: 'Failed to revoke key' }, { status: 500 })
  }

  logger.info('[refund] key refunded', { keyId: id, refundedUsdc, txHash: refundTxHash })

  return NextResponse.json({
    ok:          true,
    txHash:      refundTxHash,
    refundedUsdc,
    message:     refundedUsdc > 0
      ? `$${refundedUsdc.toFixed(4)} USDC moved to your Earnings. You can claim it from /creator/dashboard.`
      : 'Key revoked. No remaining balance to refund.',
  })
}
