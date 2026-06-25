/**
 * PATCH /api/admin/disputes/:id
 * WAS-189: Admin resolve dispute
 * Auth: Authorization: Bearer ADMIN_SECRET
 */
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

const VALID_STATUSES = ['approved', 'rejected'] as const

function checkAdminAuth(req: Request): boolean {
  const adminSecret = process.env.ADMIN_SECRET
  if (!adminSecret) return false
  const authHeader = req.headers.get('authorization') ?? ''
  const expected = `Bearer ${adminSecret}`
  // V13 (audit 2026-06-25): comparación constant-time para evitar timing side-channel.
  // Guard de longitud previa (timingSafeEqual exige buffers de igual tamaño).
  const a = Buffer.from(authHeader)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  let body: { status?: unknown; resolution_note?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const status = body.status as string | undefined
  if (!status || !(VALID_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json(
      { error: 'Invalid status', valid_statuses: VALID_STATUSES },
      { status: 422 },
    )
  }

  const resolutionNote = body.resolution_note as string | undefined

  try {
    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from('disputes')
      .update({
        status,
        resolution_note: resolutionNote ?? null,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id, status, resolution_note, resolved_at')
      .single()

    if (error) {
      if ((error as { code?: string }).code === 'PGRST116') {
        return NextResponse.json({ error: 'Dispute not found' }, { status: 404 })
      }
      logger.error('[admin/disputes] PATCH error', { err: error.message, id })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (err) {
    logger.error('[admin/disputes] PATCH unhandled error', { err, id })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
