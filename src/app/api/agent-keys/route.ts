import { NextRequest, NextResponse } from 'next/server'
import { createAgentKey, getAgentKeys, revokeAgentKey } from '@/features/agent-api/services/agent-keys.service'
import type { AgentKey } from '@/features/agent-api/services/agent-keys.service'
import { z } from 'zod'
import { getKeysLimit, getIdentifier, checkRateLimit } from '@/lib/ratelimit'
import { validateCsrf } from '@/lib/security/csrf'
import { getKeyBalanceOnChain } from '@/lib/contracts/marketplaceClient'
import { createServiceClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { jsonError } from '@/lib/api/jsonError'

const createSchema = z.object({
  name: z.string().min(1).max(64),
  budget_usdc: z.number().min(0).max(1000).default(0),
})

const SYNC_STALE_MS = 30 * 1000 // 30s — skip on-chain read if fresher than this
const CONCURRENCY_LIMIT = 5

type KeyWithMeta = AgentKey & { stale?: boolean }

async function syncKeysOnChain(keys: AgentKey[]): Promise<KeyWithMeta[]> {
  const serviceClient = createServiceClient()
  const now = Date.now()

  // Split keys: needsSync (stale) vs skip (fresh/no hash)
  const needsSync: AgentKey[] = []
  for (const key of keys) {
    if (!key.key_hash) {
      continue // no hash → skip on-chain read, return stale
    }
    const syncedAt = key.balance_synced_at ? new Date(key.balance_synced_at).getTime() : 0
    if (now - syncedAt < SYNC_STALE_MS) {
      // fresh — skip
    } else {
      needsSync.push(key)
    }
  }

  // Process needsSync in batches of CONCURRENCY_LIMIT
  const results = new Map<string, { budget_usdc: number; balance_synced_at: string; stale: false }>()

  for (let i = 0; i < needsSync.length; i += CONCURRENCY_LIMIT) {
    const batch = needsSync.slice(i, i + CONCURRENCY_LIMIT)
    const settled = await Promise.allSettled(
      batch.map(async (key) => {
        const balance = await getKeyBalanceOnChain(key.key_hash)
        return { id: key.id, balance }
      })
    )
    for (let j = 0; j < batch.length; j++) {
      const key = batch[j]
      const result = settled[j]
      if (!key || !result) continue
      if (result.status === 'fulfilled') {
        const syncedAtStr = new Date().toISOString()
        results.set(key.id, { budget_usdc: result.value.balance, balance_synced_at: syncedAtStr, stale: false })
        // Persist to DB (fire and forget — don't block response)
        serviceClient.from('agent_keys').update({
          budget_usdc: result.value.balance,
          balance_synced_at: syncedAtStr,
        }).eq('id', key.id).then(({ error }) => {
          if (error) logger.warn('[GET agent-keys] DB sync update failed', { keyId: key.id, error })
        })
      }
      // if rejected → will return stale from original key data
    }
  }

  return keys.map(key => {
    const synced = results.get(key.id)
    if (synced) {
      return { ...key, budget_usdc: synced.budget_usdc, balance_synced_at: synced.balance_synced_at, stale: false }
    }
    // fresh or RPC-failed → return cached value
    const syncedMs = key.balance_synced_at ? new Date(key.balance_synced_at).getTime() : 0
    const isStale = !key.key_hash || (now - syncedMs >= SYNC_STALE_MS)
    return { ...key, stale: isStale } as KeyWithMeta
  })
}

export async function GET() {
  try {
    const keys = await getAgentKeys()
    const enriched = await syncKeysOnChain(keys)
    // WAS-141: key_hash (SHA-256, not raw key) exposed to owner for on-chain withdrawKey call
    // raw_key is never stored — key_hash is safe to expose to authenticated owner
    // P-11: Private cache — user-specific data, 30s browser cache
    return NextResponse.json(enriched.map(k => ({ ...k })), {
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
    // safeParse → uniform 400; raw Zod issues stay server-side (don't leak the
    // schema shape / field names to the client).
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return jsonError('invalid_request', 'Invalid request body', 400, {
        logDetail: parsed.error.issues,
      })
    }
    const { name, budget_usdc } = parsed.data
    const key = await createAgentKey(name, budget_usdc)
    // Return raw key ONCE — never retrievable again
    return NextResponse.json({
      ...key,
      key_hash: undefined,
      message: 'Save this key — it will not be shown again',
    }, { status: 201 })
  } catch (err) {
    return jsonError('agent_key_create_failed', 'Could not create agent key', 400, {
      logDetail: err,
    })
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
