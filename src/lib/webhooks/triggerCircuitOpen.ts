import { createServiceClient } from '@/lib/supabase/server'
import { deliverWebhook } from './deliverWebhook'

/**
 * Trigger agent.circuit_open webhooks for a creator.
 * Fire-and-forget: call with `void triggerCircuitOpen(slug, creatorId)`.
 *
 * @param slug      - Agent slug whose circuit opened
 * @param creatorId - UUID of the agent's creator
 */
export async function triggerCircuitOpen(slug: string, creatorId: string): Promise<void> {
  const supabase = createServiceClient()

  const { data: webhooks, error } = await supabase
    .from('webhooks')
    .select('id, url, secret')
    .eq('user_id', creatorId)
    .eq('is_active', true)
    .contains('events', ['agent.circuit_open'])

  if (error || !webhooks?.length) return

  const payload = {
    event: 'agent.circuit_open',
    timestamp: new Date().toISOString(),
    data: {
      agent_slug: slug,
      creator_id: creatorId,
    },
  }

  await Promise.allSettled(
    webhooks.map(async (wh) => {
      const result = await deliverWebhook(wh.url as string, wh.secret as string, payload)
      await supabase.from('webhook_deliveries').insert({
        webhook_id: wh.id,
        event: payload.event,
        payload,
        status_code: result.statusCode ?? null,
        success: result.success,
      })
    })
  )
}
