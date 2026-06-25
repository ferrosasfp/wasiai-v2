import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { verifyAdminSignature, type AdminActionMessage } from '@/lib/admin/verifyAdminSignature'
import { jsonError } from '@/lib/api/jsonError'

async function verifyAuth(request: NextRequest, action: string) {
  const sig      = request.headers.get('x-admin-signature') as `0x${string}` | null
  const nonceHdr = request.headers.get('x-admin-nonce')     as `0x${string}` | null
  const tsHdr    = request.headers.get('x-admin-timestamp')

  if (!sig || !nonceHdr || !tsHdr) return { ok: false, status: 401, reason: 'Missing admin auth headers' }

  const message: AdminActionMessage = { action, nonce: nonceHdr, timestamp: BigInt(tsHdr) }
  const { ok, reason } = await verifyAdminSignature(sig, message)
  return ok ? { ok: true } : { ok: false, status: 401, reason }
}

const patchSchema = z.object({
  status:               z.enum(['active', 'reviewing', 'draft', 'suspended']).optional(),
  consecutive_failures: z.number().int().optional(),
}).strict()

export const dynamic = 'force-dynamic'

/** PATCH /api/admin/agents/:id — update agent status */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await verifyAuth(request, 'updateAgent')
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status ?? 401 })

  const { id } = await params
  const supabase = createServiceClient()

  const raw = await request.json().catch(() => null)
  const parsed = patchSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', detail: parsed.error.flatten() }, { status: 400 })
  }
  const body = parsed.data

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
    return jsonError('db_error', 'Failed to update agent', 500, { logDetail: error })
  }

  return NextResponse.json(data)
}
