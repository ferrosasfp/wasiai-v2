import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateEndpointUrl } from '@/lib/security/validateEndpointUrl'
import { validateCsrf } from '@/lib/security/csrf'
import { ensureCreatorProfile } from '@/lib/ensureCreatorProfile'
// A-07: Use shared schema to keep client/server validation in sync
import { createModelSchema } from '@/lib/schemas/model.schema'

export async function POST(request: NextRequest) {
  // S-02: CSRF protection
  const csrfError = validateCsrf(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()

  // HU-1.2: Auto-generate slug from name if not provided
  if (!body.slug && body.name) {
    body.slug = (body.name as string)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 64)
  }

  const result = createModelSchema.safeParse(body)

  if (!result.success) {
    // UX-08: Normalize Zod issues → {errors: [{field, message}]} for consistent API contract
    const errors = result.error.issues.map(issue => ({
      field:   issue.path[0]?.toString() ?? 'unknown',
      message: issue.message,
    }))
    return NextResponse.json({ error: 'Validation failed', errors }, { status: 422 })
  }

  // SEC-01: Block SSRF via endpoint_url — only if provided (drafts may not have it)
  if (result.data.endpoint_url) {
    try {
      validateEndpointUrl(result.data.endpoint_url)
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 422 })
    }
  }

  // HU-069: Ensure creator_profile exists (fallback for missing DB trigger)
  await ensureCreatorProfile(supabase, user)

  const { data, error } = await supabase
    .from('agents')
    .insert({ ...result.data, creator_id: user.id })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'Slug already taken', fields: { name: 'Ese nombre ya está en uso, elige otro' } },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // HU-1.2: registerAgentOnChain moved to PATCH /status when status → 'active'
  return NextResponse.json(data, { status: 201 })
}

// ── PATCH /api/models — actualiza max_rpm y max_rpd de un agente del creator ──
export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { slug, max_rpm, max_rpd } = body as { slug?: string; max_rpm?: unknown; max_rpd?: unknown }

  if (!slug || typeof slug !== 'string') {
    return NextResponse.json({ errors: [{ field: 'slug', message: 'slug is required' }] }, { status: 422 })
  }

  const updates: Record<string, number> = {}
  if (max_rpm !== undefined) {
    if (typeof max_rpm !== 'number' || max_rpm < 1 || max_rpm > 10000) {
      return NextResponse.json({ errors: [{ field: 'max_rpm', message: 'max_rpm must be between 1 and 10000' }] }, { status: 422 })
    }
    updates.max_rpm = max_rpm
  }
  if (max_rpd !== undefined) {
    if (typeof max_rpd !== 'number' || max_rpd < 1 || max_rpd > 100000) {
      return NextResponse.json({ errors: [{ field: 'max_rpd', message: 'max_rpd must be between 1 and 100000' }] }, { status: 422 })
    }
    updates.max_rpd = max_rpd
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ errors: [{ field: 'body', message: 'At least one of max_rpm or max_rpd is required' }] }, { status: 422 })
  }

  const { data, error } = await supabase
    .from('agents')
    .update(updates)
    .eq('slug', slug)
    .eq('creator_id', user.id) // RLS: solo el creator puede editar su propio agente
    .select('slug, max_rpm, max_rpd')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Agent not found or not owned by you' }, { status: 404 })

  return NextResponse.json(data, { status: 200 })
}
