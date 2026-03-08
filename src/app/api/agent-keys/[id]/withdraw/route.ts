/**
 * POST /api/agent-keys/[id]/withdraw
 *
 * HU-063: Retiro directo desde wallet del usuario via withdrawKey(bytes32,uint256).
 * El usuario ya ejecutó la tx on-chain — este endpoint solo sincroniza la DB.
 *
 * HAL-025: DB se actualiza SOLO tras verificar el evento KeyWithdrawn en el receipt.
 */
import { NextRequest, NextResponse }         from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { validateCsrf }                      from '@/lib/security/csrf'
import { logger }                            from '@/lib/logger'
import { z }                                 from 'zod'
import { createPublicClient, http }          from 'viem'
import { avalancheFuji, avalanche }          from 'viem/chains'
import { getKeyOwnerOnChain }                from '@/lib/contracts/marketplaceClient'

// topic0 = keccak256("KeyWithdrawn(bytes32,address,uint256)")
const KEY_WITHDRAWN_TOPIC = '0xf968df119e62b53960f5b7aaa847537e4b933ffd14eaba1e7ea5fb99bffb2632'

const BodySchema = z.object({
  txHash: z.string().startsWith('0x'),
  amount: z.number().positive(),   // hint only — monto real viene del evento on-chain
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  // 3. Ownership check
  const { data: keyRow } = await supabase
    .from('agent_keys')
    .select('id, key_hash, is_active, owner_id, owner_wallet_address, budget_usdc')
    .eq('id', id)
    .eq('owner_id', user.id)
    .single()

  if (!keyRow)           return NextResponse.json({ error: 'Key not found' },       { status: 404 })
  if (!keyRow.is_active) return NextResponse.json({ error: 'Key already revoked' }, { status: 400 })
  if (!keyRow.key_hash)  return NextResponse.json({ error: 'Key has no hash' },     { status: 500 })

  // 4. Resolver owner wallet — DB primero, fallback on-chain
  const ownerAddress = (keyRow as { owner_wallet_address?: string | null }).owner_wallet_address
    ?? await getKeyOwnerOnChain(keyRow.key_hash)

  if (!ownerAddress) {
    return NextResponse.json(
      { error: 'Key owner not found. Key may not have been deposited yet.' },
      { status: 400 },
    )
  }

  // 5. Public client para leer receipt
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
  const pub = createPublicClient({
    chain:     chainId === 43114 ? avalanche : avalancheFuji,
    transport: http(chainId === 43114
      ? 'https://api.avax.network/ext/bc/C/rpc'
      : 'https://api.avax-test.network/ext/bc/C/rpc'),
  })

  // 6. Leer receipt + verificar status (retry hasta 3 veces con delay)
  let receipt: Awaited<ReturnType<typeof pub.getTransactionReceipt>> | undefined
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      receipt = await pub.getTransactionReceipt({
        hash: parsed.data.txHash as `0x${string}`,
      })
      break
    } catch {
      if (attempt === 2) {
        return NextResponse.json(
          { error: 'Transaction not found or not yet mined. Please retry in a few seconds.' },
          { status: 400 },
        )
      }
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1))) // 2s, 4s
    }
  }

  if (!receipt || receipt.status !== 'success') {
    return NextResponse.json({ error: 'Transaction reverted on-chain' }, { status: 400 })
  }

  // 7. Extraer evento KeyWithdrawn
  const marketplaceAddr = (chainId === 43114
    ? process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET
    : process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI) ?? ''

  const log = receipt!.logs.find(l =>
    l.topics[0] === KEY_WITHDRAWN_TOPIC &&
    l.address.toLowerCase() === marketplaceAddr.toLowerCase()
  )

  if (!log) {
    return NextResponse.json(
      { error: 'KeyWithdrawn event not found in receipt' },
      { status: 400 },
    )
  }

  // 8. Verificar keyId del evento == keyRow.key_hash
  // topics[1] = bytes32 con 0x prefix → slice(2) para 64 hex chars
  const eventKeyId = log.topics[1]?.slice(2).toLowerCase()
  if (eventKeyId !== keyRow.key_hash.toLowerCase()) {
    logger.error('[withdraw] keyId mismatch', { eventKeyId, keyHash: keyRow.key_hash })
    return NextResponse.json({ error: 'Receipt keyId does not match this key' }, { status: 400 })
  }

  // 9. Verificar owner del evento == owner registrado
  // topics[2] = address padded a 32 bytes → tomar últimos 40 chars
  const eventOwner = '0x' + (log.topics[2]?.slice(-40) ?? '')
  if (eventOwner.toLowerCase() !== ownerAddress.toLowerCase()) {
    logger.error('[withdraw] owner mismatch', { eventOwner, ownerAddress })
    return NextResponse.json({ error: 'Receipt owner does not match key owner' }, { status: 403 })
  }

  // 10. Extraer monto real del evento (log.data = ABI-encoded uint256)
  const realAmount = Number(BigInt(log.data)) / 1_000_000

  // 11. Actualizar DB — HAL-025: solo tras receipt verificado
  const newBudget = Math.max(0, Number(keyRow.budget_usdc) - realAmount)
  const serviceClient = createServiceClient()

  const { error: updateError } = await serviceClient
    .from('agent_keys')
    .update({
      budget_usdc: newBudget,
      is_active:   newBudget > 0,
    })
    .eq('id', id)

  if (updateError) {
    logger.error('[withdraw] DB update failed after verified on-chain withdrawal', {
      keyId: id, txHash: parsed.data.txHash, updateError,
    })
    return NextResponse.json({
      ok:        true,
      txHash:    parsed.data.txHash,
      realAmount,
      warning:   'DB sync failed — contact support if balance shows incorrectly.',
    })
  }

  logger.info('[withdraw] completed', {
    keyId: id, realAmount, newBudget, isActive: newBudget > 0,
  })

  return NextResponse.json({ ok: true, txHash: parsed.data.txHash, realAmount })
}
