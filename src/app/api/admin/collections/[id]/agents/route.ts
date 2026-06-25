/**
 * /api/admin/collections/[id]/agents — manage agents in a collection
 * Auth: GET is public. POST/DELETE/PUT require EIP-712 admin signature.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { verifyAdminSignature, type AdminActionMessage } from '@/lib/admin/verifyAdminSignature'
import { jsonError } from '@/lib/api/jsonError'

async function requireAdmin(request: NextRequest): Promise<{ ok: true } | NextResponse> {
  const body = await request.clone().json().catch(() => null)
  const sig = body?.signature as `0x${string}` | undefined
  const msg = body?.message as AdminActionMessage | undefined
  if (!sig || !msg) {
    return NextResponse.json({ error: 'Admin signature required' }, { status: 401 })
  }
  const { ok, reason } = await verifyAdminSignature(sig, { ...msg, timestamp: BigInt(msg.timestamp) })
  if (!ok) {
    return NextResponse.json({ error: reason ?? 'unauthorized' }, { status: 401 })
  }
  return { ok: true }
}

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

  if (error) return jsonError('read_failed', 'Failed to list collection agents', 500, { logDetail: error })
  return NextResponse.json(data ?? [])
}

// POST — add agent to collection
const addSchema = z.object({ agent_id: z.string().uuid() })

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

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
    return jsonError('db_error', 'Failed to add agent to collection', 500, { logDetail: error })
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}

// DELETE — remove agent from collection
const removeSchema = z.object({ agent_id: z.string().uuid() })

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

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

  if (error) return jsonError('db_error', 'Failed to remove agent from collection', 500, { logDetail: error })
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
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

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
  if (failed?.error) return jsonError('db_error', 'Failed to reorder collection agents', 500, { logDetail: failed.error })

  return NextResponse.json({ ok: true })
}
