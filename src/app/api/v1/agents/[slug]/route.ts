/**
 * GET /api/v1/agents/[slug]
 * Returns full details for a single agent by slug.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMarketplaceAddress } from '@/lib/contracts/WasiAIMarketplace'
import { CHAIN_ID, CHAIN_NAME } from '@/lib/chain'  // HAL-016: single source of truth

import { SITE_URL } from '@/lib/constants'

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
  const { slug } = await params
  const supabase  = await createClient()

  const { data: agent, error } = await supabase
    .from('agents')
    .select(`
      id, slug, name, description, category, agent_type, status,
      price_per_call, cover_image, is_featured,
      endpoint_url, mcp_tool_name, capabilities,
      total_calls, total_revenue, reputation_score, reputation_count,
      created_at,
      creator:creator_profiles(id, username, display_name, avatar_url, verified)
    `)
    .eq('slug', slug)
    .eq('status', 'active')
    .single()

  if (error || !agent) {
    return NextResponse.json(
      { error: 'agent_not_found', message: `No active agent found with slug "${slug}"` },
      { status: 404, headers: CORS }
    )
  }

  const contractAddress = getMarketplaceAddress(CHAIN_ID)

  const body = {
    slug:         agent.slug,
    name:         agent.name,
    description:  agent.description,
    category:     agent.category,
    agent_type:   agent.agent_type,
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
    stats: {
      total_calls:   agent.total_calls ?? 0,
      total_revenue: Number(agent.total_revenue ?? 0),
    },
    creator: agent.creator ?? null,
    created_at: agent.created_at,
  }

  return NextResponse.json(body, { status: 200, headers: CORS })
}
