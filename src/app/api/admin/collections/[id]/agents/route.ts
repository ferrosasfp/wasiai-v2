/**
 * /api/admin/collections/[id]/agents — manage agents in a collection
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { z } from 'zod'

interface RouteContext {
  params: Promise<{ id: string }>
}

// GET — list agents in collection
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('collection_agents')
    .select('sort_order, agent:agents(id, slug, name, category, cover_image)')
    .eq('collection_id', id)
    .order('sort_order')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// POST — add agent to collection
const addSchema = z.object({ agent_id: z.string().uuid() })

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  const body = await request.json().catch(() => null)
  const parsed = addSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Get max sort_order
  const { data: existing } = await supabase
    .from('collection_agents')
    .select('sort_order')
    .eq('collection_id', id)
    .order('sort_order', { ascending: false })
    .limit(1)

  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1

  const { error } = await supabase
    .from('collection_agents')
    .insert({ collection_id: id, agent_id: parsed.data.agent_id, sort_order: nextOrder })

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Agent already in collection' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}

// DELETE — remove agent from collection
const removeSchema = z.object({ agent_id: z.string().uuid() })

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  const body = await request.json().catch(() => null)
  const parsed = removeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('collection_agents')
    .delete()
    .eq('collection_id', id)
    .eq('agent_id', parsed.data.agent_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// PUT — reorder agents (batch update sort_order)
const reorderSchema = z.object({
  agents: z.array(z.object({
    agent_id:   z.string().uuid(),
    sort_order: z.number().int().min(0),
  })),
})

export async function PUT(request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  const body = await request.json().catch(() => null)
  const parsed = reorderSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Update each agent's sort_order
  const updates = parsed.data.agents.map(a =>
    supabase
      .from('collection_agents')
      .update({ sort_order: a.sort_order })
      .eq('collection_id', id)
      .eq('agent_id', a.agent_id)
  )

  const results = await Promise.all(updates)
  const failed = results.find(r => r.error)
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
