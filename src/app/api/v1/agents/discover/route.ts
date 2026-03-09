/**
 * GET /api/v1/agents/discover
 * CM-04: Agent-to-Agent Discovery — public endpoint for autonomous agents
 * to discover and invoke other agents programmatically.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const discoverSchema = z.object({
  category:   z.string().optional(),
  max_price:  z.coerce.number().positive().optional(),
  capability: z.string().optional(),
  limit:      z.coerce.number().int().min(1).max(50).default(20),
})

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const parsed = discoverSchema.safeParse(Object.fromEntries(searchParams))

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid parameters', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { category, max_price, capability, limit } = parsed.data
  const supabase = await createClient()

  // WAS-160e: Use RPC function with on-chain boost ordering
  const { data: agents, error } = await supabase.rpc('discover_agents_v2', {
    p_category:  category ?? null,
    p_max_price: max_price ?? null,
    p_limit:     limit,
  })

  if (error) {
    return NextResponse.json({ error: 'Discovery failed' }, { status: 500 })
  }

  // Client-side filter by capability name (capabilities is JSONB array)
  let filtered = agents ?? []
  if (capability) {
    const cap = capability.toLowerCase()
    filtered = filtered.filter((a: Record<string, unknown>) => {
      const caps = a.capabilities as Array<{ name: string }> | null
      return caps?.some(c => c.name.toLowerCase().includes(cap))
    })
  }

  return NextResponse.json({
    agents: filtered,
    total: filtered.length,
    meta: {
      invoke_endpoint: '/api/v1/models/{slug}/invoke',
      auth_methods: ['x-agent-key', 'x402'],
      docs_url: 'https://app.wasiai.io/docs',
      sdk: 'npm install @wasiai/sdk',
    },
  })
}
