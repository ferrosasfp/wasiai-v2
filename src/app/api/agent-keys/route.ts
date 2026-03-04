import { NextRequest, NextResponse } from 'next/server'
import { createAgentKey, getAgentKeys, revokeAgentKey } from '@/features/agent-api/services/agent-keys.service'
import { z } from 'zod'
import { getKeysLimit, getIdentifier, checkRateLimit } from '@/lib/ratelimit'
import { validateCsrf } from '@/lib/security/csrf'

const createSchema = z.object({
  name: z.string().min(1).max(64),
  budget_usdc: z.number().min(0).max(1000).default(0),
})

export async function GET() {
  try {
    const keys = await getAgentKeys()
    // WAS-141: key_hash (SHA-256, not raw key) exposed to owner for on-chain withdrawKey call
    // raw_key is never stored — key_hash is safe to expose to authenticated owner
    // P-11: Private cache — user-specific data, 30s browser cache
    return NextResponse.json(keys.map(k => ({ ...k })), {
      headers: { 'Cache-Control': 'private, max-age=30' },
    })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

export async function POST(request: NextRequest) {
  // S-02: CSRF protection
  const csrfError = validateCsrf(request)
  if (csrfError) return csrfError

  const rlHit = await checkRateLimit(getKeysLimit(), getIdentifier(request))
  if (rlHit) return rlHit
  try {
    const body = await request.json()
    const { name, budget_usdc } = createSchema.parse(body)
    const key = await createAgentKey(name, budget_usdc)
    // Return raw key ONCE — never retrievable again
    return NextResponse.json({
      ...key,
      key_hash: undefined,
      message: 'Save this key — it will not be shown again',
    }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest) {
  // S-02: CSRF protection
  const csrfError = validateCsrf(request)
  if (csrfError) return csrfError

  try {
    const { id } = await request.json()
    await revokeAgentKey(id)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Error' }, { status: 400 })
  }
}
