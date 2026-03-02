/**
 * POST /api/v1/admin/jobs/cleanup
 * WAS-70 — Limpieza de jobs colgados
 *
 * Marca como 'failed' cualquier job en estado 'processing' con updated_at
 * hace más de 5 minutos (cortados por Vercel serverless).
 *
 * Autenticación: EIP-712 admin signature (verifyAdminSignature).
 * Cron sugerido en vercel.json: cada 10 minutos
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  verifyAdminSignature,
  type AdminActionMessage,
} from '@/lib/admin/verifyAdminSignature'

export async function POST(req: NextRequest) {
  // Verificar firma EIP-712 del admin
  const body = await req.json().catch(() => null)
  if (!body || !body.signature || !body.message) {
    return NextResponse.json(
      { error: 'signature and message required' },
      { status: 400 },
    )
  }

  const message: AdminActionMessage = {
    action:    body.message.action,
    nonce:     body.message.nonce,
    timestamp: BigInt(body.message.timestamp),
  }

  const { ok, reason } = await verifyAdminSignature(
    body.signature as `0x${string}`,
    message,
  )
  if (!ok) {
    return NextResponse.json({ error: 'Forbidden', reason }, { status: 403 })
  }

  const supabase = await createClient()

  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('jobs')
    .update({
      status:       'failed',
      error:        'Job timed out — processing exceeded 5 minutes',
      updated_at:   new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .eq('status', 'processing')
    .lt('updated_at', fiveMinutesAgo)
    .select('id')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ cleaned: data?.length ?? 0 })
}
