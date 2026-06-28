/**
 * GET /api/v1/agents/[slug]
 * Returns full details for a single agent by slug.
 *
 * PATCH /api/v1/agents/[slug]
 * Updates editable fields for an agent. Auth: JWT or x-agent-key. WAS-260.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getMarketplaceAddress } from '@/lib/contracts/WasiAIMarketplace'
import { CHAIN_ID, CHAIN_NAME } from '@/lib/chain'  // HAL-016: single source of truth

import { SITE_URL } from '@/lib/constants'
import { getCachedGasOverhead } from '@/lib/pricing/overhead'
import { resolveExampleInput } from '@/features/agents/utils/resolveExampleInput'
import { validateEndpointUrlAsync } from '@/lib/security/validateEndpointUrl'
import { metaValidateSchema } from '@/lib/schema-validator'
import { buildExampleFromSchema } from '@/features/agents/utils/buildExampleFromSchema'
import { z } from 'zod'
import { logger } from '@/lib/logger'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-agent-key',
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
      logger.error('[agents/slug] Supabase error', { detail: error.message })
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
    const { data: metricsRaw } = await supabase
      .rpc('get_agent_percentile_metrics', { p_agent_id: agent.id })
      .single()
    const metrics = metricsRaw as AgentPercentileMetrics | null

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

    const gasCache = await getCachedGasOverhead()
    const estimated_total_cost = gasCache
      ? Math.round((Number(agent.price_per_call) + gasCache.overhead) * 1_000_000) / 1_000_000
      : null

    return NextResponse.json({ ...body, estimated_total_cost }, { status: 200, headers: CORS })
  } catch (err) {
    logger.error('[agents/slug] Unexpected error', { err })
    return NextResponse.json(
      { error: 'internal_error', message: 'Service temporarily unavailable' },
      { status: 503, headers: CORS }
    )
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/agents/[slug] — WAS-260
// ---------------------------------------------------------------------------

const PatchAgentSchema = z.object({
  name:               z.string().min(1).max(100).optional(),
  description:        z.string().max(2000).optional(),
  category:           z.string().max(50).optional(),
  price_per_call:     z.number().min(0.001).max(100).optional(),
  endpoint_url:       z.string().url().optional(),
  tags:               z.array(z.string()).optional(),
  input_schema:       z.record(z.string(), z.unknown()).optional(),
  output_schema:      z.record(z.string(), z.unknown()).optional(),
  max_rpm:            z.number().int().positive().optional(),
  max_rpd:            z.number().int().positive().optional(),
  mcp_description:    z.string().max(500).optional(),
  sandbox_enabled:    z.boolean().optional(),
  free_trial_enabled: z.boolean().optional(),
  free_trial_limit:   z.number().int().nonnegative().optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const PATCH_CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-agent-key',
  }

  try {
    const { slug } = await params
    const service = createServiceClient()

    // ── Auth ──────────────────────────────────────────────────────────────
    let requesterId: string | null = null

    const agentKeyHeader = req.headers.get('x-agent-key')
    if (agentKeyHeader) {
      // Lookup agent key → owner_id (hash the raw key first)
      const { createHash } = await import('crypto')
      const keyHash = createHash('sha256').update(agentKeyHeader).digest('hex')
      const { data: keyRow, error: keyErr } = await service
        .from('agent_keys')
        .select('owner_id')
        .eq('key_hash', keyHash)
        .eq('is_active', true)
        .single()
      if (keyErr || !keyRow) {
        return NextResponse.json(
          { error: 'unauthorized', message: 'Invalid agent key' },
          { status: 401, headers: PATCH_CORS }
        )
      }
      requesterId = keyRow.owner_id
    } else {
      // JWT via createClient (reads cookies/headers)
      const supabase = await createClient()
      const { data: { user }, error: authErr } = await supabase.auth.getUser()
      if (authErr || !user) {
        return NextResponse.json(
          { error: 'unauthorized', message: 'Authentication required' },
          { status: 401, headers: PATCH_CORS }
        )
      }
      requesterId = user.id
    }

    // ── Load agent ────────────────────────────────────────────────────────
    const { data: agent, error: agentErr } = await service
      .from('agents')
      .select('id, slug, creator_id, metadata')
      .eq('slug', slug)
      .single()

    if (agentErr || !agent) {
      return NextResponse.json(
        { error: 'not_found', message: `Agent not found: ${slug}` },
        { status: 404, headers: PATCH_CORS }
      )
    }

    // ── Ownership check ───────────────────────────────────────────────────
    if (requesterId !== agent.creator_id) {
      return NextResponse.json(
        { error: 'forbidden', message: 'You do not own this agent' },
        { status: 403, headers: PATCH_CORS }
      )
    }

    // ── Parse body ────────────────────────────────────────────────────────
    let rawBody: unknown
    try {
      rawBody = await req.json()
    } catch {
      return NextResponse.json(
        { error: 'bad_request', message: 'Invalid JSON body' },
        { status: 400, headers: PATCH_CORS }
      )
    }

    const parsed = PatchAgentSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'validation_error', message: parsed.error.message },
        { status: 422, headers: PATCH_CORS }
      )
    }
    const fields = parsed.data

    // ── Field validations ─────────────────────────────────────────────────
    if (fields.endpoint_url !== undefined) {
      try {
        await validateEndpointUrlAsync(fields.endpoint_url)
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Invalid endpoint URL'
        return NextResponse.json(
          { error: 'validation_error', message: msg },
          { status: 422, headers: PATCH_CORS }
        )
      }
    }

    if (fields.input_schema !== undefined) {
      const result = metaValidateSchema(fields.input_schema)
      if (!result.valid) {
        return NextResponse.json(
          { error: 'validation_error', message: result.error ?? 'Invalid input_schema' },
          { status: 422, headers: PATCH_CORS }
        )
      }
    }

    // ── Build patch ───────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: Record<string, any> = { ...fields }

    if (fields.input_schema !== undefined) {
      const existingMetadata = (agent.metadata as Record<string, unknown>) ?? {}
      patch.metadata = {
        ...existingMetadata,
        input_example: buildExampleFromSchema(fields.input_schema as Parameters<typeof buildExampleFromSchema>[0]),
      }
    }

    // ── Update ────────────────────────────────────────────────────────────
    const { data: updated, error: updateErr } = await service
      .from('agents')
      .update(patch)
      .eq('slug', slug)
      .select(`
        id, slug, name, description, category, agent_type, status,
        price_per_call, cover_image, endpoint_url, tags,
        input_schema, output_schema, max_rpm, max_rpd, mcp_description,
        sandbox_enabled, free_trial_enabled, free_trial_limit,
        metadata, created_at, updated_at
      `)
      .single()

    if (updateErr || !updated) {
      logger.error('[agents/slug PATCH] Update error', { detail: updateErr?.message })
      return NextResponse.json(
        { error: 'internal_error', message: 'Failed to update agent' },
        { status: 503, headers: PATCH_CORS }
      )
    }

    return NextResponse.json(updated, { status: 200, headers: PATCH_CORS })
  } catch (err) {
    logger.error('[agents/slug PATCH] Unexpected error', { err })
    return NextResponse.json(
      { error: 'internal_error', message: 'Service temporarily unavailable' },
      { status: 503, headers: PATCH_CORS }
    )
  }
}
