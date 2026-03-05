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

  let query = supabase
    .from('agents')
    .select('slug, name, description, price_per_call, category, capabilities, total_calls, reputation_score, free_trial_enabled, free_trial_limit')
    .eq('status', 'active')
    .order('total_calls', { ascending: false })
    .limit(limit)

  if (category)  query = query.eq('category', category)
  if (max_price) query = query.lte('price_per_call', max_price)

  const { data: agents, error } = await query

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
      docs_url: 'https://wasiai-v2.vercel.app/docs',
      sdk: 'npm install @wasiai/sdk',
    },
  })
}
