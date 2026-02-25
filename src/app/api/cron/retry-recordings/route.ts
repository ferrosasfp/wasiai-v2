/**
 * POST /api/cron/retry-recordings
 *
 * T-07: Cron endpoint to process pending on-chain recordings.
 * Call this from Vercel Cron Jobs (vercel.json) every 10 minutes.
 *
 * Security: protected by CRON_SECRET header to prevent unauthorized calls.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { processPendingRecordings } from '@/lib/chain/pendingRecordings'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  // HAL-008: SIEMPRE verificar — si CRON_SECRET no está configurado, rechazar todo
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const authorization = request.headers.get('authorization')
  if (authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    logger.info('[cron/retry-recordings] starting processing run')
    const stats = await processPendingRecordings()
    logger.info('[cron/retry-recordings] completed', stats)

    // HAL-017: Monitor stale pending recordings (age > 1h)
    // Any stale recordings indicate x402 payments where creator may not get paid
    const { createServiceClient } = await import('@/lib/supabase/server')
    const monitorSupabase = createServiceClient()
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count: staleCount } = await monitorSupabase
      .from('pending_recordings')
      .select('*', { count: 'exact', head: true })
      .is('resolved_at', null)
      .lt('next_retry_at', oneHourAgo)
      .lt('attempts', 5)

    if (staleCount && staleCount > 0) {
      logger.error('[cron/retry-recordings] ALERT: stale pending recordings detected', {
        alert: 'PENDING_RECORDINGS_STALE',
        staleCount,
        message: `${staleCount} payment(s) older than 1h could not be recorded on-chain. Creators may not receive payment.`,
        action: 'Check RPC connectivity and operator wallet AVAX balance.',
      })
    }

    return NextResponse.json({
      ok: true,
      ...stats,
      staleCount: staleCount ?? 0,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    logger.error('[cron/retry-recordings] unhandled error', { err })
    return NextResponse.json(
      { error: 'Internal error during retry processing' },
      { status: 500 },
    )
  }
}

// Vercel Cron: add to vercel.json
// {
//   "crons": [{
//     "path": "/api/cron/retry-recordings",
//     "schedule": "*/10 * * * *"
//   }]
// }
