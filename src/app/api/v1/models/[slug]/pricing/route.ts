/**
 * GET /api/v1/models/[slug]/pricing
 *
 * WAS-133: Retorna el precio total estimado (creator price + gas fee Chainlink).
 * Sin auth — dato público. Cache 60s.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { calcPlatformOverhead } from '@/lib/pricing/overhead'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const supabase = createServiceClient()

  const { data: model } = await supabase
    .from('agents')
    .select('price_per_call, creator_price')
    .eq('slug', slug)
    .single()

  if (!model) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  // HU-073: use price_per_call as the base price — source of truth set by the creator.
  const creatorPrice = Number(model.price_per_call)
  const result = await calcPlatformOverhead(creatorPrice)

  return NextResponse.json(
    {
      creatorPrice,
      gasFee:    result.breakdown.gas,
      totalPrice: creatorPrice + result.overhead,
      cached:    result.cached,
    },
    {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30' },
    },
  )
}
