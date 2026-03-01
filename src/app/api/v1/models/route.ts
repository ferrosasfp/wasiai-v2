import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { ModelCategory } from '@/features/models/types/models.types'

import { SITE_URL } from '@/lib/constants'

/**
 * Agent Discovery API
 * GET /api/v1/models
 * Returns machine-readable model catalog for AI agents.
 * 
 * Query params:
 *   category: nlp | vision | audio | code | multimodal | data
 *   search: string
 *   limit: number (default 20)
 *   offset: number
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category') as ModelCategory | null
  const search = searchParams.get('search')
  // S-11: Always pass radix 10 to parseInt to avoid octal interpretation
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100)
  const offset = parseInt(searchParams.get('offset') ?? '0', 10)

  const supabase = await createClient()
  let query = supabase
    .from('agents')
    .select('name, slug, description, category, price_per_call, currency, chain, capabilities, total_calls')
    .eq('status', 'active')
    .order('total_calls', { ascending: false })
    .range(offset, offset + limit - 1)

  if (category) query = query.eq('category', category)
  if (search) query = query.ilike('name', `%${search}%`)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const models = (data ?? []).map(m => ({
    ...m,
    invoke_url: `${SITE_URL}/api/v1/models/${m.slug}/invoke`,
    spec_url:   `${SITE_URL}/api/v1/models/${m.slug}/invoke`,
    payment: {
      price: m.price_per_call,
      currency: m.currency,
      chain: m.chain,
      protocol: 'x402',
    },
  }))

  // P-09: Longer CDN cache with stale-while-revalidate for better performance
  return NextResponse.json({
    schema: 'wasiai/catalog/v1',
    total: models.length,
    offset,
    limit,
    models,
  }, {
    headers: {
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  })
}
