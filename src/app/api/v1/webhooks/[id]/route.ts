import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  if (body.url) {
    try {
      if (new URL(body.url).protocol !== 'https:' && process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'URL must use HTTPS in production' }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }
  }

  const { id } = await params
  const { data, error } = await supabase
    .from('webhooks')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id) // ownership check — webhook belongs to authenticated user
    .select('id, url, events, is_active, updated_at')
    .single()

  if (error || !data) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
  return NextResponse.json({ webhook: data })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { error } = await supabase
    .from('webhooks')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id) // ownership check

  if (error) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
