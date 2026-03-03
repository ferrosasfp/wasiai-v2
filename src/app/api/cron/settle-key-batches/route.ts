import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { runSettlement } from '@/lib/settlement/runSettlement'
import { logger } from '@/lib/logger'

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
  // HAL-008: SIEMPRE verificar — si CRON_SECRET no está configurado, rechazar todo
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (!cronSecret) {
    logger.error('[settle-key-batches] CRON_SECRET not configured')
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    logger.warn('[settle-key-batches] Unauthorized cron attempt')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
