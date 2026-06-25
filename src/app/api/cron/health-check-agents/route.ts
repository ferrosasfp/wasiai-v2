/**
 * GET /api/cron/health-check-agents
 *
 * WAS-281: Periodic health probe for all active agents.
 * Runs every hour. Updates consecutive_failures, health_check, last_checked_at.
 * Marks agents as reviewing after 3 consecutive failures.
 * Reactivates reviewing agents that pass the probe.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { probeEndpointSync } from '@/lib/agents/health-probe'
import { logger } from '@/lib/logger'
import { jsonError } from '@/lib/api/jsonError'

export const runtime = 'nodejs'
export const maxDuration = 120  // Consistent with other crons in this repo (reconcile-onchain, etc.)

const BATCH_SIZE = 10
const FAILURE_THRESHOLD = 3

export async function GET(req: Request) {
  // Auth — same pattern as all other crons
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const svc = createServiceClient()

  // Fetch agents to check: active ones + reviewing ones (to reactivate if recovered)
  // Only agents with endpoint_url — skip internal/null endpoint agents
  const { data: agents, error } = await svc
    .from('agents')
    .select('id, slug, endpoint_url, status, consecutive_failures')
    .in('status', ['active', 'reviewing'])
    .not('endpoint_url', 'is', null)
    .order('last_checked_at', { ascending: true, nullsFirst: true })  // prioritize never-checked
    .limit(BATCH_SIZE)

  if (error) {
    return jsonError('read_failed', 'Failed to fetch agents', 500, { logDetail: error })
  }

  let checked = 0, passed = 0, failed = 0, reactivated = 0

  for (const agent of (agents ?? [])) {
    try {
      const result = await probeEndpointSync(agent.endpoint_url!)
      checked++

      if (result.passed) {
        passed++
        const wasReviewing = agent.status === 'reviewing'
        await svc.from('agents').update({
          consecutive_failures: 0,
          health_check:    result.healthCheck,
          last_checked_at: new Date().toISOString(),
          // Reactivate only if it was in reviewing AND had failures (not manually paused)
          ...(wasReviewing && agent.consecutive_failures > 0 ? { status: 'active' } : {}),
        }).eq('id', agent.id)

        if (wasReviewing && agent.consecutive_failures > 0) reactivated++
      } else {
        failed++
        const newFailures = (agent.consecutive_failures ?? 0) + 1
        const shouldDegrade = newFailures >= FAILURE_THRESHOLD

        await svc.from('agents').update({
          consecutive_failures: newFailures,
          health_check:    result.healthCheck,
          last_checked_at: new Date().toISOString(),
          ...(shouldDegrade ? { status: 'reviewing' } : {}),
        }).eq('id', agent.id)

        logger.warn('[health-cron] Agent probe failed', {
          slug: agent.slug,
          consecutive_failures: newFailures,
          degraded: shouldDegrade,
          reason: result.healthCheck.reason,
        })
      }
    } catch (err) {
      logger.error('[health-cron] Unexpected error probing agent', {
        slug: agent.slug,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({ checked, passed, failed, reactivated })
}
