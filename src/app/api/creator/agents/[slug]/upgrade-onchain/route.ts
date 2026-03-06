/**
 * POST /api/creator/agents/[slug]/upgrade-onchain — WAS-160c
 *
 * Upgrade an off-chain agent to on-chain after creator signs selfRegisterAgent() client-side.
 * Backend verifies the tx receipt on-chain before updating DB (HAL-025 pattern).
 */
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { validateCsrf } from '@/lib/security/csrf'
import { createPublicClient, http, decodeEventLog, keccak256, toHex } from 'viem'
import { avalanche, avalancheFuji } from 'viem/chains'
import { logger } from '@/lib/logger'
import { WASIAI_MARKETPLACE_ABI } from '@/lib/contracts/WasiAIMarketplace'
import { getRegisterLimit, getIdentifier, checkRateLimit } from '@/lib/ratelimit'

const upgradeSchema = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash'),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const csrfError = validateCsrf(req)
  if (csrfError) return csrfError

  // NG-102: Rate limiting — reutiliza register limit (5/h por IP)
  const rlHit = await checkRateLimit(getRegisterLimit(), getIdentifier(req))
  if (rlHit) return rlHit

  const { slug } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const result = upgradeSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: result.error.flatten() },
      { status: 400 },
    )
  }

  const serviceClient = createServiceClient()

  // Ownership check
  const { data: existing } = await serviceClient
    .from('agents')
    .select('id, creator_id, registration_type, slug, price_per_call')
    .eq('slug', slug)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }
  if (existing.creator_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (existing.registration_type === 'on_chain') {
    return NextResponse.json({ error: 'Agent is already registered on-chain' }, { status: 409 })
  }

  // HAL-025: Verify receipt on-chain before updating DB
  try {
    const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
    const chain = chainId === 43114 ? avalanche : avalancheFuji
    const rpcUrl = (chainId === 43114
      ? process.env.NEXT_PUBLIC_RPC_MAINNET
      : process.env.NEXT_PUBLIC_RPC_TESTNET
    )?.trim() || undefined

    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: result.data.txHash as `0x${string}`,
      timeout: 30_000,
    })

    if (receipt.status === 'reverted') {
      return NextResponse.json(
        { error: 'Transaction was reverted on-chain' },
        { status: 422 },
      )
    }

    // NG-101: Verify tx target is the correct marketplace contract
    const contractAddress = process.env.MARKETPLACE_CONTRACT_ADDRESS
    if (!contractAddress) {
      return NextResponse.json(
        { error: 'Marketplace contract not configured' },
        { status: 500 },
      )
    }

    if (receipt.to?.toLowerCase() !== contractAddress.toLowerCase()) {
      logger.warn('[upgrade-onchain] TX target mismatch', {
        slug,
        expected: contractAddress,
        actual: receipt.to,
      })
      return NextResponse.json(
        { error: 'Transaction is not directed to the WasiAI Marketplace contract' },
        { status: 422 },
      )
    }

    // NG-101: Verify AgentRegistered event with correct slug
    // Note: slug is an indexed string, so it appears as keccak256 hash in topics
    const slugHash = keccak256(toHex(slug))
    const agentRegisteredEvent = receipt.logs
      .map(log => {
        try {
          return decodeEventLog({
            abi: WASIAI_MARKETPLACE_ABI,
            data: log.data,
            topics: log.topics,
          })
        } catch {
          return null
        }
      })
      .find(
        decoded =>
          decoded?.eventName === 'AgentRegistered' &&
          (decoded.args as { slug?: string })?.slug === slugHash,
      )

    if (!agentRegisteredEvent) {
      logger.warn('[upgrade-onchain] AgentRegistered event not found for slug', {
        slug,
        txHash: result.data.txHash,
        logCount: receipt.logs.length,
      })
      return NextResponse.json(
        { error: 'Transaction does not contain a valid AgentRegistered event for this agent' },
        { status: 422 },
      )
    }

    logger.info('[upgrade-onchain] Receipt verified', {
      slug,
      txHash: result.data.txHash,
      blockNumber: receipt.blockNumber.toString(),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // NG-106: No exponer mensaje interno de RPC al usuario
    logger.error('[upgrade-onchain] Receipt verification failed', { slug, err: msg })
    return NextResponse.json(
      { error: 'Could not verify transaction on-chain. Please try again or contact support.' },
      { status: 422 },
    )
  }

  // Update DB — NG-107: incluir token_id (erc8004Id del evento, 0 = no NFT)
  const { error } = await serviceClient
    .from('agents')
    .update({
      registration_type: 'on_chain',
      on_chain_registered: true,
      chain_registered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      token_id: 0, // erc8004Id — siempre 0 en selfRegisterAgent (no NFT minted yet)
    })
    .eq('id', existing.id)

  if (error) {
    logger.error('[upgrade-onchain] DB update failed', { slug, error: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  logger.info('[upgrade-onchain] Agent upgraded', { slug })
  return NextResponse.json({ status: 'on_chain', slug })
}
