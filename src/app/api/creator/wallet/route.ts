import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateCsrf } from '@/lib/security/csrf'
import { triggerImmediateSettlement } from '@/lib/settlement/immediateSettlement'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  // S-02: CSRF protection — validate request origin
  const csrfError = validateCsrf(req)
  if (csrfError) return csrfError

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

  // Fire-and-forget: settle accumulated pending earnings now that wallet is set.
  // Non-fatal — wallet is already saved. Cron diario resuelve si falla.
  triggerImmediateSettlement(user.id).catch(err =>
    logger.error('[wallet] immediate settlement failed', { err }),
  )

  return NextResponse.json({ ok: true })
}
