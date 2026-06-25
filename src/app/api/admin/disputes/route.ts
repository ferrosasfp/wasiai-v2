/**
 * GET /api/admin/disputes
 * WAS-189: Admin list disputes
 * Auth: Authorization: Bearer ADMIN_SECRET
 */
import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

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

export async function GET(req: Request) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createServiceClient()

    const url = new URL(req.url)
    const statusFilter = url.searchParams.get('status')
    const agentSlugFilter = url.searchParams.get('agent_slug')

    let query = supabase
      .from('disputes')
      .select(`
        id,
        call_id,
        agent_id,
        caller_key_id,
        reason,
        description,
        status,
        resolution_note,
        resolved_at,
        created_at,
        agent:agents(slug, name),
        agent_call:agent_calls(called_at, amount_paid, status)
      `)
      .order('created_at', { ascending: false })

    if (statusFilter) {
      query = query.eq('status', statusFilter)
    }

    if (agentSlugFilter) {
      // Filter by agent slug via join — we do a subquery approach
      const { data: agentRow } = await supabase
        .from('agents')
        .select('id')
        .eq('slug', agentSlugFilter)
        .single()
      if (agentRow) {
        query = query.eq('agent_id', agentRow.id)
      } else {
        return NextResponse.json({ disputes: [], count: 0 })
      }
    }

    const { data, error, count } = await query

    if (error) {
      logger.error('[admin/disputes] GET error', { err: error.message })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    return NextResponse.json({ disputes: data ?? [], count: count ?? data?.length ?? 0 })
  } catch (err) {
    logger.error('[admin/disputes] unhandled error', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
