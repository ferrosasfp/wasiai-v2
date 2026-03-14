/**
 * GET /api/v1/capabilities
 * WAS-209: Discovery API enriquecida — machine-readable con schema, pricing y ERC-8004.
 * Reemplaza WAS-208. 100% público — sin auth.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMarketplaceAddress } from '@/lib/contracts/WasiAIMarketplace'
import { CHAIN_ID, CHAIN_NAME } from '@/lib/chain'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl

  // AC-9: validate limit
  const rawLimit = searchParams.get('limit')
  if (rawLimit !== null) {
    const n = Number(rawLimit)
    if (isNaN(n) || n < 1 || n > 100) {
      return NextResponse.json(
        { error: 'limit must be between 1 and 100' },
        { status: 400 },
      )
    }
  }

  const tag           = searchParams.get('tag')?.toLowerCase() ?? null
  const category      = searchParams.get('category') ?? null
  const maxPrice      = searchParams.get('max_price') ? Number(searchParams.get('max_price')) : null
  const minReputation = searchParams.get('min_reputation') ? Number(searchParams.get('min_reputation')) : null
  const limit         = Math.min(Math.max(Number(rawLimit ?? 20), 1), 100)
  const cursor        = searchParams.get('cursor') ?? null

  const supabase = await createClient()

  let query = supabase
    .from('agents')
    .select('id, slug, name, description, category, tags, price_per_call, input_schema, output_schema, reputation_score, total_calls, creator_wallet, created_at')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1) // fetch one extra to detect next page

  if (category)      query = query.eq('category', category)
  if (maxPrice !== null) query = query.lte('price_per_call', maxPrice)
  // AC-4: min_reputation stored 0-100 in DB
  if (minReputation !== null) query = query.gte('reputation_score', minReputation * 100)
  // AC-2: tag filter — contains con tag lowercased (tags se almacenan en lowercase por convención)
  if (tag) query = query.contains('tags', [tag])

  // AC-7: cursor pagination
  if (cursor) {
    try {
      const decoded = Buffer.from(cursor, 'base64').toString('utf-8')
      const [cursorTs, cursorId] = decoded.split('|')
      if (!cursorTs || !cursorId) throw new Error('invalid')
      query = query.or(`created_at.lt.${cursorTs},and(created_at.eq.${cursorTs},id.lt.${cursorId})`)
    } catch {
      return NextResponse.json({ error: 'invalid cursor' }, { status: 400 })
    }
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: 'Discovery failed' }, { status: 500 })
  }

  const rows = data ?? []
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows

  const lastRow = page[page.length - 1]
  const nextCursor = hasMore && lastRow
    ? Buffer.from(`${lastRow.created_at}|${lastRow.id}`).toString('base64')
    : null

  const contractAddress = getMarketplaceAddress(CHAIN_ID)

  const agents = page.map((a) => ({
    slug:                a.slug,
    name:                a.name,
    description:         a.description ?? null,
    category:            a.category,
    tags:                (a.tags as string[] | null) ?? [],
    price_per_call_usdc: Number(a.price_per_call),
    input_schema:        a.input_schema ?? null,
    output_schema:       a.output_schema ?? null,
    invoke_url:          `/api/v1/agents/${a.slug}/invoke`,
    erc8004: {
      identity_id:       a.creator_wallet ?? null,
      // AC-5: normalize 0-100 → 0.0-1.0
      reputation_score:  a.reputation_score != null ? Number(a.reputation_score) / 100 : null,
      total_invocations: Number(a.total_calls ?? 0),
    },
    payment: {
      method:   'x402',
      asset:    'USDC',
      chain:    CHAIN_NAME,
      contract: contractAddress,
    },
  }))

  return NextResponse.json(
    { agents, total: agents.length, next_cursor: nextCursor },
    { headers: { 'Cache-Control': 'public, max-age=60' } },
  )
}
