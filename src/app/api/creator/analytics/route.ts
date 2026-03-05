/**
 * GET /api/creator/analytics
 *
 * Returns analytics for the authenticated creator:
 * - Summary metrics (calls, latency, uptime, earnings)
 * - Daily calls series (last 30 days)
 * - Health alerts per agent
 *
 * HU-1.4: Creator Analytics
 * ISR: 5-minute cache
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getPublicClient } from '@/shared/lib/web3/client'
import { WASIAI_MARKETPLACE_ABI } from '@/lib/contracts/WasiAIMarketplace'
import { buildDailySeries, buildEmptyDailySeries } from '@/features/creator/lib/analytics'
import { formatUnits } from 'viem'
import { z } from 'zod'

// WAS-56: force-dynamic — esta route usa cookies (auth) y nunca debe ser cacheada.
// revalidate=300 causaba que Next.js sirviera respuestas stale/vacías en algunos deploys.
export const dynamic = 'force-dynamic'

const QuerySchema = z.object({
  agent_id: z.string().uuid().optional(),
})

interface AgentRow {
  id: string
  name: string
}

interface CallStatusRow {
  status: string
}

interface CallLatencyRow {
  latency_ms: number | null
}

interface CallDateRow {
  called_at: string
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const parsed = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_params' }, { status: 400 })

  const svc = createServiceClient()

  // Obtener creator profile (creator_profiles.id = auth.users.id)
  const { data: profile } = await svc
    .from('creator_profiles')
    .select('id, pending_earnings_usdc, wallet_address')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 })

  // WAS-56: Obtener TODOS los agentes del creator (sin filtrar por status activo)
  // para que analytics muestre datos aunque el agente esté en draft/pending/etc.
  const { data: agentsData } = await svc
    .from('agents')
    .select('id, name')
    .eq('creator_id', profile.id)

  const agents: AgentRow[] = agentsData ?? []

  // Filtrar por agent_id si se especifica
  let agentIds: string[]
  if (parsed.data.agent_id) {
    if (!agents.find(a => a.id === parsed.data.agent_id)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    agentIds = [parsed.data.agent_id]
  } else {
    agentIds = agents.map(a => a.id)
  }

  if (agentIds.length === 0) {
    return NextResponse.json({
      summary: {
        totalCalls: 0,
        calls24h: 0,
        avgLatencyMs: 0,
        errorRate: null,
        uptime24h: null,
        pendingEarningsUsdc: String(profile.pending_earnings_usdc ?? '0'),
        onchainEarningsUsdc: null,
      },
      dailySeries: buildEmptyDailySeries(),
      alerts: [],
    })
  }

  const now = Date.now()
  const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString()
  const since7d  = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
  const since30d = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()

  // ─── Queries en paralelo ──────────────────────────────────────────────────

  const [
    { count: totalCalls },
    { count: calls24h },
    { data: latencyData },
    { data: last100 },
    { count: errors24hCount },
    { data: rawSeries },
  ] = await Promise.all([
    svc.from('agent_calls').select('id', { count: 'exact', head: true }).in('agent_id', agentIds),
    svc.from('agent_calls').select('id', { count: 'exact', head: true }).in('agent_id', agentIds).gte('called_at', since24h),
    svc.from('agent_calls').select('latency_ms').in('agent_id', agentIds).order('called_at', { ascending: false }).limit(100),
    svc.from('agent_calls').select('status').in('agent_id', agentIds).order('called_at', { ascending: false }).limit(100),
    svc.from('agent_calls').select('id', { count: 'exact', head: true }).in('agent_id', agentIds).eq('status', 'error').gte('called_at', since24h),
    svc.from('agent_calls').select('called_at').in('agent_id', agentIds).gte('called_at', since30d),
  ])

  // Latencia promedio (últimas 100 calls)
  const avgLatencyMs = latencyData && latencyData.length > 0
    ? Math.round(
        (latencyData as CallLatencyRow[]).reduce((sum, r) => sum + (r.latency_ms ?? 0), 0) / latencyData.length
      )
    : 0

  // Error rate (últimas 100 calls)
  const last100Errors = last100
    ? (last100 as CallStatusRow[]).filter(r => r.status === 'error').length
    : 0
  const errorRate = last100 && last100.length > 0 ? last100Errors / last100.length : null

  // Uptime 24h
  const uptime24h = (calls24h ?? 0) > 0
    ? 1 - ((errors24hCount ?? 0) / (calls24h ?? 1))
    : null

  // Daily series — agrupar por día en JS
  const dailySeries = buildDailySeries(rawSeries as CallDateRow[] | null)

  // ─── Alertas por agente (batch: 3 queries totales en vez de 3N) ──────────
  const alerts: Array<{ type: string; agentId: string; agentName: string; message: string }> = []

  const filteredAgents = agents.filter(a => agentIds.includes(a.id))

  if (filteredAgents.length > 0) {
    // 3 queries batch con IN(agentIds) — agrupar por agent_id en JS
    const [
      { data: calls24hRows },
      { data: errors24hRows },
      { data: calls7dRows },
    ] = await Promise.all([
      svc.from('agent_calls').select('agent_id').in('agent_id', agentIds).gte('called_at', since24h),
      svc.from('agent_calls').select('agent_id').in('agent_id', agentIds).eq('status', 'error').gte('called_at', since24h),
      svc.from('agent_calls').select('agent_id').in('agent_id', agentIds).gte('called_at', since7d),
    ])

    // Agrupar conteos por agent_id en memoria
    const countByAgentId = (rows: { agent_id: string }[] | null): Record<string, number> => {
      const map: Record<string, number> = {}
      for (const row of rows ?? []) {
        map[row.agent_id] = (map[row.agent_id] ?? 0) + 1
      }
      return map
    }

    const calls24hMap  = countByAgentId(calls24hRows  as { agent_id: string }[] | null)
    const errors24hMap = countByAgentId(errors24hRows as { agent_id: string }[] | null)
    const calls7dMap   = countByAgentId(calls7dRows   as { agent_id: string }[] | null)

    for (const agent of filteredAgents) {
      const agentCalls24h  = calls24hMap[agent.id]  ?? 0
      const agentErrors24h = errors24hMap[agent.id] ?? 0
      const agentCalls7d   = calls7dMap[agent.id]   ?? 0

      if (agentCalls24h > 0 && agentErrors24h / agentCalls24h > 0.2) {
        alerts.push({
          type: 'high_error_rate',
          agentId: agent.id,
          agentName: agent.name,
          // i18n key resolved client-side: analytics.alertHighError
          message: `analytics.alertHighError:${agent.name}`,
        })
      }

      if (agentCalls7d === 0) {
        alerts.push({
          type: 'no_activity',
          agentId: agent.id,
          agentName: agent.name,
          // i18n key resolved client-side: analytics.alertNoActivity
          message: `analytics.alertNoActivity:${agent.name}`,
        })
      }
    }
  }

  // ─── Earnings on-chain ────────────────────────────────────────────────────
  let onchainEarningsUsdc: string | null = null
  if (profile.wallet_address) {
    try {
      const client = getPublicClient()
      const contractAddress = process.env.MARKETPLACE_ADDRESS as `0x${string}` | undefined
      if (contractAddress) {
        const raw = await client.readContract({
          address: contractAddress,
          abi: WASIAI_MARKETPLACE_ABI,
          functionName: 'getPendingEarnings',
          args: [profile.wallet_address as `0x${string}`],
        })
        onchainEarningsUsdc = formatUnits(raw as bigint, 6)
      }
    } catch {
      // Ignorar errores on-chain — no bloquean la respuesta
    }
  }

  return NextResponse.json({
    summary: {
      totalCalls: totalCalls ?? 0,
      calls24h: calls24h ?? 0,
      avgLatencyMs,
      errorRate,
      uptime24h,
      pendingEarningsUsdc: String(profile.pending_earnings_usdc ?? '0'),
      onchainEarningsUsdc,
    },
    dailySeries,
    alerts,
  })
}


