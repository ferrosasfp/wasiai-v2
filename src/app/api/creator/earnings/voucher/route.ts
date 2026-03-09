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

  // 2. Get creator profile
  const { data: profile } = await supabase
    .from('creator_profiles')
    .select('wallet_address, pending_earnings_usdc')
    .eq('id', user.id)
    .single()

  if (!profile?.wallet_address) {
    return NextResponse.json({ error: 'No wallet_address configured for this creator' }, { status: 400 })
  }

  const pendingUsdc = Number(profile.pending_earnings_usdc ?? 0)
  if (pendingUsdc <= 0) {
    return NextResponse.json({ error: 'No pending earnings to claim' }, { status: 400 })
  }

  // 3. Compute grossAmountAtomics (6 decimals)
  const grossAmountAtomics = Math.round(pendingUsdc * 1_000_000)

  // 4. Generate nonce and deadline (1 hour from now)
  const nonce    = `0x${randomBytes(32).toString('hex')}` as `0x${string}`
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)

  // 5. Sign EIP-712 voucher with operator key
  const rawKey = process.env.OPERATOR_PRIVATE_KEY?.replace(/\n/g, '').trim() ?? ''
  const privKey = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`

  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
  const chain   = chainId === 43114 ? avalanche : avalancheFuji

  const marketplaceAddr = (chainId === 43114
    ? process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET
    : process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI) ?? ''

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
        grossAmount: BigInt(grossAmountAtomics),
        deadline,
        nonce,
      },
    })
  } catch (err) {
    logger.error('[voucher] signing failed', { err })
    return NextResponse.json({ error: 'Failed to sign voucher' }, { status: 500 })
  }

  logger.info('[voucher] signed', { walletAddress: profile.wallet_address, grossAmountAtomics })

  // NG-V01: Audit trail — register voucher in DB (non-fatal)
  supabase
    .from('creator_withdrawal_vouchers')
    .insert({
      creator_id:        user.id,
      wallet_address:    profile.wallet_address,
      gross_amount_usdc: pendingUsdc,
      nonce,
      deadline:          Number(deadline),
      status:            'pending',
    })
    .then(({ error }) => {
      if (error) logger.warn('[voucher] DB audit trail insert failed (non-fatal)', { error })
    })

  return NextResponse.json({
    grossAmountAtomics,
    grossAmountUsdc: pendingUsdc,
    deadline:        deadline.toString(),
    nonce,
    signature,
  })
}
