import { createServiceClient } from '@/lib/supabase/server'
import { deliverWebhook } from './deliverWebhook'

const CREDITS_LOW_THRESHOLD = Number(process.env.CREDITS_LOW_THRESHOLD ?? '5')

/**
 * Trigger credits.low webhooks for a user.
 * Call after deducting credits if the new balance may be below threshold.
 *
 * @param userId   - UUID of the user
 * @param balance  - Current balance after deduction (in USDC)
 */
export async function triggerCreditsLow(userId: string, balance: number): Promise<void> {
  if (balance >= CREDITS_LOW_THRESHOLD) return

  const supabase = createServiceClient()

  // Fetch active webhooks that subscribe to 'credits.low'
  const { data: webhooks, error } = await supabase
    .from('webhooks')
    .select('id, url, secret')
    .eq('user_id', userId)
    .eq('is_active', true)
    .contains('events', ['credits.low'])

  if (error || !webhooks?.length) return

  const payload = {
    event: 'credits.low',
    timestamp: new Date().toISOString(),
    data: {
      user_id: userId,
      balance,
      threshold: CREDITS_LOW_THRESHOLD,
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
