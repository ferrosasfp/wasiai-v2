import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminSignature, type AdminActionMessage } from '@/lib/admin/verifyAdminSignature'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { avalanche, avalancheFuji } from 'viem/chains'
import { WASIAI_MARKETPLACE_ABI } from '@/lib/contracts/WasiAIMarketplace'
import { logger } from '@/lib/logger'

const CONTRACT_ADDRESS = (process.env.MARKETPLACE_CONTRACT_ADDRESS ?? '') as `0x${string}`

function getChain() {
  return Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113) === 43114 ? avalanche : avalancheFuji
}

function getRpcUrl(chainId: number) {
  return chainId === 43114
    ? process.env.NEXT_PUBLIC_RPC_MAINNET
    : process.env.NEXT_PUBLIC_RPC_FUJI
}

function getWalletClient() {
  const pkRaw = process.env.OPERATOR_PRIVATE_KEY
  if (!pkRaw) throw new Error('OPERATOR_PRIVATE_KEY not set')
  const pk      = pkRaw.startsWith('0x') ? pkRaw as `0x${string}` : `0x${pkRaw}` as `0x${string}`
  const account = privateKeyToAccount(pk)
  const chain   = getChain()
  return createWalletClient({ account, chain, transport: http(getRpcUrl(chain.id)) })
}

async function verifyAuth(request: NextRequest, action: string) {
  const sig      = request.headers.get('x-admin-signature') as `0x${string}` | null
  const nonceHdr = request.headers.get('x-admin-nonce')     as `0x${string}` | null
  const tsHdr    = request.headers.get('x-admin-timestamp')

  if (!sig || !nonceHdr || !tsHdr) return { ok: false, status: 401, reason: 'Missing admin auth headers' }

  const message: AdminActionMessage = { action, nonce: nonceHdr, timestamp: BigInt(tsHdr) }
  const { ok, reason } = await verifyAdminSignature(sig, message)
  return ok ? { ok: true } : { ok: false, status: 401, reason }
}

/**
 * GET /api/admin/fee
 * Retorna estado actual del timelock: platformFeeBps, pendingFeeBps, pendingFeeTimestamp.
 */
export async function GET() {
  if (!CONTRACT_ADDRESS) return NextResponse.json({ error: 'Contract not configured' }, { status: 503 })
  try {
    const chain  = getChain()
    const client = createPublicClient({ chain, transport: http(getRpcUrl(chain.id)) })
    const [current, pending, ts] = await Promise.all([
      client.readContract({ address: CONTRACT_ADDRESS, abi: WASIAI_MARKETPLACE_ABI, functionName: 'platformFeeBps' }),
      client.readContract({ address: CONTRACT_ADDRESS, abi: WASIAI_MARKETPLACE_ABI, functionName: 'pendingFeeBps' }),
      client.readContract({ address: CONTRACT_ADDRESS, abi: WASIAI_MARKETPLACE_ABI, functionName: 'pendingFeeTimestamp' }),
    ])
    return NextResponse.json({
      platformFeeBps:      current,
      pendingFeeBps:       pending,
      pendingFeeTimestamp: ts?.toString() ?? '0',
      executeAfter:        ts ? new Date(Number(ts) * 1000).toISOString() : null,
    })
  } catch (err) {
    logger.error('[admin/fee] GET error', { err })
    return NextResponse.json({ error: 'Read failed', detail: String(err).slice(0, 300) }, { status: 500 })
  }
}

/**
 * POST /api/admin/fee
 * Step 1: propone nuevo fee. Ejecutable después de 48h via PUT.
 * Body: { bps: number }
 */
export async function POST(request: NextRequest) {
  const auth = await verifyAuth(request, 'proposeFee')
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status })

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

  if (!CONTRACT_ADDRESS) return NextResponse.json({ error: 'Contract not configured' }, { status: 503 })

  try {
    const wallet = getWalletClient()
    const txHash = await wallet.writeContract({
      address: CONTRACT_ADDRESS, abi: WASIAI_MARKETPLACE_ABI,
      functionName: 'proposeFee', args: [bps],
    })
    logger.info('[admin/fee] proposeFee tx', { txHash, bps })
    return NextResponse.json({ ok: true, txHash, bps, note: 'Fee proposed. Execute after 48h via PUT /api/admin/fee' })
  } catch (err) {
    logger.error('[admin/fee] POST error', { err })
    return NextResponse.json({ error: 'Transaction failed', detail: String(err).slice(0, 300) }, { status: 500 })
  }
}

/**
 * PUT /api/admin/fee
 * Step 2: ejecuta el fee propuesto (después de 48h de timelock).
 */
export async function PUT(request: NextRequest) {
  const auth = await verifyAuth(request, 'executeFee')
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status })

  if (!CONTRACT_ADDRESS) return NextResponse.json({ error: 'Contract not configured' }, { status: 503 })

  try {
    const wallet = getWalletClient()
    const txHash = await wallet.writeContract({
      address: CONTRACT_ADDRESS, abi: WASIAI_MARKETPLACE_ABI,
      functionName: 'executeFee', args: [],
    })
    logger.info('[admin/fee] executeFee tx', { txHash })
    return NextResponse.json({ ok: true, txHash })
  } catch (err) {
    logger.error('[admin/fee] PUT error', { err })
    return NextResponse.json({ error: 'Transaction failed', detail: String(err).slice(0, 300) }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/fee
 * Cancela un fee propuesto.
 */
export async function DELETE(request: NextRequest) {
  const auth = await verifyAuth(request, 'cancelFee')
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status })

  if (!CONTRACT_ADDRESS) return NextResponse.json({ error: 'Contract not configured' }, { status: 503 })

  try {
    const wallet = getWalletClient()
    const txHash = await wallet.writeContract({
      address: CONTRACT_ADDRESS, abi: WASIAI_MARKETPLACE_ABI,
      functionName: 'cancelFee', args: [],
    })
    logger.info('[admin/fee] cancelFee tx', { txHash })
    return NextResponse.json({ ok: true, txHash })
  } catch (err) {
    logger.error('[admin/fee] DELETE error', { err })
    return NextResponse.json({ error: 'Transaction failed', detail: String(err).slice(0, 300) }, { status: 500 })
  }
}
