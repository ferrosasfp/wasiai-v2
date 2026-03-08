/**
 * POST /api/agent-keys/[id]/withdraw
 *
 * HU-056: Retiro server-side vía operador.
 * El operador ejecuta refundKeyToEarnings + withdrawFor on-chain.
 * El usuario no firma nada.
 *
 * HAL-025: DB se actualiza SOLO tras receipt exitoso de withdrawFor.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { validateCsrf } from '@/lib/security/csrf'
import { logger } from '@/lib/logger'
import { z } from 'zod'
import { refundKeyToEarningsOnChain, withdrawForCreator, getKeyBalanceOnChain, getKeyOwnerOnChain } from '@/lib/contracts/marketplaceClient'

const BodySchema = z.object({
  amount:        z.number().positive(),
  walletAddress: z.string().optional(),   // HU-058: caller's current wallet for ownership check
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // S-02: CSRF
  const csrfError = validateCsrf(req)
  if (csrfError) return csrfError

  const { id } = await params

  // 1. Auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. Validate body
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', details: parsed.error.issues }, { status: 400 })
  }

  // 3. Ownership check + fetch key_hash
  const { data: keyRow } = await supabase
    .from('agent_keys')
    .select('id, key_hash, is_active, owner_id, owner_wallet_address')
    .eq('id', id)
    .eq('owner_id', user.id)
    .single()

  if (!keyRow) return NextResponse.json({ error: 'Key not found' }, { status: 404 })
  if (!keyRow.is_active) return NextResponse.json({ error: 'Key already revoked' }, { status: 400 })
  if (!keyRow.key_hash) return NextResponse.json({ error: 'Key has no hash' }, { status: 500 })

  // 4. Resolver wallet del owner — DB primero, fallback on-chain (RN-1 / HU-058)
  const ownerAddress = (keyRow as { owner_wallet_address?: string | null }).owner_wallet_address
    ?? await getKeyOwnerOnChain(keyRow.key_hash)

  if (!ownerAddress) {
    return NextResponse.json(
      { error: 'Key owner not found on-chain. Key may not have been deposited yet.' },
      { status: 400 },
    )
  }

  // HU-058: Si el caller envía su wallet, verificar que coincide con el owner registrado
  const callerWallet = parsed.data.walletAddress
  if (callerWallet && ownerAddress.toLowerCase() !== callerWallet.toLowerCase()) {
    return NextResponse.json(
      { error: `Solo la wallet ${ownerAddress.slice(0,6)}…${ownerAddress.slice(-4)} puede retirar de esta key.` },
      { status: 403 },
    )
  }

  // 5. Verificar balance on-chain antes de operar (AC-3)
  // getKeyBalanceOnChain returns USDC float (already divided by 1_000_000)
  const onChainBalance = await getKeyBalanceOnChain(keyRow.key_hash)

  if (onChainBalance === 0) {
    return NextResponse.json({ error: 'Key already empty on-chain' }, { status: 400 })
  }

  logger.info('[withdraw] starting operator withdrawal', {
    keyId: id,
    keyHash: keyRow.key_hash,
    ownerAddress,
    onChainBalance,
  })

  // 6. Paso 1: refundKeyToEarnings — mueve balance a earnings[owner]
  const refundTxHash = await refundKeyToEarningsOnChain(keyRow.key_hash)
  if (!refundTxHash) {
    logger.error('[withdraw] refundKeyToEarnings failed', { keyId: id })
    return NextResponse.json({ error: 'On-chain refund failed. No funds moved.' }, { status: 500 })
  }

  logger.info('[withdraw] refundKeyToEarnings confirmed', { keyId: id, refundTxHash })

  // 7. Paso 2: withdrawFor — USDC va al wallet del usuario (HAL-025: si falla, DB no se toca)
  const withdrawTxHash = await withdrawForCreator(ownerAddress)
  if (!withdrawTxHash) {
    logger.error('[withdraw] withdrawFor failed — DB not modified', { keyId: id, refundTxHash })
    return NextResponse.json(
      {
        error: 'Withdrawal transfer failed. Funds are in earnings — contact support with refundTxHash.',
        refundTxHash,
      },
      { status: 500 },
    )
  }

  logger.info('[withdraw] withdrawFor confirmed', { keyId: id, withdrawTxHash })

  // 8. Solo tras ambas confirmaciones → actualizar DB (HAL-025)
  const serviceClient = createServiceClient()
  const { error: updateError } = await serviceClient
    .from('agent_keys')
    .update({ budget_usdc: 0, spent_usdc: 0, is_active: false })
    .eq('id', id)

  if (updateError) {
    logger.error('[withdraw] DB update failed after successful on-chain withdrawal', {
      keyId: id,
      withdrawTxHash,
      updateError,
    })
    // Fondos YA fueron entregados on-chain — retornar success con warning
    return NextResponse.json({
      ok: true,
      refundTxHash,
      withdrawTxHash,
      warning: 'DB sync failed — contact support if balance shows incorrectly.',
    })
  }

  return NextResponse.json({ ok: true, refundTxHash, withdrawTxHash })
}
