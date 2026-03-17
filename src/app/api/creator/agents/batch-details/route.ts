/**
 * GET /api/creator/agents/batch-details?slugs=slug1,slug2,...
 *
 * SDD-217 (Logic Audit F1): Returns price_per_call and erc8004_id for the
 * given slugs, scoped to the authenticated creator's active agents.
 *
 * Response: Array<{ slug: string, price_per_call: number, erc8004_id: number | null }>
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const slugsParam = request.nextUrl.searchParams.get('slugs')
  if (!slugsParam) {
    return NextResponse.json({ error: 'Missing slugs parameter' }, { status: 400 })
  }

  const slugs = slugsParam.split(',').map(s => s.trim()).filter(Boolean)
  if (slugs.length === 0) {
    return NextResponse.json([])
  }

  // Cap at 100 to prevent abuse
  if (slugs.length > 100) {
    return NextResponse.json({ error: 'Too many slugs (max 100)' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('agents')
    .select('slug, price_per_call, erc8004_id')
    .in('slug', slugs)
    .eq('creator_id', user.id)
    .eq('status', 'active')

  if (error) {
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}
