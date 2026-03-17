/**
 * GET /api/creator/agents/on-chain-status
 *
 * SDD-217 W1.1: Returns which of the creator's active agents are registered on-chain.
 * Response: { registered: string[], unregistered: string[] }
 */
import { NextResponse } from 'next/server'
import { createClient }  from '@/lib/supabase/server'
import { isAgentRegisteredOnChain }       from '@/lib/contracts/marketplaceClient'
import { logger }                         from '@/lib/logger'

const RPC_TIMEOUT_MS = 5_000

/**
 * Wraps isAgentRegisteredOnChain with a per-call timeout.
 * Returns null if the call times out or errors — treated as "unknown".
 */
async function checkRegistration(slug: string): Promise<boolean | null> {
  try {
    const result = await Promise.race([
      isAgentRegisteredOnChain(slug),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), RPC_TIMEOUT_MS)),
    ])
    return result
  } catch {
    return null
  }
}

export async function GET() {
  // 1. Auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. Query active agents for this creator
  const { data: agents, error } = await supabase
    .from('agents')
    .select('slug')
    .eq('creator_id', user.id)
    .eq('status', 'active')

  if (error) {
    logger.error('[on-chain-status] DB error', { error })
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  const slugs = (agents ?? []).map((a: { slug: string }) => a.slug)

  if (slugs.length === 0) {
    return NextResponse.json({ registered: [], unregistered: [] })
  }

  // 3. Check each slug on-chain in parallel (W2.5: Promise.allSettled, 5s timeout per call)
  const results = await Promise.allSettled(slugs.map(checkRegistration))

  const registered: string[]   = []
  const unregistered: string[] = []

  results.forEach((result, idx) => {
    const slug = slugs[idx]
    if (result.status === 'fulfilled') {
      if (result.value === true) {
        registered.push(slug)
      } else if (result.value === false) {
        // Definitively not registered
        unregistered.push(slug)
      }
      // null = unknown (RPC timeout) — omit from both lists
    }
    // rejected (shouldn't happen with inner try/catch) — omit
  })

  logger.info('[on-chain-status] checked', { userId: user.id, registered: registered.length, unregistered: unregistered.length })

  return NextResponse.json({ registered, unregistered })
}
