/**
 * POST /api/creator/withdraw
 *
 * HU-064: Retiro directo desde wallet del creator via withdraw().
 * El creator ya ejecutó la tx on-chain — este endpoint solo verifica el evento.
 *
 * HAL-025: Solo retorna éxito tras verificar el evento Withdrawn en el receipt.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateCsrf } from '@/lib/security/csrf'
import { logger } from '@/lib/logger'
import { z } from 'zod'
import { createPublicClient, http } from 'viem'
import { avalancheFuji, avalanche } from 'viem/chains'
import {
  getPendingEarnings,
} from '@/lib/contracts/marketplaceClient'

// topic0 = keccak256("Withdrawn(address,uint256)")
const WITHDRAWN_TOPIC = '0x7084f5476618d8e60b11ef0d7d3f06914655adb8793e28ff7f018d4c76d505d5'

const BodySchema = z.object({
  txHash: z.string().startsWith('0x'),
})

export async function POST(req: NextRequest) {
  const csrfError = validateCsrf(req)
  if (csrfError) return csrfError

  // 1. Auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. Validate body
  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', details: parsed.error.issues }, { status: 400 })
  }

  // 3. Get creator wallet
  const { data: profile } = await supabase
    .from('creator_profiles')
    .select('wallet_address')
    .eq('id', user.id)
    .single()

  if (!profile?.wallet_address) {
    return NextResponse.json(
      { error: 'No wallet_address configured for this creator' },
      { status: 400 },
    )
  }

  const walletAddress = profile.wallet_address

  // 4. Public client
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
  const pub = createPublicClient({
    chain:     chainId === 43114 ? avalanche : avalancheFuji,
    transport: http(chainId === 43114
      ? 'https://api.avax.network/ext/bc/C/rpc'
      : 'https://api.avax-test.network/ext/bc/C/rpc'),
  })

  // 5. Leer receipt con retry 3×
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
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
    }
  }

  if (!receipt || receipt.status !== 'success') {
    return NextResponse.json({ error: 'Transaction reverted on-chain' }, { status: 400 })
  }

  // 6. Extraer evento Withdrawn
  const marketplaceAddr = (chainId === 43114
    ? process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET
    : process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI) ?? ''

  const log = receipt.logs.find(l =>
    l.topics[0] === WITHDRAWN_TOPIC &&
    l.address.toLowerCase() === marketplaceAddr.toLowerCase()
  )

  if (!log) {
    return NextResponse.json(
      { error: 'Withdrawn event not found in receipt' },
      { status: 400 },
    )
  }

  // 7. Verificar ownership: topics[1] = address indexada → últimos 40 chars
  const eventCreator = log.topics[1]?.slice(-40) ?? ''
  if (eventCreator.toLowerCase() !== walletAddress.toLowerCase().slice(-40)) {
    logger.error('[creator/withdraw] creator mismatch', { eventCreator, walletAddress })
    return NextResponse.json({ error: 'Receipt creator does not match authenticated wallet' }, { status: 403 })
  }

  // 8. Extraer monto real del evento (log.data = ABI-encoded uint256)
  const realAmount = Number(BigInt(log.data)) / 1_000_000

  logger.info('[creator/withdraw] completed', {
    txHash: parsed.data.txHash, realAmount, walletAddress,
  })

  return NextResponse.json({
    ok:         true,
    txHash:     parsed.data.txHash,
    realAmount,
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
