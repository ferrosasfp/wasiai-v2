// src/app/api/v1/webhooks/[id]/deliveries/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Ownership check: verificar que el webhook pertenece al user
  const { data: webhook } = await supabase
    .from('webhooks')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!webhook) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: deliveries, error } = await supabase
    .from('webhook_deliveries')
    .select('id, event, success, status_code, attempt, delivered_at, error_message')
    .eq('webhook_id', id)
    .order('delivered_at', { ascending: false })
    .limit(10)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deliveries })
}
