import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { deliverWebhook } from '@/lib/webhooks/deliverWebhook'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { data: webhook, error } = await supabase
    .from('webhooks')
    .select('id, url, secret')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !webhook) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })

  const payload = {
    event: 'test',
    timestamp: new Date().toISOString(),
    data: { message: 'Test webhook from WasiAI' },
  }

  // fire-and-forget — do not block the response
  deliverWebhook(webhook.url as string, webhook.secret as string, payload).then(async (result) => {
    await supabase.from('webhook_deliveries').insert({
      webhook_id: webhook.id,
      event: payload.event,
      payload,
      status_code: result.statusCode ?? null,
      success: result.success,
    })
  }).catch(console.error)

  return NextResponse.json({ ok: true, message: 'Test event dispatched' })
}
