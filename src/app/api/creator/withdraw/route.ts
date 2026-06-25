/**
 * POST /api/creator/withdraw
 *
 * HU-067: Retiro via voucher EIP-712. El creator ya ejecutó claimEarnings() on-chain.
 * Este endpoint verifica el evento EarningsClaimed y decrementa pending_earnings_usdc
 * en exactamente el monto verificado on-chain (V7: no resetea a 0 para no borrar
 * earnings acumulados entre la firma del voucher y el claim).
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

  const serviceClient = createServiceClient()

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

  // 9. FP-1 (audit 2026-06-25): registro + decremento ATÓMICO e IDEMPOTENTE en
  // una sola RPC transaccional. El INSERT ... ON CONFLICT (tx_hash) DO NOTHING es
  // la única fuente de verdad de idempotencia: solo la fila que realmente inserta
  // decrementa. Dos POST concurrentes con el mismo txHash → uno inserta+decrementa,
  // el otro recibe false y NO decrementa (cierra el double-decrement por race que
  // tenía el viejo flujo SELECT-check → decrement → INSERT fire-and-forget).
  //
  // V7: se decrementa EXACTAMENTE el monto verificado on-chain (realAmount =
  // grossAmount del evento), no se resetea a 0. El RPC clampa con GREATEST(.., 0).
  const { data: processed, error: rpcError } = await serviceClient
    .rpc('record_withdrawal_and_decrement', {
      p_user_id: user.id,
      p_tx_hash: parsed.data.txHash,
      p_amount:  realAmount,
    })

  if (rpcError) {
    logger.error('[creator/withdraw] DB update failed after verified on-chain claim', {
      txHash: parsed.data.txHash, rpcError,
    })
    return NextResponse.json({
      ok:        true,
      realAmount,
      warning:   'DB sync failed — contact support if balance shows incorrectly.',
    })
  }

  // processed === false → este txHash ya estaba registrado (duplicado) → ya
  // procesado. Mismo comportamiento que daba el check de idempotencia previo (409).
  if (processed === false) {
    return NextResponse.json(
      { error: 'This transaction has already been processed', txHash: parsed.data.txHash },
      { status: 409 },
    )
  }

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
