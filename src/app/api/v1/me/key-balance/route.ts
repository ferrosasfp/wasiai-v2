import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'

export interface KeyBalanceResponse {
  has_key: true
  name: string
  is_active: boolean
  budget_usdc: number
  spent_usdc: number
  remaining_usdc: number
  usage_pct: number
  status: 'ok' | 'low_budget' | 'budget_exhausted' | 'inactive'
  last_used_at: string | null
}

export interface NoKeyResponse {
  has_key: false
}

export type KeyBalanceResult = KeyBalanceResponse | NoKeyResponse

export async function GET() {
  const supabase = await createServerClient()

  // 1. Verificar sesión
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'not_authenticated' },
      { status: 401 }
    )
  }

  // 2. Obtener key activa del usuario (owner_id — columna real en agent_keys)
  const { data: key, error } = await supabase
    .from('agent_keys')
    .select('id, name, budget_usdc, spent_usdc, is_active, last_used_at')
    .eq('owner_id', user.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  // Sin key activa o error de "no rows"
  if (error || !key) {
    return NextResponse.json({ has_key: false } satisfies NoKeyResponse)
  }

  // 3. Calcular campos derivados
  const budget = key.budget_usdc ?? 0
  const spent  = key.spent_usdc  ?? 0
  const remaining = Math.max(0, budget - spent)
  const usage_pct = budget > 0 ? Math.round((spent / budget) * 100) : 0

  // 4. Derivar status
  const status: KeyBalanceResponse['status'] =
    !key.is_active          ? 'inactive'
    : remaining === 0       ? 'budget_exhausted'
    : remaining < 0.5       ? 'low_budget'
    : 'ok'

  return NextResponse.json({
    has_key:        true,
    name:           key.name,
    is_active:      key.is_active,
    budget_usdc:    budget,
    spent_usdc:     spent,
    remaining_usdc: remaining,
    usage_pct,
    status,
    last_used_at:   key.last_used_at,
  } satisfies KeyBalanceResponse)
}
