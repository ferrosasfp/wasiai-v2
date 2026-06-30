import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyAdminSignature, type AdminActionMessage } from '@/lib/admin/verifyAdminSignature'
import { createPublicClient, http } from 'viem'
import { avalancheFuji } from 'viem/chains'

const MARKETPLACE = (process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI ?? '') as `0x${string}`
const EARNINGS_ABI = [
  { name: 'earnings', type: 'function' as const, stateMutability: 'view' as const, inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'uint256' }] },
]

// V-02 (audit 2026-06-25, defense-in-depth): explicit EIP-712 admin gate so a
// future refactor of the DB grant can't silently open this endpoint. Additive —
// the session check below is kept.
async function verifyAuth(request: NextRequest, action: string) {
  const sig      = request.headers.get('x-admin-signature') as `0x${string}` | null
  const nonceHdr = request.headers.get('x-admin-nonce')     as `0x${string}` | null
  const tsHdr    = request.headers.get('x-admin-timestamp')

  if (!sig || !nonceHdr || !tsHdr) return { ok: false, status: 401, reason: 'Missing admin auth headers' }

  const message: AdminActionMessage = { action, nonce: nonceHdr, timestamp: BigInt(tsHdr) }
  const { ok, reason } = await verifyAdminSignature(sig, message)
  return ok ? { ok: true } : { ok: false, status: 401, reason }
}

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req, 'treasuryCreators')
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status ?? 401 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: creators } = await supabase
    .from('creator_pending_earnings')
    .select('creator_id, username, wallet_address, total_calls, total_earned, creator_share')
    .order('creator_share', { ascending: false })

  if (!creators?.length) return NextResponse.json([])

  const rpcUrl = process.env.FUJI_RPC_URL ?? 'https://api.avax-test.network/ext/bc/C/rpc'
  const client = createPublicClient({ chain: avalancheFuji, transport: http(rpcUrl) })

  const withOnChain = await Promise.all(
    creators.map(async c => {
      let settled_usdc = 0
      if (c.wallet_address && MARKETPLACE) {
        try {
          const amt = await client.readContract({ address: MARKETPLACE, abi: EARNINGS_ABI, functionName: 'earnings', args: [c.wallet_address as `0x${string}`] })
          settled_usdc = Number(amt) / 1e6
        } catch { /* best-effort */ }
      }
      return {
        creator_id:   c.creator_id,
        username:     c.username,
        wallet:       c.wallet_address,
        total_calls:  c.total_calls,
        pending_usdc: c.creator_share ?? 0,
        settled_usdc,
        total_usdc:   (c.creator_share ?? 0) + settled_usdc,
      }
    })
  )

  return NextResponse.json(withOnChain)
}
