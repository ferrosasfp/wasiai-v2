/**
 * /api/admin/collections — CRUD for curated collections
 * Auth: client-side wallet check (admin pattern)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { z } from 'zod'

// GET — list all collections with agent count
export async function GET() {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('collections')
    .select('*, collection_agents(agent_id)')
    .order('sort_order')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const collections = (data ?? []).map(c => ({
    ...c,
    agent_count: Array.isArray(c.collection_agents) ? c.collection_agents.length : 0,
    collection_agents: undefined,
  }))

  return NextResponse.json(collections)
}

// POST — create collection
const createSchema = z.object({
  name:        z.string().min(1).max(100),
  slug:        z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  cover_image: z.string().url().optional().or(z.literal('')),
  featured:    z.boolean().optional(),
})

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const { name, description, cover_image, featured } = parsed.data
  const slug = parsed.data.slug || name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('collections')
    .insert({ name, slug, description: description ?? null, cover_image: cover_image || null, featured: featured ?? false })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Slug already exists' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

// PUT — update collection
const updateSchema = z.object({
  id:          z.string().uuid(),
  name:        z.string().min(1).max(100).optional(),
  slug:        z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  cover_image: z.string().url().optional().or(z.literal('')),
  featured:    z.boolean().optional(),
  sort_order:  z.number().int().optional(),
})

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const { id, ...updates } = parsed.data
  // Remove undefined values
  const clean = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined))

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('collections')
    .update(clean)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE — delete collection (cascade deletes collection_agents)
const deleteSchema = z.object({ id: z.string().uuid() })

export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = deleteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { error } = await supabase.from('collections').delete().eq('id', parsed.data.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
