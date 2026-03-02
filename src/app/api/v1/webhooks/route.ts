import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import crypto from 'crypto'
import { validateEndpointUrl } from '@/lib/security/validateEndpointUrl'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('webhooks')
    .select('id, url, events, is_active, created_at, updated_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ webhooks: data })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { url, events, secret } = await req.json()

  if (!url || !events?.length) {
    return NextResponse.json({ error: 'url and events are required' }, { status: 400 })
  }

  // B1: Validate URL — blocks SSRF/DNS-rebinding via shared validateEndpointUrl
  try {
    validateEndpointUrl(url)
  } catch {
    return NextResponse.json({ error: 'Invalid webhook URL' }, { status: 400 })
  }

  // Limit to 5 webhooks per user (free tier)
  const { count } = await supabase
    .from('webhooks')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)

  if ((count ?? 0) >= 5) {
    return NextResponse.json({ error: 'Maximum 5 webhooks allowed per user' }, { status: 422 })
  }

  const generatedSecret = secret ?? crypto.randomBytes(32).toString('hex')

  const { data: webhook, error } = await supabase
    .from('webhooks')
    .insert({ user_id: user.id, url, events, secret: generatedSecret })
    .select('id, url, events, is_active, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ webhook, secret: generatedSecret }, { status: 201 })
}
