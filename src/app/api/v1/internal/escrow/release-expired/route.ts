/**
 * POST /api/v1/internal/escrow/release-expired
 *
 * Internal endpoint to release expired escrows (> 24h pending).
 * Auth: TB-03 HMAC signed request over INTERNAL_API_SECRET (timestamp + nonce).
 *       Headers: x-internal-signature, x-internal-timestamp, x-internal-nonce
 *       (produced by signInternalRequest). A static bearer is NOT accepted.
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
import { verifySignedRequest } from '@/lib/security/verifySignedRequest'

const ROUTE_PATH = '/api/v1/internal/escrow/release-expired'

export async function POST(request: NextRequest) {
  // ── Auth ───────────────────────────────────────────────────────────────────
  // TB-03 (audit 2026-06-30): this route triggers an operator-signed on-chain
  // action (releaseExpired). A static bearer is infinitely replayable, so we
  // require an HMAC signed request with a fresh timestamp + single-use nonce
  // (mirrors the admin-fee nonce+expiry pattern). Fail-closed on every error.
  //
  // Caller (operator / upkeep-listener) must produce the headers via
  // signInternalRequest(method, path, INTERNAL_API_SECRET).
  const auth = await verifySignedRequest('POST', ROUTE_PATH, request.headers)
  if (!auth.ok) {
    if (auth.status === 500) logger.error('[release-expired] auth misconfigured', { reason: auth.reason })
    else logger.warn('[release-expired] rejected signed request', { reason: auth.reason })
    return NextResponse.json({ error: auth.reason }, { status: auth.status })
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
