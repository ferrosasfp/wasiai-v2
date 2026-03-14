/**
 * GET /api/v1/capabilities
 * WAS-208: Lista pública de capabilities registrados en agentes activos.
 * Permite a developers y agentes conocer qué capabilities pueden usar en Compose.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const category = searchParams.get('category') ?? null

  const supabase = await createClient()

  let query = supabase
    .from('agents')
    .select('capabilities, category')
    .eq('status', 'active')
    .not('capabilities', 'is', null)

  if (category) {
    query = query.eq('category', category)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch capabilities' }, { status: 500 })
  }

  // Extraer nombres únicos de capabilities y ordenar
  const capSet = new Set<string>()
  for (const agent of data ?? []) {
    const caps = agent.capabilities as Array<{ name: string }> | null
    if (Array.isArray(caps)) {
      for (const c of caps) {
        if (c?.name) capSet.add(c.name.toLowerCase())
      }
    }
  }

  const capabilities = Array.from(capSet).sort()

  return NextResponse.json(
    { capabilities, total: capabilities.length },
    { headers: { 'Cache-Control': 'public, max-age=300' } }
  )
}
