// src/app/api/cron/retry-webhook-deliveries/route.ts
import { type NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { deliverWebhook, type WebhookPayload } from '@/lib/webhooks/deliverWebhook'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const authorization = request.headers.get('authorization')
  if (authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createServiceClient()

    // Fetch hasta 50 deliveries fallidas con attempt < 3 (más antiguas primero)
    const { data: deliveries, error } = await supabase
      .from('webhook_deliveries')
      .select('id, webhook_id, event, payload, attempt')
      .eq('success', false)
      .lt('attempt', 3)
      .order('delivered_at', { ascending: true })
      .limit(50)

    if (error) {
      logger.error('[cron/retry-webhook-deliveries] query error', { error })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!deliveries?.length) {
      return NextResponse.json({ ok: true, retried: 0, timestamp: new Date().toISOString() })
    }

    // Obtener secrets de los webhooks involucrados
    const webhookIds = [...new Set(deliveries.map(d => d.webhook_id))]
    const { data: webhooks } = await supabase
      .from('webhooks')
      .select('id, url, secret')
      .in('id', webhookIds)

    const webhookMap = new Map((webhooks ?? []).map(w => [w.id, w]))

    let retried = 0
    let succeeded = 0

    await Promise.allSettled(
      deliveries.map(async (delivery) => {
        const wh = webhookMap.get(delivery.webhook_id)
        if (!wh) return

        const result = await deliverWebhook(
          wh.url as string,
          wh.secret as string,
          delivery.payload as WebhookPayload
        )

        await supabase
          .from('webhook_deliveries')
          .update({
            success: result.success,
            status_code: result.statusCode ?? null,
            attempt: (delivery.attempt ?? 1) + 1,
            delivered_at: new Date().toISOString(),
          })
          .eq('id', delivery.id)

        retried++
        if (result.success) succeeded++
      })
    )

    logger.info('[cron/retry-webhook-deliveries] completed', { retried, succeeded })
    return NextResponse.json({ ok: true, retried, succeeded, timestamp: new Date().toISOString() })
  } catch (err) {
    logger.error('[cron/retry-webhook-deliveries] unhandled error', { err })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
