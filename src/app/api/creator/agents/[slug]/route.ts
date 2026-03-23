/**
 * /api/creator/agents/[slug] — PATCH (update) + DELETE
 *
 * S-02: CSRF validation on all mutating methods.
 * Ownership check: creator_id must match authenticated user.
 * Soft-delete: marks status = 'deleted' to preserve call history.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { probeEndpoint } from '@/lib/agents/health-probe'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { validateCsrf } from '@/lib/security/csrf'
import { validateEndpointUrlAsync } from '@/lib/security/validateEndpointUrl'
import { createModelSchema } from '@/lib/schemas/model.schema'
import { metaValidateSchema } from '@/lib/schema-validator'


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

  // SEC-01: meta-validar input_schema y output_schema si se proporcionan
  if (result.data.input_schema) {
    const v = metaValidateSchema(result.data.input_schema)
    if (!v.valid) return NextResponse.json({ error: v.error, code: 'invalid_input_schema' }, { status: 422 })
  }
  if (result.data.output_schema) {
    const v = metaValidateSchema(result.data.output_schema)
    if (!v.valid) return NextResponse.json({ error: v.error, code: 'invalid_output_schema' }, { status: 422 })
  }

  // Ownership check — use service client to bypass RLS on read, then update scoped to user
  const serviceClient = createServiceClient()
  const { data: existing } = await serviceClient
    .from('agents')
    .select('id, creator_id, last_checked_at')
    .eq('slug', slug)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }
  if (existing.creator_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // WAS-276: Validate endpoint_url before DB update to block tunnel/dev domains
  if (result.data.endpoint_url) {
    try {
      await validateEndpointUrlAsync(result.data.endpoint_url)
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Invalid endpoint URL' }, { status: 422 })
    }
  }

  const { data: agent, error } = await serviceClient
    .from('agents')
    .update({ ...result.data, updated_at: new Date().toISOString() })
    .eq('id', existing.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // WAS-215: Re-verify endpoint when endpoint_url changes
  if (result.data.endpoint_url) {
    // Cooldown: max 1 probe per agent per 60s (anti DoS amplifier)
    const lastChecked = existing.last_checked_at
      ? new Date(existing.last_checked_at).getTime()
      : 0
    const cooldownMs = 60_000
    if (Date.now() - lastChecked >= cooldownMs) {
      await serviceClient.from('agents')
        .update({ health_check: { pending: true }, status: 'reviewing' })
        .eq('id', existing.id)
      probeEndpoint(result.data.endpoint_url, existing.id).catch(err =>
        console.error('[patch-agent] re-probe failed silently', { agentId: existing.id, err: String(err) })
      )
    }
  }

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
