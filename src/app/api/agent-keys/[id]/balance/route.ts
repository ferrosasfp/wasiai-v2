import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getKeyBalanceBreakdownOnChain } from '@/lib/contracts/marketplaceClient'
import { logger } from '@/lib/logger'

/**
 * GET /api/agent-keys/[id]/balance
 *
 * Returns:
 *   { onChainBalance, primaryBalance, legacyBalance, dbBudget, dbSpent }
 *
 * - onChainBalance: total USDC across PRIMARY (+ LEGACY when configured) — equals
 *   primaryBalance when no legacy contract is set (WKH-126 AC-7, backward-compat).
 * - primaryBalance: USDC in the PRIMARY (M-1) contract.
 * - legacyBalance:  USDC in the LEGACY contract, or null when not configured.
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

    // Get on-chain balance (gracefully returns 0 if contract not configured).
    // WKH-126 (AC-2): read PRIMARY + LEGACY separately. When legacy is unset the
    // breakdown returns { primary, legacy: null, total: primary } → onChainBalance
    // is byte-identical to the prior single-address behavior (AC-7).
    let primaryBalance = 0
    let legacyBalance: number | null = null
    let onChainBalance = 0
    if (keyRow.key_hash) {
      try {
        const breakdown = await getKeyBalanceBreakdownOnChain(keyRow.key_hash)
        primaryBalance  = breakdown.primary
        legacyBalance   = breakdown.legacy
        onChainBalance  = breakdown.total
      } catch (err) {
        logger.warn('[balance] getKeyBalanceBreakdownOnChain failed', { err })
      }
    }

    return NextResponse.json(
      {
        onChainBalance,
        primaryBalance,
        legacyBalance,
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
