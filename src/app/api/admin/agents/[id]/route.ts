import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { headers } from 'next/headers'

const OPERATOR_ADDRESS = (process.env.NEXT_PUBLIC_OPERATOR_ADDRESS ?? '').toLowerCase()
const OWNER_ADDRESS    = (process.env.NEXT_PUBLIC_WASIAI_OWNER ?? '').toLowerCase()
const ADMIN_WALLETS = [
  OPERATOR_ADDRESS,
  OWNER_ADDRESS,
  '0x94DCDb84207724A609B17e4838936832EA59B9eD'.toLowerCase(),
  '0xf432baf1315ccDB23E683B95b03fD54Dd3e447Ba'.toLowerCase(),
].filter(Boolean)

export const dynamic = 'force-dynamic'

/** PATCH /api/admin/agents/:id — update agent status */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const h = await headers()
  const wallet = (h.get('x-admin-wallet') ?? '').toLowerCase()
  if (!wallet || !ADMIN_WALLETS.includes(wallet)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const supabase = createServiceClient()
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
