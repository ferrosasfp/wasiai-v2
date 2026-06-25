import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { runRefunds } from '@/lib/settlement/runRefunds'
import { logger } from '@/lib/logger'

/**
 * V6 — Vercel Cron: procesar refunds pendientes.
 *
 * Cuando un settlement x402 sale OK on-chain pero el upstream falla, el caller
 * pagó y no recibió servicio. handleInvoke registra un refund 'pending'; este
 * cron lo paga de forma async (transfer USDC operator → payer) sin bloquear la
 * respuesta del invoke.
 *
 * Auth: Bearer CRON_SECRET (igual que settle-key-batches).
 *
 * vercel.json:
 *   { "path": "/api/cron/process-refunds", "schedule": "*\/10 * * * *" }
 */
export async function GET(request: NextRequest) {
  // HAL-008: SIEMPRE verificar — si CRON_SECRET no está configurado, rechazar todo
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (!cronSecret) {
    logger.error('[process-refunds] CRON_SECRET not configured')
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    logger.warn('[process-refunds] Unauthorized cron attempt')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const { refunded, results } = await runRefunds(supabase)

  logger.info('[process-refunds] done', { refunded, processed: results.length })
  return NextResponse.json({ ok: true, refunded, processed: results.length, results })
}
