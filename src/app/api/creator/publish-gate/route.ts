/**
 * GET /api/creator/publish-gate
 *
 * WAS-131: Freemium publish gate.
 * Retorna si el creator necesita pagar listing fee para publicar su próximo agente.
 */
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { ensureCreatorProfile } from '@/lib/ensureCreatorProfile'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serviceClient = createServiceClient()

  // HU-069: Ensure creator_profile exists
  await ensureCreatorProfile(serviceClient, user)

  // Obtener perfil del creator
  const { data: profile } = await serviceClient
    .from('creator_profiles')
    .select('id, wallet_address')
    .eq('user_id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  // Contar agentes con status IN ('active', 'reviewing')
  const { count } = await serviceClient
    .from('agents')
    .select('id', { count: 'exact', head: true })
    .eq('creator_id', profile.id)
    .in('status', ['active', 'reviewing'])

  // Leer listing_fee_usdc de system_config
  const { data: configRow } = await serviceClient
    .from('system_config')
    .select('value')
    .eq('key', 'listing_fee_usdc')
    .single()

  const listingFee = parseFloat(configRow?.value ?? '0')
  const agentCount = count ?? 0

  return NextResponse.json({
    agentCount,
    listingFee,
    requiresFee:     agentCount >= 1 && listingFee > 0,
    hasWallet:       !!profile.wallet_address,
    treasuryAddress: process.env.WASIAI_TREASURY_ADDRESS ?? '',
  })
}
