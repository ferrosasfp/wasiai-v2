/**
 * POST /api/agent-keys/[id]/withdraw
 *
 * WAS-141: Sync DB después de que el creator ejecutó withdrawKey on-chain.
 * El creator firma y envía la tx desde su propio wallet (msg.sender).
 * Este endpoint solo verifica la tx y actualiza el balance en DB.
 *
 * HAL-025: Verificar tx on-chain ANTES de modificar DB.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { createPublicClient, http } from 'viem'
import { avalanche, avalancheFuji } from 'viem/chains'
import { validateCsrf } from '@/lib/security/csrf'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const BodySchema = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid tx hash'),
  amount: z.number().positive(),
})

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
const IS_FUJI  = CHAIN_ID === 43113

function getPublicClient() {
  const chain  = IS_FUJI ? avalancheFuji : avalanche
  const rpcUrl = (IS_FUJI
    ? process.env.NEXT_PUBLIC_RPC_TESTNET
    : process.env.NEXT_PUBLIC_RPC_MAINNET
  )?.trim() || undefined
  return createPublicClient({ chain, transport: http(rpcUrl) })
}

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
  const { txHash, amount } = parsed.data

  // 3. Ownership check
  const { data: keyRow } = await supabase
    .from('agent_keys')
    .select('id, budget_usdc, spent_usdc, is_active, owner_id')
    .eq('id', id)
    .eq('owner_id', user.id)
    .single()

  if (!keyRow) return NextResponse.json({ error: 'Key not found' }, { status: 404 })
  if (!keyRow.is_active) return NextResponse.json({ error: 'Key already revoked' }, { status: 400 })

  // 4. HAL-025: Verificar tx on-chain antes de modificar DB
  try {
    const publicClient = getPublicClient()
    const receipt = await publicClient.getTransactionReceipt({
      hash: txHash as `0x${string}`,
    })

    if (receipt.status !== 'success') {
      logger.warn('[withdraw] tx reverted — DB not modified', { txHash, keyId: id })
      return NextResponse.json(
        { error: 'Transaction reverted on-chain. DB not modified.' },
        { status: 400 },
      )
    }
  } catch (err) {
    logger.error('[withdraw] could not verify tx receipt', { txHash, err })
    return NextResponse.json(
      { error: 'Could not verify transaction. Try again in a few seconds.' },
      { status: 503 },
    )
  }

  // 5. Actualizar DB
  const currentBalance = Math.max(0, Number(keyRow.budget_usdc) - Number(keyRow.spent_usdc))
  const newBudget      = Math.max(0, Number(keyRow.budget_usdc) - amount)
  const isClosed       = newBudget <= 0 || amount >= currentBalance

  const serviceClient = createServiceClient()
  const { error: updateError } = await serviceClient
    .from('agent_keys')
    .update({
      budget_usdc: newBudget,
      ...(isClosed ? { is_active: false } : {}),
    })
    .eq('id', id)

  if (updateError) {
    logger.error('[withdraw] DB update failed', { keyId: id, updateError })
    return NextResponse.json({ error: 'Failed to update key balance' }, { status: 500 })
  }

  logger.info('[withdraw] key balance updated', {
    keyId: id,
    amount,
    newBudget,
    isClosed,
    txHash,
  })

  return NextResponse.json({
    ok:         true,
    newBalance: newBudget,
    isClosed,
    txHash,
  })
}
