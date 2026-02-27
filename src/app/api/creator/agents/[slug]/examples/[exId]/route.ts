// src/app/api/creator/agents/[id]/examples/[exId]/route.ts
// HU-4.3: PATCH + DELETE para ejemplos individuales
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// PATCH — editar ejemplo
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; exId: string }> }
) {
  const { slug: agentId, exId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { input, output, label } = body as Partial<{ input: string; output: string; label: string }>

  // Validaciones de chars (solo las que vengan en el body)
  if (input  !== undefined && input.trim().length  > 500)
    return NextResponse.json({ error: 'input exceeds 500 chars' }, { status: 400 })
  if (output !== undefined && output.trim().length > 1000)
    return NextResponse.json({ error: 'output exceeds 1000 chars' }, { status: 400 })
  if (label  !== undefined && label.trim().length  > 60)
    return NextResponse.json({ error: 'label exceeds 60 chars' }, { status: 400 })

  // Construir objeto de actualización
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString()  // manual porque no hay trigger moddatetime
  }
  if (input  !== undefined) updates.input  = input.trim()
  if (output !== undefined) updates.output = output.trim()
  if (label  !== undefined) updates.label  = label.trim() || null

  const { data, error } = await supabase
    .from('agent_examples')
    .update(updates)
    .eq('id', exId)
    .eq('agent_id', agentId)
    .eq('creator_id', user.id)   // doble check de ownership + RLS
    .select()
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ error: 'Not found or forbidden' }, { status: 404 })
  return NextResponse.json({ example: data })
}

// DELETE — eliminar ejemplo
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; exId: string }> }
) {
  const { slug: agentId, exId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error, count } = await supabase
    .from('agent_examples')
    .delete({ count: 'exact' })
    .eq('id', exId)
    .eq('agent_id', agentId)
    .eq('creator_id', user.id)  // doble check de ownership + RLS

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (count === 0) return NextResponse.json({ error: 'Not found or forbidden' }, { status: 404 })
  return NextResponse.json({ success: true })
}
