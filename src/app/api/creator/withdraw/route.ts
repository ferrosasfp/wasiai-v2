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

  // Check pending earnings
  const pending = await getPendingEarnings(wallet)
  if (pending <= 0) {
    return NextResponse.json(
      { error: 'No pending earnings to withdraw', pending: 0 },
      { status: 400 },
    )
  }

  // Trigger on-chain withdrawal via operator
  const txHash = await withdrawForCreator(wallet)
  if (!txHash) {
    return NextResponse.json(
      { error: 'Withdrawal failed — contract not configured or transaction reverted' },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    withdrawn_usdc: pending,
    wallet,
    tx_hash: txHash,
    explorer: `https://testnet.snowscan.xyz/tx/${txHash}`,
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
