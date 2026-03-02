import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminSignature, type AdminActionMessage } from '@/lib/admin/verifyAdminSignature'
import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { avalanche, avalancheFuji } from 'viem/chains'
import { WASIAI_MARKETPLACE_ABI } from '@/lib/contracts/WasiAIMarketplace'
import { logger } from '@/lib/logger'

const CONTRACT_ADDRESS = (process.env.MARKETPLACE_CONTRACT_ADDRESS ?? '') as `0x${string}`

function getChain() {
  return Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113) === 43114 ? avalanche : avalancheFuji
}

/**
 * POST /api/admin/fee
 * Requiere header X-Admin-Signature (wallet sig del owner — validación client-side en panel).
 * Body: { bps: number }
 * Cambia platformFeeBps on-chain con OPERATOR_PRIVATE_KEY.
 */
export async function POST(request: NextRequest) {
  // Verificar firma EIP-712
  const sig       = request.headers.get('x-admin-signature') as `0x${string}` | null
  const nonceHdr  = request.headers.get('x-admin-nonce')     as `0x${string}` | null
  const tsHdr     = request.headers.get('x-admin-timestamp')

  if (!sig || !nonceHdr || !tsHdr) {
    return NextResponse.json({ error: 'Missing admin auth headers' }, { status: 401 })
  }

  const message: AdminActionMessage = {
    action:    'setPlatformFee',
    nonce:     nonceHdr,
    timestamp: BigInt(tsHdr),
  }

  const { ok, reason } = await verifyAdminSignature(sig, message)
  if (!ok) {
    return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 })
  }

  let bps: number
  try {
    const body = await request.json() as { bps?: unknown }
    bps = Number(body.bps)
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  if (!Number.isInteger(bps) || bps < 0 || bps > 3000) {
    return NextResponse.json({ error: 'bps must be integer between 0 and 3000' }, { status: 400 })
  }

  if (!CONTRACT_ADDRESS) {
    return NextResponse.json({ error: 'Contract not configured' }, { status: 503 })
  }

  try {
    const pkRaw = process.env.OPERATOR_PRIVATE_KEY
    if (!pkRaw) throw new Error('OPERATOR_PRIVATE_KEY not set')
    const pk = pkRaw.startsWith('0x') ? pkRaw as `0x${string}` : `0x${pkRaw}` as `0x${string}`
    const account = privateKeyToAccount(pk)
    const chain   = getChain()
    const rpcUrl  = chain.id === 43114
      ? process.env.NEXT_PUBLIC_RPC_MAINNET
      : process.env.NEXT_PUBLIC_RPC_FUJI

    const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) })
    const txHash = await wallet.writeContract({
      address:      CONTRACT_ADDRESS,
      abi:          WASIAI_MARKETPLACE_ABI,
      functionName: 'setPlatformFee',
      args:         [bps],
    })

    logger.info('[admin/fee] setPlatformFee tx', { txHash, bps })
    return NextResponse.json({ ok: true, txHash, bps })
  } catch (err) {
    logger.error('[admin/fee] error', { err })
    return NextResponse.json(
      { error: 'Transaction failed', detail: String(err).slice(0, 300) },
      { status: 500 },
    )
  }
}
