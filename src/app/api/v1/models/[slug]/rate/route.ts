/**
 * POST /api/v1/models/[slug]/rate
 *
 * ERC-8004 Reputation Registry — submit a thumbs up/down for an agent.
 * Prevents double-voting via upsert on (agent_id, voter_id).
 *
 * Body: { rating: 'up' | 'down', wallet?: string }
 * Returns: { reputation_score, reputation_count, your_vote }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHash }               from 'crypto'
import { z }                        from 'zod'
import { createServiceClient }      from '@/lib/supabase/server'
import { checkRateLimit, getIdentifier, getInvokeLimit } from '@/lib/ratelimit'
import { logger } from '@/lib/logger'

// ── Schema ────────────────────────────────────────────────────────────────────

const rateBodySchema = z.object({
  rating: z.enum(['up', 'down']),
  wallet: z.string().optional(),
})

// ── Route ─────────────────────────────────────────────────────────────────────

interface RouteParams {
  params: Promise<{ slug: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { slug } = await params

  // Rate limit: reuse invoke limiter (60/min per IP)
  const identifier = getIdentifier(request)
  const rl = await checkRateLimit(getInvokeLimit(), identifier)
  if (rl) return rl

  // Parse body
  const raw = await request.json().catch(() => ({}))
  const parsed = rateBodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 }
    )
  }
  const { rating, wallet } = parsed.data
  const ratingValue = rating === 'up' ? 1 : -1

  const supabase = await createServiceClient()

  // Lookup agent
  const { data: agent, error: agentErr } = await supabase
    .from('agents')
    .select('id, reputation_score, reputation_count')
    .eq('slug', slug)
    .eq('status', 'active')
    .single()

  if (agentErr || !agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  // NG-007: Sybil protection — require at least 1 successful invocation before voting
  // Check via x-agent-key header (most reliable: key had to spend budget to invoke)
  const agentKeyHeader = request.headers.get('x-agent-key')
  if (agentKeyHeader) {
    const keyHash = createHash('sha256').update(agentKeyHeader).digest('hex')
    const { data: keyRow } = await supabase
      .from('agent_keys')
      .select('id')
      .eq('key_hash', keyHash)
      .eq('is_active', true)
      .single()

    if (keyRow) {
      const { count } = await supabase
        .from('agent_calls')
        .select('id', { count: 'exact', head: true })
        .eq('agent_id', agent.id)
        .eq('key_id', keyRow.id)
        .eq('status', 'success')

      if (!count || count === 0) {
        return NextResponse.json(
          { error: 'You must invoke this agent at least once before rating it', code: 'no_invocation' },
          { status: 403 }
        )
      }
    }
  }

  // Determine voter_id — wallet address if provided, else hashed IP
  const rawId = wallet?.toLowerCase().trim() ?? getIdentifier(request)
  const voterId = createHash('sha256').update(rawId).digest('hex').slice(0, 32)

  // Upsert vote — prevents double-voting, allows changing vote
  const { error: upsertErr } = await supabase
    .from('agent_ratings')
    .upsert(
      { agent_id: agent.id, voter_id: voterId, rating: ratingValue, updated_at: new Date().toISOString() },
      { onConflict: 'agent_id,voter_id' }
    )

  if (upsertErr) {
    logger.error('[rate] upsert failed', { message: upsertErr.message })
    return NextResponse.json({ error: 'Failed to record vote' }, { status: 500 })
  }

  // Fetch updated score (trigger already ran)
  const { data: updated } = await supabase
    .from('agents')
    .select('reputation_score, reputation_count')
    .eq('id', agent.id)
    .single()

  return NextResponse.json({
    reputation_score: updated?.reputation_score ?? null,
    reputation_count: updated?.reputation_count ?? 0,
    your_vote:        rating,
  })
}

// Allow checking your current vote
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { slug } = await params
  const { searchParams } = new URL(request.url)
  const wallet = searchParams.get('wallet')

  const supabase = await createServiceClient()

  const { data: agent } = await supabase
    .from('agents')
    .select('id, reputation_score, reputation_count')
    .eq('slug', slug)
    .eq('status', 'active')
    .single()

  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let yourVote: 'up' | 'down' | null = null

  if (wallet) {
    const voterId = createHash('sha256')
      .update(wallet.toLowerCase().trim())
      .digest('hex').slice(0, 32)

    const { data: existing } = await supabase
      .from('agent_ratings')
      .select('rating')
      .eq('agent_id', agent.id)
      .eq('voter_id', voterId)
      .single()

    if (existing) yourVote = existing.rating === 1 ? 'up' : 'down'
  }

  return NextResponse.json({
    reputation_score: agent.reputation_score,
    reputation_count: agent.reputation_count,
    your_vote:        yourVote,
  })
}
