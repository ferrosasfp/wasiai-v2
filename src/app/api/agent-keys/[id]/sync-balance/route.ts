/**
 * POST /api/agent-keys/[id]/sync-balance
 *
 * Sincroniza budget_usdc en la DB con el balance real on-chain.
 * Útil cuando un withdrawKey on-chain exitoso no actualizó la DB
 * (timeout, CSRF fallo, UI se colgó, etc.).
 *
 * Auth: usuario autenticado + dueño de la key.
 * No requiere txHash — lee el balance on-chain directamente.
 */
import { NextRequest, NextResponse }         from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logger }                            from '@/lib/logger'
import { createPublicClient, http }          from 'viem'
import { avalancheFuji, avalanche }          from 'viem/chains'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: keyRow } = await supabase
    .from('agent_keys')
    .select('id, key_hash, budget_usdc, is_active, owner_id')
    .eq('id', id)
    .eq('owner_id', user.id)
    .single()

  if (!keyRow)          return NextResponse.json({ error: 'Key not found' }, { status: 404 })
  if (!keyRow.key_hash) return NextResponse.json({ error: 'Key has no hash' }, { status: 500 })

  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
  const contractAddress = (chainId === 43114
    ? process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET
    : process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI) ?? ''

  if (!contractAddress) {
    return NextResponse.json({ error: 'Contract address not configured' }, { status: 500 })
  }

  const pub = createPublicClient({
    chain:     chainId === 43114 ? avalanche : avalancheFuji,
    transport: http(chainId === 43114
      ? 'https://api.avax.network/ext/bc/C/rpc'
      : 'https://api.avax-test.network/ext/bc/C/rpc'),
  })

  // Leer balance on-chain
  let onChainBalance: number
  try {
    const bytes32KeyId = `0x${keyRow.key_hash.padEnd(64, '0')}` as `0x${string}`
    const raw = await pub.readContract({
      address:      contractAddress as `0x${string}`,
      abi:          [{ name: 'getKeyBalance', type: 'function', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' }],
      functionName: 'getKeyBalance',
      args:         [bytes32KeyId],
    }) as bigint
    onChainBalance = Number(raw) / 1_000_000
  } catch (err) {
    logger.error('[sync-balance] on-chain read failed', { err: String(err).slice(0, 200) })
    return NextResponse.json({ error: 'Failed to read on-chain balance' }, { status: 500 })
  }

  const prevBudget = Number(keyRow.budget_usdc)
  if (Math.abs(prevBudget - onChainBalance) < 0.000001) {
    return NextResponse.json({ ok: true, budget_usdc: prevBudget, synced: false, message: 'Already in sync' })
  }

  const serviceClient = createServiceClient()
  const { error: updateError } = await serviceClient
    .from('agent_keys')
    .update({ budget_usdc: onChainBalance, is_active: onChainBalance > 0 || keyRow.is_active })
    .eq('id', id)

  if (updateError) {
    logger.error('[sync-balance] DB update failed', { updateError })
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 })
  }

  logger.info('[sync-balance] synced', { keyId: id, prevBudget, onChainBalance })
  return NextResponse.json({ ok: true, budget_usdc: onChainBalance, prev_budget: prevBudget, synced: true })
}
