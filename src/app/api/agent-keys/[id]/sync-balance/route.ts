/**
 * POST /api/agent-keys/[id]/sync-balance
 *
 * Sincroniza budget_usdc en la DB con el balance real on-chain.
 * Útil cuando un withdrawKey on-chain exitoso no actualizó la DB
 * (timeout, CSRF fallo, UI se colgó, etc.).
 *
 * Auth: usuario autenticado + dueño de la key.
 * No requiere txHash — lee el balance on-chain directamente.
 *
 * WAS-218: Rate limit 1 req/key/30s. Returns balance_synced_at.
 */
import { NextRequest, NextResponse }         from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logger }                            from '@/lib/logger'
import { getKeyBalanceOnChain }              from '@/lib/contracts/marketplaceClient'
import { checkRateLimit }                    from '@/lib/ratelimit'
import { Ratelimit }                         from '@upstash/ratelimit'
import { Redis }                             from '@upstash/redis'

// 1 req/key/30s rate limiter
let _syncLimit: Ratelimit | null = null
function getSyncLimit(): Ratelimit {
  return _syncLimit ??= new Ratelimit({
    redis: new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    }),
    limiter: Ratelimit.slidingWindow(1, '30 s'),
    prefix:  'rl:sync',
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Rate limit: 1 req/key/30s
  const rlHit = await checkRateLimit(getSyncLimit(), `${user.id}:${id}`)
  if (rlHit) return rlHit

  const { data: keyRow } = await supabase
    .from('agent_keys')
    .select('id, key_hash, budget_usdc, balance_synced_at, is_active, owner_id')
    .eq('id', id)
    .eq('owner_id', user.id)
    .single()

  if (!keyRow)          return NextResponse.json({ error: 'Key not found' }, { status: 404 })
  if (!keyRow.key_hash) return NextResponse.json({ error: 'Key has no hash' }, { status: 500 })

  // Read balance on-chain
  let onChainBalance: number
  try {
    onChainBalance = await getKeyBalanceOnChain(keyRow.key_hash)
  } catch (err) {
    logger.error('[sync-balance] on-chain read failed', { err: String(err).slice(0, 200) })
    return NextResponse.json({ error: 'Failed to read on-chain balance' }, { status: 500 })
  }

  const balanceSyncedAt = new Date().toISOString()
  const serviceClient = createServiceClient()

  const { error: updateError } = await serviceClient
    .from('agent_keys')
    .update({
      budget_usdc: onChainBalance,
      balance_synced_at: balanceSyncedAt,
      is_active: onChainBalance > 0 || keyRow.is_active,
    })
    .eq('id', id)

  if (updateError) {
    logger.error('[sync-balance] DB update failed', { updateError })
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 })
  }

  logger.info('[sync-balance] synced', { keyId: id, onChainBalance })
  return NextResponse.json({
    budget_usdc: onChainBalance,
    balance_synced_at: balanceSyncedAt,
    stale: false,
  })
}
