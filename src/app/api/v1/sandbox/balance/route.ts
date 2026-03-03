import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()

  // Obtener o crear registro de créditos sandbox
  const { data: existing } = await service
    .from('sandbox_credits')
    .select('balance_usdc, total_calls')
    .eq('user_id', user.id)
    .single()

  if (existing) {
    return NextResponse.json({
      balance_usdc: Number(existing.balance_usdc),
      total_calls: existing.total_calls ?? 0,
    })
  }

  // Primera vez: crear con $0.50 de crédito inicial
  const { data: created } = await service
    .from('sandbox_credits')
    .insert({ user_id: user.id, balance_usdc: 0.5 })
    .select('balance_usdc, total_calls')
    .single()

  return NextResponse.json({
    balance_usdc: Number(created?.balance_usdc ?? 0.5),
    total_calls: 0,
  })
}
