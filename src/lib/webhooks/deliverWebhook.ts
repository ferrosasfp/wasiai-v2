import crypto from 'crypto'
import { fetchPinned } from '@/lib/security/fetchPinned'

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
    // V-06 (audit 2026-06-25): the webhook URL is DB-stored and was POSTed with a
    // plain `fetch` (no delivery-time SSRF validation, follows redirects to
    // internal IPs). fetchPinned validates the URL via validateEndpointUrlAsync
    // at delivery time and connects to the validated IP with the hostname pinned
    // (no DNS re-resolution, no redirect-follow via node:https). A validation
    // rejection throws EndpointValidationError → caught below → fail-closed.
    const res = await fetchPinned(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-WasiAI-Signature': `sha256=${signature}`,
        'X-WasiAI-Event': payload.event,
      },
      body,
      timeoutMs: 10_000, // 10s timeout
    })
    return { success: res.ok, statusCode: res.status }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
}
