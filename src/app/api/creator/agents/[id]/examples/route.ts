// src/app/api/creator/agents/[id]/examples/route.ts
// HU-4.3: CRUD de ejemplos input/output para agentes
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const MAX_EXAMPLES = 5

// GET — listar ejemplos del agente (solo el creator dueño)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verificar ownership: el agente debe pertenecer al creator autenticado
  const { data: agent } = await supabase
    .from('agents')
    .select('id')
    .eq('id', agentId)
    .eq('creator_id', user.id)
    .maybeSingle()

  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('agent_examples')
    .select('*')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: true })  // AC-4: orden de creación

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ examples: data })
}

// POST — crear ejemplo
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verificar ownership
  const { data: agent } = await supabase
    .from('agents')
    .select('id')
    .eq('id', agentId)
    .eq('creator_id', user.id)
    .maybeSingle()

  if (!agent) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Verificar límite de 5 ejemplos (enforced en API, no en DB)
  const { count } = await supabase
    .from('agent_examples')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', agentId)

  if ((count ?? 0) >= MAX_EXAMPLES) {
    return NextResponse.json(
      { error: 'Maximum 5 examples per agent' },
      { status: 422 }
    )
  }

  // Parsear y validar body
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { input, output, label } = body as { input?: string; output?: string; label?: string }

  if (!input || typeof input !== 'string' || input.trim().length === 0)
    return NextResponse.json({ error: 'input is required' }, { status: 400 })
  if (!output || typeof output !== 'string' || output.trim().length === 0)
    return NextResponse.json({ error: 'output is required' }, { status: 400 })
  if (input.trim().length > 500)
    return NextResponse.json({ error: 'input exceeds 500 chars' }, { status: 400 })
  if (output.trim().length > 1000)
    return NextResponse.json({ error: 'output exceeds 1000 chars' }, { status: 400 })
  if (label && label.trim().length > 60)
    return NextResponse.json({ error: 'label exceeds 60 chars' }, { status: 400 })

  const { data, error } = await supabase
    .from('agent_examples')
    .insert({
      agent_id:   agentId,
      creator_id: user.id,
      input:      input.trim(),
      output:     output.trim(),
      label:      label?.trim() ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ example: data }, { status: 201 })
}
