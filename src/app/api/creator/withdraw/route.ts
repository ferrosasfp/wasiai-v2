/**
 * POST /api/creator/withdraw
 *
 * Triggers an on-chain withdrawal of all pending USDC earnings
 * for the authenticated creator.
 *
 * Flow:
 *   1. Verify user is authenticated
 *   2. Get creator's wallet_address from creator_profiles
 *   3. Check pending earnings on WasiAIMarketplace.sol
 *   4. Call withdrawFor(creatorWallet) via operator wallet
 *   5. Return tx hash
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  getPendingEarnings,
  withdrawForCreator,
} from '@/lib/contracts/marketplaceClient'
import { snowscanTx } from '@/lib/chain'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get creator wallet
  const { data: profile } = await supabase
    .from('creator_profiles')
    .select('wallet_address')
    .eq('id', user.id)
    .single()

  if (!profile?.wallet_address) {
    return NextResponse.json(
      { error: 'No wallet address configured. Set it in your profile first.' },
      { status: 400 },
    )
  }

  const wallet = profile.wallet_address

  // Check pending earnings — skip balance check if RPC unavailable (let contract revert naturally)
  let pending = 0
  try {
    pending = await getPendingEarnings(wallet)
  } catch (err) {
    console.error('[withdraw] getPendingEarnings failed:', err)
    // Proceed anyway — withdrawFor will revert on-chain if truly empty
  }

  if (pending <= 0) {
    // Double-check: let the contract try anyway (RPC read might have failed)
    console.warn('[withdraw] pending=0 — attempting withdrawFor regardless')
  }

  // Trigger on-chain withdrawal via operator
  const txHash = await withdrawForCreator(wallet)
  if (!txHash) {
    return NextResponse.json(
      { error: 'Withdrawal failed — contract not configured or no pending earnings' },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    withdrawn_usdc: pending,
    wallet,
    tx_hash: txHash,
    explorer: snowscanTx(txHash),
  })
}

/**
 * GET /api/creator/withdraw
 * Returns current pending earnings for the authenticated creator.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('creator_profiles')
    .select('wallet_address')
    .eq('id', user.id)
    .single()

  if (!profile?.wallet_address) {
    return NextResponse.json({ pending_usdc: 0, wallet: null })
  }

  const pending = await getPendingEarnings(profile.wallet_address)

  return NextResponse.json({
    pending_usdc: pending,
    wallet:       profile.wallet_address,
    contract:     process.env.MARKETPLACE_CONTRACT_ADDRESS,
  })
}
