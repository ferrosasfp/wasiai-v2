/**
 * GET /api/v1/agents/[slug]
 * Returns full details for a single agent by slug.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMarketplaceAddress } from '@/lib/contracts/WasiAIMarketplace'
import { CHAIN_ID, CHAIN_NAME } from '@/lib/chain'  // HAL-016: single source of truth

import { SITE_URL } from '@/lib/constants'
import { resolveExampleInput } from '@/features/agents/utils/resolveExampleInput'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const supabase = await createClient()

    const { data: agent, error } = await supabase
      .from('agents')
      .select(`
        id, slug, name, description, category, agent_type, status,
        price_per_call, cover_image, is_featured,
        endpoint_url, mcp_tool_name, capabilities, input_schema, output_schema,
        total_calls, total_revenue, reputation_score, reputation_count, performance_score,
        sandbox_enabled, metadata,
        created_at,
        creator:creator_profiles(id, username, display_name, avatar_url, verified)
      `)
      .eq('slug', slug)
      .eq('status', 'active')
      .single()

    // Error de Supabase (red, auth, etc.) → 503
    if (error && error.code !== 'PGRST116') {
      console.error('[agents/slug] Supabase error:', error.message)
      return NextResponse.json(
        { error: 'internal_error', message: 'Service temporarily unavailable' },
        { status: 503, headers: CORS }
      )
    }

    // Not found (PGRST116 = no rows) → 404
    if (!agent) {
      return NextResponse.json(
        { error: 'not_found', message: `Agent not found: ${slug}` },
        { status: 404, headers: CORS }
      )
    }

    // WAS-183: fetch p50/p95/error_rate metrics via RPC (no N+1)
    interface AgentPercentileMetrics {
      p50_latency_ms:    number | null
      p95_latency_ms:    number | null
      error_rate_7d:     number | null
      error_rate_sample: number | null
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metricsQuery = supabase.rpc('get_agent_percentile_metrics', { p_agent_id: agent.id }) as any
    const { data: metrics }: { data: AgentPercentileMetrics | null } = await metricsQuery.single()

    const contractAddress = getMarketplaceAddress(CHAIN_ID)

    const body = {
      slug:         agent.slug,
      name:         agent.name,
      description:  agent.description,
      category:     agent.category,
      agent_type:   agent.agent_type,
      is_featured:  agent.is_featured,
      cover_image:  agent.cover_image,
      price_per_call: agent.price_per_call,
      currency:     'USDC',
      chain:        CHAIN_NAME,
      chain_id:     CHAIN_ID,
      invoke_url:   `${SITE_URL}/api/v1/models/${agent.slug}/invoke`,
      payment: {
        protocol:    'x402',
        price:       agent.price_per_call,
        currency:    'USDC',
        settlement:  'wasiai-native',
        contract:    contractAddress,
      },
      mcp: {
        tool_name:   agent.mcp_tool_name ?? agent.slug.replace(/-/g, '_'),
        description: agent.description,
        endpoint:    `${SITE_URL}/api/v1/mcp`,
      },
      reputation: {
        score: agent.reputation_score,
        count: agent.reputation_count ?? 0,
      },
      performance_score: agent.performance_score ?? null, // WAS-213
      stats: {
        total_calls:   agent.total_calls ?? 0,
        total_revenue: Number(agent.total_revenue ?? 0),
      },
      example_input: resolveExampleInput(agent),
      input_schema:  agent.input_schema ?? null,
      output_schema: agent.output_schema ?? null,
      sandbox_enabled: agent.sandbox_enabled ?? true,
      creator: agent.creator ?? null,
      created_at: agent.created_at,
      p50_latency_ms:         metrics?.p50_latency_ms ?? null,
      p95_latency_ms:         metrics?.p95_latency_ms ?? null,
      error_rate_7d:          metrics?.error_rate_7d ?? null,
      error_rate_sample_size: metrics?.error_rate_sample ?? null,
    }

    return NextResponse.json(body, { status: 200, headers: CORS })
  } catch (err) {
    console.error('[agents/slug] Unexpected error:', err)
    return NextResponse.json(
      { error: 'internal_error', message: 'Service temporarily unavailable' },
      { status: 503, headers: CORS }
    )
  }
}
