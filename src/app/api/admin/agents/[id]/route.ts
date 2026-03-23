import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export const dynamic = 'force-dynamic'

/** PATCH /api/admin/agents/:id — update agent status */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = await req.json() as { status?: string; consecutive_failures?: number }

  const allowed = ['active', 'reviewing', 'draft', 'suspended']
  if (body.status && !allowed.includes(body.status)) {
    return NextResponse.json({ error: `Invalid status. Allowed: ${allowed.join(', ')}` }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  if (body.status !== undefined) update.status = body.status
  if (body.consecutive_failures !== undefined) update.consecutive_failures = body.consecutive_failures

  const { data, error } = await supabase
    .from('agents')
    .update(update)
    .eq('id', id)
    .select('id, slug, status, consecutive_failures')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
