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

const FACILITATOR_URL = 'https://facilitator.ultravioletadao.xyz'
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl

  const category   = searchParams.get('category')
  const agentType  = searchParams.get('agent_type')
  const q          = searchParams.get('q')
  const maxPrice   = searchParams.get('max_price')
  const limit      = Math.min(Number(searchParams.get('limit')  ?? 20), 100)
  const offset     = Number(searchParams.get('offset') ?? 0)

  const supabase = await createClient()

  let query = supabase
    .from('agents')                        // renamed from models in migration 006
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
    `)
    .eq('status', 'active')
    .order('is_featured', { ascending: false })
    .order('total_calls',  { ascending: false })
    .range(offset, offset + limit - 1)

  if (category)  query = query.eq('category',   category)
  if (agentType) query = query.eq('agent_type', agentType)
  if (q)         query = query.or(`name.ilike.%${q}%,description.ilike.%${q}%`)
  if (maxPrice)  query = query.lte('price_per_call', parseFloat(maxPrice))

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const contractAddress = getMarketplaceAddress(CHAIN_ID)

  return NextResponse.json({
    schema:  'wasiai/agents/v1',
    total:   count ?? (data?.length ?? 0),
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
      chain:          'avalanche',
      chain_id:       43114,
      invoke_url:     `https://wasiai.io/api/v1/agents/${agent.slug}/invoke`,

      // Payment info for x402 clients
      payment: {
        protocol:    'x402',
        price:       agent.price_per_call,
        currency:    'USDC',
        facilitator: FACILITATOR_URL,
        contract:    contractAddress,
      },

      // MCP integration
      mcp: {
        tool_name:   agent.mcp_tool_name ?? agent.slug.replace(/-/g, '_'),
        description: agent.mcp_description ?? agent.description,
        endpoint:    `https://wasiai.io/api/v1/mcp`,
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
  })
}
