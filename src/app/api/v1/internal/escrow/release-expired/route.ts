/**
 * POST /api/v1/internal/escrow/release-expired
 *
 * Internal endpoint to release expired escrows (> 24h pending).
 * Auth: Bearer ${INTERNAL_API_SECRET}
 *
 * Triggered by:
 *  - Operator manually
 *  - upkeep-listener side effect (WAS-82)
 *
 * @dev NO Vercel Cron — plan Hobby 2/2 ya ocupado.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { releaseExpiredOnChain } from '@/lib/contracts/escrow'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  // ── Auth ───────────────────────────────────────────────────────────────────
  const secret = process.env.INTERNAL_API_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'server_misconfigured' }, { status: 500 })
  }

  const auth = request.headers.get('Authorization') ?? ''
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const svc = createServiceClient()

  // ── Query expired escrows ──────────────────────────────────────────────────
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: expired, error: queryError } = await svc
    .from('escrow_transactions')
    .select('escrow_id, agent_slug, payer_address, amount_usdc')
    .eq('status', 'pending')
    .lt('created_at', cutoff)

  if (queryError) {
    logger.error('[release-expired] DB query failed', { queryError })
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }

  if (!expired || expired.length === 0) {
    return NextResponse.json({ released: 0, errors: [] })
  }

  // ── Release each expired escrow ────────────────────────────────────────────
  let released = 0
  const errors: string[] = []

  for (const esc of expired) {
    try {
      const txHash = await releaseExpiredOnChain(esc.escrow_id as `0x${string}`)

      await svc
        .from('escrow_transactions')
        .update({
          status:      'released',
          released_at: new Date().toISOString(),
          tx_release:  txHash,
        })
        .eq('escrow_id', esc.escrow_id)

      logger.info('[release-expired] released', { escrowId: esc.escrow_id, txHash })
      released++
    } catch (err) {
      const msg = `${esc.escrow_id}: ${String(err).slice(0, 100)}`
      logger.error('[release-expired] failed', { msg })
      errors.push(msg)
    }
  }

  return NextResponse.json({ released, errors })
}
