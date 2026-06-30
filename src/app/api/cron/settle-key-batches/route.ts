import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { runSettlement } from '@/lib/settlement/runSettlement'
import { logger } from '@/lib/logger'
import { verifyCronAuth } from '@/lib/cron/verifyCronSecret'

/**
 * Vercel Cron — ejecutar diariamente a las 02:00 UTC
 *
 * Liquida en batch todas las llamadas de API keys pendientes.
 * Una sola tx on-chain cubre cientos de llamadas → gas amortizado.
 *
 * Para agregar al vercel.json:
 * {
 *   "crons": [{ "path": "/api/cron/settle-key-batches", "schedule": "0 2 * * *" }]
 * }
 *
 * NOTA: Los Vercel Crons requieren plan Hobby o superior con crons habilitados.
 * Si no está disponible, este endpoint puede llamarse manualmente con el CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  // V-07 / HAL-008: SIEMPRE verificar (fail-closed si CRON_SECRET no está) +
  // comparación constant-time del Bearer.
  const auth = verifyCronAuth(request.headers.get('authorization'))
  if (!auth.ok) {
    if (auth.status === 500) logger.error('[settle-key-batches] CRON_SECRET not configured')
    else logger.warn('[settle-key-batches] Unauthorized cron attempt')
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const supabase = createServiceClient()

  // Verificar modo activo — si es Chainlink, omitir este cron
  const { data: config } = await supabase
    .from('system_config')
    .select('value')
    .eq('key', 'settlement_mode')
    .single()

  if (config?.value === 'chainlink') {
    logger.info('[settle-key-batches] Chainlink mode active — skipping Vercel cron')
    return NextResponse.json({ skipped: true, reason: 'chainlink_mode_active' })
  }

  const { settled, results } = await runSettlement(supabase)

  logger.info('[settle-key-batches] done', { settled, keys: results.length })
  return NextResponse.json({
    ok: true,
    settled,
    keys: results.length,
    results,
  })
}
