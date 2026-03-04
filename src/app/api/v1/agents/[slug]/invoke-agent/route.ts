/**
 * POST /api/v1/agents/[slug]/invoke-agent
 *
 * WAS-140: Pago autónomo agente→agente.
 * El agente [slug] invoca a targetSlug, pagando con su agentWallet.
 *
 * Auth: x-agent-key del creator (budget-based, igual que invoke Route A)
 * El creator autoriza las llamadas A2A de su agente con su API key.
 */
import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { invokeAgentWithPayment, AgentPayError } from '@/lib/agent-wallets/agentPay'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const BodySchema = z.object({
  targetSlug: z.string().min(1).max(64),
  input:      z.string().min(1).max(10000),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug: callerSlug } = await params
  const supabase = createServiceClient()

  // ── 1. Auth: x-agent-key del creator (CD-10) ─────────────────────────────
  const rawKey = req.headers.get('x-agent-key')
  if (!rawKey) {
    return NextResponse.json({ error: 'Missing x-agent-key header' }, { status: 401 })
  }

  const keyHash = createHash('sha256').update(rawKey).digest('hex')
  const { data: keyRow } = await supabase
    .from('agent_keys')
    .select('id, owner_id, is_active')
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .single()

  if (!keyRow) {
    return NextResponse.json({ error: 'Invalid or inactive agent key' }, { status: 401 })
  }

  // ── 2. Lookup caller agent — ownership check ──────────────────────────────
  const { data: callerAgent } = await supabase
    .from('agents')
    .select('id, slug, status, creator_id')
    .eq('slug', callerSlug)
    .single()

  if (!callerAgent) {
    return NextResponse.json({ error: 'Caller agent not found' }, { status: 404 })
  }

  if (callerAgent.creator_id !== keyRow.owner_id) {
    return NextResponse.json({ error: 'Forbidden — key does not belong to this agent\'s creator' }, { status: 403 })
  }

  if (callerAgent.status !== 'active') {
    return NextResponse.json({ error: 'Caller agent is not active' }, { status: 503 })
  }

  // ── 3. Validate body ──────────────────────────────────────────────────────
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body', details: parsed.error.issues }, { status: 400 })
  }

  const { targetSlug, input } = parsed.data

  // Prevent self-invocation loop
  if (targetSlug === callerSlug) {
    return NextResponse.json({ error: 'Agent cannot invoke itself' }, { status: 400 })
  }

  // ── 4. Invoke with payment ────────────────────────────────────────────────
  try {
    const result = await invokeAgentWithPayment(callerAgent.id, targetSlug, input)
    return NextResponse.json(result)

  } catch (err) {
    if (err instanceof AgentPayError) {
      // CD-6: mapear códigos tipados a HTTP status
      const statusMap: Record<AgentPayError['code'], number> = {
        no_agent_wallet:      402,
        insufficient_balance: 402,
        target_not_found:     404,
        probe_failed:         502,
        payment_failed:       502,
      }

      logger.warn('[invoke-agent] AgentPayError', {
        code:        err.code,
        callerSlug,
        targetSlug,
        message:     err.message,
      })

      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: statusMap[err.code] },
      )
    }

    logger.error('[invoke-agent] unhandled error', { err, callerSlug, targetSlug })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
