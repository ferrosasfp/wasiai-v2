import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// PATCH /api/agent-keys/[id] — desactivar clave (sin on-chain)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json() as { is_active?: boolean }

  // Verificar ownership
  const { data: key } = await supabase
    .from('agent_keys')
    .select('id, owner_id')
    .eq('id', id)
    .single()

  if (!key) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (key.owner_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const updates: Record<string, unknown> = {}
  if (typeof body.is_active === 'boolean') updates.is_active = body.is_active

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { data: updated, error } = await supabase
    .from('agent_keys')
    .update(updates)
    .eq('id', id)
    .select('id, is_active')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(updated)
}
