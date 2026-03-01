/**
 * GET /api/v1/agents
 *
 * Machine-readable agent discovery for AI agents, MCP clients, and humans.
 * Alias of /api/v1/models with additional agent-specific fields.
 *
 * Query params:
 *   category    → filter by category
 *   agent_type  → filter by type: model | agent | workflow
 *   q           → semantic search (name + description)
 *   max_price   → max price per call in USDC
 *   limit       → results per page (default 20, max 100)
 *   offset      → pagination offset
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMarketplaceAddress } from '@/lib/contracts/WasiAIMarketplace'
import { CHAIN_ID, CHAIN_NAME } from '@/lib/chain'  // HAL-016: single source of truth
import { getSearchLimit, getIdentifier, checkRateLimit } from '@/lib/ratelimit'

// WasiAI handles x402 settlement natively — no external facilitator
import { SITE_URL } from '@/lib/constants'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl

  const category   = searchParams.get('category')
  const agentType  = searchParams.get('agent_type')
  const q          = searchParams.get('q')
  const maxPrice   = searchParams.get('max_price')
  const limit      = Math.min(Number(searchParams.get('limit')  ?? 20), 100)
  const offset     = Number(searchParams.get('offset') ?? 0)
  const slim       = searchParams.get('slim') === 'true' // PERF-05: lightweight mode

  const supabase = await createClient()

  // Full-text search via RPC when q is present and meaningful
  if (q && q.length >= 2) {
    const rlResp = await checkRateLimit(getSearchLimit(), getIdentifier(request))
    if (rlResp) return rlResp

    const { data: searchData, error: searchError } = await supabase.rpc('search_agents', {
      search_query:      q,
      filter_category:   category ?? null,
      filter_agent_type: null,
      result_limit:      limit,
      result_offset:     offset,
    })

    if (searchError) {
      return NextResponse.json({ error: searchError.message }, { status: 500 })
    }

    const agents = (searchData ?? []) as Record<string, unknown>[]

    return NextResponse.json({
      schema: 'wasiai/agents/v1',
      total:  agents.length,
      limit,
      offset,
      agents: agents.map(agent => ({
        slug:        agent.slug,
        name:        agent.name,
        description: agent.description,
        category:    agent.category,
        agent_type:  (agent.agent_type as string) ?? 'model',
        ts_rank:     agent.rank,
        price_per_call: agent.price_per_call,
        currency:    'USDC',
        invoke_url:  `${SITE_URL}/api/v1/models/${agent.slug}/invoke`,
      })),
    }, { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-agent-key',
    // P-09: Increased CDN cache time for better performance
    'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
  }

  // PERF-05: slim mode — separate query for lightweight response
  if (slim) {
    let slimQuery = supabase
      .from('agents')
      .select('slug, name, description, category, agent_type, price_per_call, is_featured, mcp_tool_name', { count: 'exact' })
      .eq('status', 'active')
      .order('is_featured', { ascending: false })
      .order('total_calls', { ascending: false })
      .range(offset, offset + limit - 1)

    if (category)  slimQuery = slimQuery.eq('category', category)
    if (agentType) slimQuery = slimQuery.eq('agent_type', agentType)
    if (maxPrice)  slimQuery = slimQuery.lte('price_per_call', parseFloat(maxPrice))

    const { data: slimData, count: slimCount } = await slimQuery

    return NextResponse.json({
      schema: 'wasiai/agents/v1',
      total: slimCount ?? (slimData?.length ?? 0), limit, offset,
      agents: (slimData ?? []).map(a => ({
        slug:           a.slug,
        name:           a.name,
        description:    a.description,
        category:       a.category,
        agent_type:     a.agent_type ?? 'model',
        price_per_call: a.price_per_call,
        invoke_url:     `${SITE_URL}/api/v1/models/${a.slug}/invoke`,
        mcp_tool_name:  a.mcp_tool_name ?? a.slug.replace(/-/g, '_'),
        featured:       a.is_featured,
      })),
    }, { headers: CORS })
  }

  // HAL-028: endpoint_url excluido explícitamente del select — URL privada del creator
  // no debe ser visible en el discovery público
  let query = supabase
    .from('agents')
    .select(`
      id, slug, name, description, category,
      agent_type, dependencies,
      price_per_call, currency, chain,
      capabilities, mcp_tool_name, mcp_description,
      total_calls, total_revenue,
      on_chain_registered, erc8004_id,
      reputation_score, reputation_count,
      is_featured, created_at,
      creator:creator_profiles(
        id, username, display_name, verified, wallet_address
      )
    `, { count: 'exact' })
    .eq('status', 'active')
    .order('is_featured', { ascending: false })
    .order('total_calls',  { ascending: false })
    .range(offset, offset + limit - 1)

  if (category)  query = query.eq('category',   category)
  if (agentType) query = query.eq('agent_type', agentType)
  if (maxPrice)  query = query.lte('price_per_call', parseFloat(maxPrice))

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const baseUrl = `${request.nextUrl.origin}/api/v1/agents`
  const buildLink = (o: number, rel: string) => {
    const p = new URLSearchParams()
    if (category)  p.set('category',   category)
    if (agentType) p.set('agent_type', agentType)
    if (q)         p.set('q',          q)
    if (maxPrice)  p.set('max_price',  maxPrice)
    p.set('limit',  String(limit))
    p.set('offset', String(o))
    return `<${baseUrl}?${p}>; rel="${rel}"`
  }

  const total = count ?? (data?.length ?? 0)
  const linkParts: string[] = []
  if (offset > 0) linkParts.push(buildLink(Math.max(0, offset - limit), 'prev'))
  if (offset + limit < total) linkParts.push(buildLink(offset + limit, 'next'))

  const corsWithPagination = {
    ...CORS,
    'X-Total-Count': String(total),
    ...(linkParts.length > 0 ? { 'Link': linkParts.join(', ') } : {}),
  }

  const contractAddress = getMarketplaceAddress(CHAIN_ID)

  return NextResponse.json({
    schema:  'wasiai/agents/v1',
    total,
    limit,
    offset,
    agents: (data ?? []).map(agent => ({
      slug:        agent.slug,
      name:        agent.name,
      description: agent.description,
      category:    agent.category,
      agent_type:  agent.agent_type ?? 'model',
      dependencies: agent.dependencies ?? [],

      // Pricing & payment
      price_per_call: agent.price_per_call,
      currency:       'USDC',
      chain:          CHAIN_NAME,
      chain_id:       CHAIN_ID,
      invoke_url:     `${SITE_URL}/api/v1/models/${agent.slug}/invoke`,

      // Payment info for x402 clients
      payment: {
        protocol:   'x402',
        price:      agent.price_per_call,
        currency:   'USDC',
        settlement: 'wasiai-native',
        contract:   contractAddress,
      },

      // MCP integration
      mcp: {
        tool_name:   agent.mcp_tool_name ?? agent.slug.replace(/-/g, '_'),
        description: agent.mcp_description ?? agent.description,
        endpoint:    `${SITE_URL}/api/v1/mcp`,
      },

      // On-chain identity
      identity: {
        on_chain_registered: agent.on_chain_registered ?? false,
        erc8004_id:          agent.erc8004_id ?? null,
        marketplace:         contractAddress,
      },

      // Reputation
      reputation: {
        score: agent.reputation_score ?? null,
        count: agent.reputation_count ?? 0,
      },

      // Stats
      stats: {
        total_calls:   agent.total_calls,
        total_revenue: agent.total_revenue,
        featured:      agent.is_featured,
      },

      creator: (() => {
        const c = Array.isArray(agent.creator) ? agent.creator[0] : agent.creator
        return c ? { username: c.username, display_name: c.display_name, verified: c.verified } : null
      })(),
    })),
  }, { headers: corsWithPagination })
}

// OPTIONS for CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-agent-key',
    },
  })
}
