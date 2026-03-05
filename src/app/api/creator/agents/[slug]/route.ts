/**
 * /api/creator/agents/[slug] — PATCH (update) + DELETE
 *
 * S-02: CSRF validation on all mutating methods.
 * Ownership check: creator_id must match authenticated user.
 * Soft-delete: marks status = 'deleted' to preserve call history.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { validateCsrf } from '@/lib/security/csrf'
import { createModelSchema } from '@/lib/schemas/model.schema'


// ── PATCH — update agent fields ──────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const csrfError = validateCsrf(req)
  if (csrfError) return csrfError

  const { slug } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))

  // A-07: Validate with partial schema — only provided fields are required
  const updateSchema = createModelSchema
    .omit({ slug: true })
    .partial()
  const result = updateSchema.safeParse(body)
  if (!result.success) {
    const fieldErrors: Record<string, string> = {}
    result.error.issues.forEach(i => { fieldErrors[i.path[0] as string] = i.message })
    return NextResponse.json({ error: 'Validation failed', fields: fieldErrors }, { status: 400 })
  }

  // Ownership check — use service client to bypass RLS on read, then update scoped to user
  const serviceClient = createServiceClient()
  const { data: existing } = await serviceClient
    .from('agents')
    .select('id, creator_id')
    .eq('slug', slug)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }
  if (existing.creator_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: agent, error } = await serviceClient
    .from('agents')
    .update({ ...result.data, updated_at: new Date().toISOString() })
    .eq('id', existing.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // WAS-161: Return registration_type so client knows if on-chain sync is needed
  return NextResponse.json({ agent })
}

// ── DELETE — soft-delete agent ────────────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const csrfError = validateCsrf(req)
  if (csrfError) return csrfError

  const { slug } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serviceClient = createServiceClient()

  // Ownership check
  const { data: existing } = await serviceClient
    .from('agents')
    .select('id, creator_id')
    .eq('slug', slug)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }
  if (existing.creator_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Check if there are associated calls — if yes, soft-delete to preserve history
  const { count } = await serviceClient
    .from('agent_calls')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', existing.id)

  if ((count ?? 0) > 0) {
    // Soft-delete: mark as deleted, preserve call history integrity
    const { error } = await serviceClient
      .from('agents')
      .update({ status: 'deleted', updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    // Hard-delete: no associated calls, safe to remove
    const { error } = await serviceClient
      .from('agents')
      .delete()
      .eq('id', existing.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
