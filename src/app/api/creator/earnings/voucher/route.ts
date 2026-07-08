/**
 * POST /api/creator/earnings/voucher
 *
 * HU-067: Genera un voucher EIP-712 firmado por el operador backend para que el creator
 * pueda llamar claimEarnings() en el contrato y retirar sus earnings off-chain.
 *
 * El amount viene de Supabase (pending_earnings_usdc) — NUNCA del cliente.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { createClient }                   from '@/lib/supabase/server'
import { validateCsrf }                   from '@/lib/security/csrf'
import { logger }                         from '@/lib/logger'
import { createWalletClient, http }       from 'viem'
import { privateKeyToAccount }            from 'viem/accounts'
import { avalancheFuji, avalanche }       from 'viem/chains'
import { randomBytes }                    from 'crypto'
import { getKeysLimit, getIdentifier, checkRateLimit } from '@/lib/ratelimit'
import { toAtomic, fromAtomic }            from '@/lib/money/usdc'
import { assertMarketplaceAddressCoherence } from '@/lib/contracts/marketplaceAddressCoherence'

export async function POST(req: NextRequest) {
  const csrfError = validateCsrf(req)
  if (csrfError) return csrfError

  // 1. Auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // NG-V03: Rate limiting — max 10 vouchers/hour per user
  const rlId  = getIdentifier(req, user.id)
  const rlHit = await checkRateLimit(getKeysLimit(), rlId)
  if (rlHit) return rlHit

  // WKH-162: fail LOUD if the voucher's verifyingContract source
  // (NEXT_PUBLIC_MARKETPLACE_ADDRESS_<net>) has drifted from the server on-chain
  // path (MARKETPLACE_CONTRACT_ADDRESS). Signing a drifted voucher would revert
  // claimEarnings() silently on-chain. Runs before any DB side-effect.
  try {
    assertMarketplaceAddressCoherence()
  } catch (err) {
    logger.error('[voucher] marketplace address drift — refusing to sign', {
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'MARKETPLACE_ADDRESS_DRIFT' }, { status: 500 })
  }

  // 2. Get creator profile
  // WKH-SEC-03: wallet_address stays in creator_profiles; pending_earnings_usdc
  // moved to the RLS-protected creator_earnings table (self-read).
  const { data: profile } = await supabase
    .from('creator_profiles')
    .select('wallet_address')
    .eq('id', user.id)
    .single()

  if (!profile?.wallet_address) {
    return NextResponse.json({ error: 'No wallet_address configured for this creator' }, { status: 400 })
  }

  const { data: earnings } = await supabase
    .from('creator_earnings')
    .select('pending_earnings_usdc')
    .eq('creator_id', user.id)
    .maybeSingle()

  // V4 (KEY_BALANCE_MISMATCH): derivar el monto atómico directo del valor canónico de DB
  // (numeric(20,6), llega como string) vía toAtomic, sin round-trip por float. Math.round(
  // pendingUsdc * 1e6) podía diferir 1 unidad si pendingUsdc venía de sumas float.
  const pendingRaw    = earnings?.pending_earnings_usdc ?? 0
  const grossAtomicBn = toAtomic(pendingRaw as string | number)
  if (grossAtomicBn <= 0n) {
    return NextResponse.json({ error: 'No pending earnings to claim' }, { status: 400 })
  }

  // 3. Compute grossAmountAtomics (6 decimals) — number es exacto (cabe en double a 6 dec).
  const grossAmountAtomics = Number(grossAtomicBn)
  const pendingUsdc        = Number(fromAtomic(grossAtomicBn)) // valor canónico para audit/respuesta

  // 4. Generate nonce and deadline (1 hour from now)
  const nonce    = `0x${randomBytes(32).toString('hex')}` as `0x${string}`
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)

  // V8 (audit 2026-06-25): reserve the voucher slot ATOMICALLY *before* signing.
  // A creator with pending earnings could otherwise request two vouchers within
  // the 10/hour rate-limit window; both would read the same pending balance and
  // both get a valid signature with distinct nonces, allowing a ~2x withdrawal
  // if the contract holds enough USDC. insert_voucher_if_none_pending does an
  // atomic INSERT ... WHERE NOT EXISTS(pending, non-expired voucher for this
  // creator): exactly one of two concurrent requests inserts; the loser gets
  // false and is rejected here BEFORE any signature is produced.
  //
  // Limitation (documented): the withdraw flow does NOT mark a voucher
  // 'claimed' — it verifies the on-chain EarningsClaimed event by tx_hash only.
  // So a vigent voucher is released by its deadline (1h expiry), not by consume.
  // This closes the "two vigent vouchers at once" case; a single voucher still
  // serializes claims for up to 1 hour.
  const { data: reserved, error: reserveError } = await supabase.rpc(
    'insert_voucher_if_none_pending',
    {
      p_creator_id:     user.id,
      p_wallet_address: profile.wallet_address,
      p_gross_amount:   pendingUsdc,
      p_nonce:          nonce,
      p_deadline:       Number(deadline),
    },
  )

  if (reserveError) {
    logger.error('[voucher] slot reservation RPC failed', { error: reserveError })
    return NextResponse.json({ error: 'Failed to reserve voucher' }, { status: 500 })
  }

  if (reserved === false) {
    return NextResponse.json(
      { error: 'A pending withdrawal voucher already exists. Claim it or wait for it to expire before requesting another.' },
      { status: 409 },
    )
  }

  // 5. Sign EIP-712 voucher with operator key
  const rawKey = process.env.OPERATOR_PRIVATE_KEY?.replace(/\n/g, '').trim() ?? ''
  const privKey = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`

  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
  const chain   = chainId === 43114 ? avalanche : avalancheFuji

  const marketplaceAddr = ((chainId === 43114
    ? process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET
    : process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI) ?? '').trim()

  let signature: `0x${string}`
  try {
    const account = privateKeyToAccount(privKey)
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(),
    })

    signature = await walletClient.signTypedData({
      domain: {
        name:              'WasiAIMarketplace',
        version:           '1',
        chainId:           BigInt(chainId),
        verifyingContract: marketplaceAddr as `0x${string}`,
      },
      types: {
        ClaimEarnings: [
          { name: 'creator',     type: 'address' },
          { name: 'grossAmount', type: 'uint256' },
          { name: 'deadline',    type: 'uint256' },
          { name: 'nonce',       type: 'bytes32' },
        ],
      },
      primaryType: 'ClaimEarnings',
      message: {
        creator:     profile.wallet_address as `0x${string}`,
        grossAmount: grossAtomicBn,
        deadline,
        nonce,
      },
    })
  } catch (err) {
    logger.error('[voucher] signing failed', { err })
    return NextResponse.json({ error: 'Failed to sign voucher' }, { status: 500 })
  }

  logger.info('[voucher] signed', { walletAddress: profile.wallet_address, grossAmountAtomics })

  // V8: the audit row was already inserted atomically by
  // insert_voucher_if_none_pending (it doubles as the concurrency gate), so the
  // previous fire-and-forget INSERT is gone. If signing had failed above the
  // reserved row stays 'pending' and blocks new vouchers until its 1h deadline —
  // fail-safe: it can never over-issue, only briefly delay a retry.
  return NextResponse.json({
    grossAmountAtomics,
    grossAmountUsdc: pendingUsdc,
    deadline:        deadline.toString(),
    nonce,
    signature,
  })
}
