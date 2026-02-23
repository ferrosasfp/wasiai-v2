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
  // Verify cron secret to prevent unauthorized calls
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authorization = request.headers.get('authorization')
    if (authorization !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    logger.info('[cron/retry-recordings] starting processing run')
    const stats = await processPendingRecordings()
    logger.info('[cron/retry-recordings] completed', stats)

    return NextResponse.json({
      ok: true,
      ...stats,
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
