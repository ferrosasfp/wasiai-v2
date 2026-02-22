import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { wallet_address } = body

  if (!wallet_address || !/^0x[a-fA-F0-9]{40}$/.test(wallet_address)) {
    return NextResponse.json(
      { error: 'Dirección inválida — debe ser una dirección EVM válida (0x seguido de 40 caracteres hex)' },
      { status: 400 },
    )
  }

  const { error } = await supabase
    .from('creator_profiles')
    .update({ wallet_address })
    .eq('id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
