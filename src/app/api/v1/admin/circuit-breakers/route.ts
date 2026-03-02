import { NextResponse } from 'next/server'
import { getState } from '@/lib/circuit-breaker/CircuitBreaker'
import {
  verifyAdminSignature,
  type AdminActionMessage,
} from '@/lib/admin/verifyAdminSignature'

// Read from env — never hardcoded
const PROVIDERS = (process.env.AI_PROVIDERS ?? 'openai,anthropic').split(',').map(p => p.trim()).filter(Boolean)

export async function GET(req: Request) {
  // Expect: X-Admin-Signature header + X-Admin-Message header (JSON)
  const signature = req.headers.get('x-admin-signature') as `0x${string}` | null
  const messageRaw = req.headers.get('x-admin-message')

  if (!signature || !messageRaw) {
    return NextResponse.json({ error: 'Missing admin auth headers' }, { status: 401 })
  }

  let message: AdminActionMessage
  try {
    const parsed = JSON.parse(messageRaw) as { action: string; nonce: string; timestamp: string | number }
    message = {
      action:    parsed.action,
      nonce:     parsed.nonce as `0x${string}`,
      timestamp: BigInt(parsed.timestamp),
    }
  } catch {
    return NextResponse.json({ error: 'Invalid x-admin-message JSON' }, { status: 400 })
  }

  const auth = await verifyAdminSignature(signature, message)
  if (!auth.ok) {
    return NextResponse.json({ error: 'Forbidden', reason: auth.reason }, { status: 403 })
  }

  const statuses = await Promise.all(
    PROVIDERS.map(async (id) => ({ id, state: await getState(id) }))
  )
  return NextResponse.json({ providers: statuses })
}
