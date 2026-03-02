import crypto from 'crypto'

export interface WebhookPayload {
  event: string
  timestamp: string
  data: Record<string, unknown>
}

export async function deliverWebhook(
  url: string,
  secret: string,
  payload: WebhookPayload
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const body = JSON.stringify(payload)
  const signature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex')

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-WasiAI-Signature': `sha256=${signature}`,
        'X-WasiAI-Event': payload.event,
      },
      body,
      signal: AbortSignal.timeout(10_000), // 10s timeout
    })
    return { success: res.ok, statusCode: res.status }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
}
