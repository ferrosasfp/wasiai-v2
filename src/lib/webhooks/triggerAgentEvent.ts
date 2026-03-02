// src/lib/webhooks/triggerAgentEvent.ts
import { createServiceClient } from '@/lib/supabase/server'
import { deliverWebhook } from './deliverWebhook'
import { logger } from '@/lib/logger'
import type { WebhookEvent } from './events'

export async function triggerAgentEvent(
  event: WebhookEvent,
  agentId: string,
  creatorId: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    const supabase = createServiceClient()
    const { data: webhooks, error } = await supabase
      .from('webhooks')
      .select('id, url, secret')
      .eq('user_id', creatorId)
      .eq('is_active', true)
      .contains('events', [event])

    if (error || !webhooks?.length) return

    const payload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    }

    await Promise.allSettled(
      webhooks.map(async (wh) => {
        const result = await deliverWebhook(wh.url as string, wh.secret as string, payload)
        await supabase.from('webhook_deliveries').insert({
          webhook_id: wh.id,
          event,
          payload,
          status_code: result.statusCode ?? null,
          success: result.success,
          attempt: 1,
        })
      })
    )
  } catch (err) {
    logger.error('[triggerAgentEvent] non-fatal error', { event, agentId, err })
  }
}
