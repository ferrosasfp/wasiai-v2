/**
 * POST /api/creator/withdraw
 *
 * HU-067: Retiro via voucher EIP-712. El creator ya ejecutó claimEarnings() on-chain.
 * Este endpoint verifica el evento EarningsClaimed y pone pending_earnings_usdc = 0.
 *
 * HAL-025: Solo retorna éxito tras verificar el evento en el receipt.
 */
import { type NextRequest, NextResponse }        from 'next/server'
import { createClient, createServiceClient }     from '@/lib/supabase/server'
import { validateCsrf }                          from '@/lib/security/csrf'
import { logger }                               from '@/lib/logger'
import { z }                                    from 'zod'
import { createPublicClient, http } from 'viem'
import { avalancheFuji, avalanche } from 'viem/chains'
import { getPendingEarnings }       from '@/lib/contracts/marketplaceClient'

// topic0 = keccak256("EarningsClaimed(address,uint256,uint256,uint256,bytes32)")
const EARNINGS_CLAIMED_TOPIC = '0x7c1baf99431f82a970a4a3490e0d9ba64bffbe05e26ccc6e03ec6646aed8d667'

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

  // 4. Public client — NG-V04: use env vars for RPC (consistent with marketplaceClient.ts)
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
  const rpcUrl  = (chainId === 43114
    ? process.env.NEXT_PUBLIC_RPC_MAINNET
    : process.env.NEXT_PUBLIC_RPC_TESTNET
  )?.trim() || undefined

  // NG-V02: Check idempotencia BEFORE any RPC call
  const serviceClient = createServiceClient()
  const { data: existingWithdrawal } = await serviceClient
    .from('creator_withdrawals')
    .select('id')
    .eq('tx_hash', parsed.data.txHash)
    .maybeSingle()

  if (existingWithdrawal) {
    return NextResponse.json(
      { error: 'This transaction has already been processed', txHash: parsed.data.txHash },
      { status: 409 },
    )
  }

  const pub = createPublicClient({
    chain:     chainId === 43114 ? avalanche : avalancheFuji,
    transport: http(rpcUrl),
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

  // 6. Extraer evento EarningsClaimed
  const marketplaceAddr = (chainId === 43114
    ? process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET
    : process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI) ?? ''

  const log = receipt.logs.find(l =>
    l.topics[0] === EARNINGS_CLAIMED_TOPIC &&
    l.address.toLowerCase() === marketplaceAddr.toLowerCase()
  )

  if (!log) {
    return NextResponse.json(
      { error: 'EarningsClaimed event not found in receipt' },
      { status: 400 },
    )
  }

  // 7. Verificar ownership: topics[1] = address indexada → últimos 40 chars
  const eventCreator = log.topics[1]?.slice(-40) ?? ''
  if (eventCreator.toLowerCase() !== walletAddress.toLowerCase().slice(-40)) {
    logger.error('[creator/withdraw] creator mismatch', { eventCreator, walletAddress })
    return NextResponse.json({ error: 'Receipt creator does not match authenticated wallet' }, { status: 403 })
  }

  // 8. Decodificar monto real del evento desde log.data (grossAmount no es indexed)
  // EarningsClaimed(address indexed creator, uint256 grossAmount, uint256 creatorShare, uint256 platformShare, bytes32 nonce)
  // data = abi.encode(grossAmount, creatorShare, platformShare, nonce)
  // B-1 fix: grossAmount is NOT indexed — lives in log.data, not topics.
  // data layout (ABI-encoded): [grossAmount uint256 32B][creatorShare uint256 32B][platformShare uint256 32B][nonce bytes32 32B]
  let realAmount = 0
  try {
    // Each ABI word is 32 bytes = 64 hex chars. grossAmount is the first word in data.
    const dataHex  = log.data.startsWith('0x') ? log.data.slice(2) : log.data
    const grossHex = dataHex.slice(0, 64)
    realAmount = Number(BigInt('0x' + grossHex)) / 1_000_000
  } catch (decodeErr) {
    logger.warn('[creator/withdraw] realAmount decode failed, using 0', { decodeErr })
  }

  // 9. Poner pending_earnings_usdc = 0 en Supabase
  const { error: updateError } = await serviceClient
    .from('creator_profiles')
    .update({ pending_earnings_usdc: 0 })
    .eq('id', user.id)

  if (updateError) {
    logger.error('[creator/withdraw] DB update failed after verified on-chain claim', {
      txHash: parsed.data.txHash, updateError,
    })
    return NextResponse.json({
      ok:        true,
      realAmount,
      warning:   'DB sync failed — contact support if balance shows incorrectly.',
    })
  }

  // NG-V02: Register txHash to prevent double-processing
  serviceClient
    .from('creator_withdrawals')
    .insert({ creator_id: user.id, tx_hash: parsed.data.txHash, amount_usdc: realAmount })
    .then(({ error }) => {
      if (error) logger.warn('[creator/withdraw] txHash log insert failed (non-fatal)', { error })
    })

  logger.info('[creator/withdraw] EarningsClaimed verified', {
    txHash: parsed.data.txHash, realAmount, walletAddress,
  })

  return NextResponse.json({ ok: true, realAmount })
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
