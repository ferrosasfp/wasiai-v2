import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKeyBalanceOnChain } from '@/lib/contracts/marketplaceClient'
import { logger } from '@/lib/logger'

/**
 * GET /api/agent-keys/[id]/balance
 *
 * Returns:
 *   { onChainBalance: number, dbBudget: number, dbSpent: number }
 *
 * - onChainBalance: real USDC held in the contract for this key (dollars)
 * - dbBudget:       budget_usdc from agent_keys table (UI display)
 * - dbSpent:        spent_usdc from agent_keys table (UI display)
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    // Authenticate
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get key from DB — verify ownership
    const { data: keyRow, error: keyError } = await supabase
      .from('agent_keys')
      .select('id, key_hash, budget_usdc, spent_usdc')
      .eq('id', id)
      .eq('owner_id', user.id)
      .single()

    if (keyError || !keyRow) {
      return NextResponse.json({ error: 'Key not found' }, { status: 404 })
    }

    // Get on-chain balance (gracefully returns 0 if contract not configured)
    let onChainBalance = 0
    if (keyRow.key_hash) {
      try {
        onChainBalance = await getKeyBalanceOnChain(keyRow.key_hash)
      } catch (err) {
        logger.warn('[balance] getKeyBalanceOnChain failed', { err })
      }
    }

    return NextResponse.json(
      {
        onChainBalance,
        dbBudget: Number(keyRow.budget_usdc) || 0,
        dbSpent:  Number(keyRow.spent_usdc)  || 0,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (err) {
    logger.error('[balance] unhandled error', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
