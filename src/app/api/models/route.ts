import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateEndpointUrl } from '@/lib/security/validateEndpointUrl'
import { validateCsrf } from '@/lib/security/csrf'
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
