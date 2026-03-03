/**
 * POST /api/creator/listing-fee-pay
 *
 * WAS-131: Recibe firma EIP-712 del creator, ejecuta transferWithAuthorization
 * al treasury y activa el agente si la tx es exitosa.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { settlePaymentDirectly, type X402EVMPayload } from '@/lib/contracts/usdcSettler'
import { logger } from '@/lib/logger'

interface ListingFeePayBody {
  slug:          string
  signature:     string
  authorization: {
    from:        string
    to:          string
    value:       string
    validAfter:  string
    validBefore: string
    nonce:       string
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: ListingFeePayBody
  try {
    body = await request.json() as ListingFeePayBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { slug, signature, authorization } = body
  if (!slug || !signature || !authorization) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // [Adversary-1] Validar que authorization.to === TREASURY_ADDRESS
  const treasury = (process.env.WASIAI_TREASURY_ADDRESS ?? '').toLowerCase().trim()
  if (!treasury) {
    logger.error('[listing-fee-pay] WASIAI_TREASURY_ADDRESS not configured')
    return NextResponse.json({ error: 'Payment not configured' }, { status: 500 })
  }
  if (authorization.to.toLowerCase() !== treasury) {
    logger.warn('[listing-fee-pay] invalid recipient', { to: authorization.to, treasury })
    return NextResponse.json({ error: 'Invalid payment recipient' }, { status: 400 })
  }

  const serviceClient = createServiceClient()

  // Verificar que el agente pertenece al creator
  const { data: profile } = await serviceClient
    .from('creator_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { data: agent } = await serviceClient
    .from('agents')
    .select('id, status')
    .eq('slug', slug)
    .eq('creator_id', profile.id)
    .single()

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  if (agent.status === 'active') {
    return NextResponse.json({ error: 'Agent already active' }, { status: 409 })
  }

  // Leer fee de system_config para validar el amount de la firma
  const { data: configRow } = await serviceClient
    .from('system_config')
    .select('value')
    .eq('key', 'listing_fee_usdc')
    .single()

  const feeUsdc   = parseFloat(configRow?.value ?? '0')
  const atomicFee = Math.round(feeUsdc * 1_000_000).toString()

  // Ejecutar transferWithAuthorization via settlePaymentDirectly
  const evmPayload: X402EVMPayload = { signature, authorization }
  const result = await settlePaymentDirectly(evmPayload, atomicFee)

  if (!result.settled) {
    logger.error('[listing-fee-pay] settlement failed', { error: result.error, slug })
    return NextResponse.json(
      { error: result.error ?? 'Payment failed — agent not published' },
      { status: 402 },
    )
  }

  // AC5: Tx exitosa → activar agente
  const { error: updateError } = await serviceClient
    .from('agents')
    .update({ status: 'active' })
    .eq('id', agent.id)

  if (updateError) {
    logger.error('[listing-fee-pay] failed to activate agent after payment', { slug, txHash: result.transactionHash })
    return NextResponse.json(
      { error: 'Payment received but agent activation failed. Contact support.' },
      { status: 500 },
    )
  }

  logger.info('[listing-fee-pay] agent activated after fee payment', {
    slug,
    txHash: result.transactionHash,
  })

  return NextResponse.json({
    ok:        true,
    txHash:    result.transactionHash,
    agentSlug: slug,
  })
}
