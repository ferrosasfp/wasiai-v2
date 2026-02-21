import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/v1/agent-keys/me
 * Returns the budget status of the calling agent key.
 * Designed for agents to self-check before making expensive calls.
 *
 * Headers:
 *   x-agent-key: wasi_xxx...
 */
export async function GET(request: NextRequest) {
  const rawKey = request.headers.get('x-agent-key')

  if (!rawKey) {
    return NextResponse.json(
      { error: 'Missing x-agent-key header', code: 'missing_key' },
      { status: 401 },
    )
  }

  const supabase = await createClient()
  const hash = createHash('sha256').update(rawKey).digest('hex')

  const { data: keyRow } = await supabase
    .from('agent_keys')
    .select('id, name, budget_usdc, spent_usdc, is_active, last_used_at, created_at, erc8004_identity')
    .eq('key_hash', hash)
    .single()

  if (!keyRow) {
    return NextResponse.json(
      { error: 'Key not found', code: 'invalid_key' },
      { status: 404 },
    )
  }

  const budget = Number(keyRow.budget_usdc)
  const spent = Number(keyRow.spent_usdc)
  const remaining = Math.max(0, budget - spent)
  const pct = budget > 0 ? Math.round((spent / budget) * 100) : 0

  return NextResponse.json({
    name: keyRow.name,
    is_active: keyRow.is_active,
    budget_usdc: budget,
    spent_usdc: spent,
    remaining_usdc: remaining,
    usage_pct: pct,
    last_used_at: keyRow.last_used_at,
    created_at: keyRow.created_at,
    identity: keyRow.erc8004_identity ?? null, // ERC-8004 on-chain identity
    status: !keyRow.is_active
      ? 'inactive'
      : remaining === 0
        ? 'budget_exhausted'
        : remaining < 0.5
          ? 'low_budget'
          : 'ok',
  })
}
