/**
 * /api/creator/agents/[slug]/status — PATCH (toggle active/paused)
 *
 * S-02: CSRF validation.
 * Ownership check: creator_id must match authenticated user.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { validateCsrf } from '@/lib/security/csrf'

const statusSchema = z.object({
  status: z.enum(['active', 'paused']),
})

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
  const result = statusSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid status — must be "active" or "paused"' },
      { status: 400 },
    )
  }

  const serviceClient = createServiceClient()

  // Ownership check
  const { data: existing } = await serviceClient
    .from('agents')
    .select('id, creator_id, status')
    .eq('slug', slug)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }
  if (existing.creator_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await serviceClient
    .from('agents')
    .update({ status: result.data.status, updated_at: new Date().toISOString() })
    .eq('id', existing.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ status: result.data.status })
}
