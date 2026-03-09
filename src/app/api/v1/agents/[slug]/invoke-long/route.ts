/**
 * POST /api/v1/agents/[slug]/invoke-long
 *
 * Invoke a long-running agent using on-chain USDC escrow.
 * 1. Verifies agent.long_running = true and agent.status = 'active'
 * 2. Verifies API key (same as invoke route)
 * 3. Calls WasiEscrow.createEscrow() via viem v2 operator wallet
 * 4. Inserts row in escrow_transactions with status = 'pending'
 * 5. Returns 202 with escrow_id and poll_url
 *
 * @dev Fuji testnet ONLY (chainId: 43113)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createEscrowOnChain } from '@/lib/contracts/escrow'
import { keccak256, encodePacked, type Address } from 'viem'
import { logger } from '@/lib/logger'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
}

const CHAIN_ID = BigInt(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
const APP_URL  = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.wasiai.io'

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const svc = createServiceClient()

  // ── Auth: API key ──────────────────────────────────────────────────────────
  const apiKey = request.headers.get('X-API-Key') ?? request.headers.get('x-api-key')
  if (!apiKey) {
    return NextResponse.json(
      { error: 'payment_required', message: 'X-API-Key header required' },
      { status: 402, headers: CORS },
    )
  }

  const keyHash = Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey)),
  ).toString('hex')

  const { data: keyData } = await svc
    .from('agent_keys')
    .select('user_id, balance_usdc')
    .eq('key_hash', keyHash)
    .eq('status', 'active')
    .single()

  if (!keyData) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Invalid or inactive API key' },
      { status: 401, headers: CORS },
    )
  }

  // ── Verify agent is long_running ───────────────────────────────────────────
  const { data: agent } = await svc
    .from('agents')
    .select('id, slug, status, long_running, price_per_call')
    .eq('slug', slug)
    .single()

  if (!agent || agent.status !== 'active') {
    return NextResponse.json(
      { error: 'not_found', message: 'Agent not found or inactive' },
      { status: 404, headers: CORS },
    )
  }

  if (!agent.long_running) {
    return NextResponse.json(
      { error: 'not_long_running', message: 'Use /invoke for standard agents' },
      { status: 400, headers: CORS },
    )
  }

  // ── Parse ERC-3009 authorization from body ─────────────────────────────────
  let body: {
    erc3009: {
      from: string
      to: string
      value: string
      validAfter: number
      validBefore: number
      nonce: string
      v: number
      r: string
      s: string
    }
    agentInput?: Record<string, unknown>
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'bad_request', message: 'Invalid JSON body' },
      { status: 400, headers: CORS },
    )
  }

  const { erc3009, agentInput = {} } = body

  if (!erc3009?.from || !erc3009?.value) {
    return NextResponse.json(
      { error: 'bad_request', message: 'erc3009 authorization required' },
      { status: 400, headers: CORS },
    )
  }

  // ── Compute escrowId ───────────────────────────────────────────────────────
  const payer   = erc3009.from as Address
  const amount  = BigInt(erc3009.value)
  const nonce   = erc3009.nonce as `0x${string}`

  const escrowId = keccak256(
    encodePacked(
      ['string', 'address', 'uint256', 'bytes32', 'uint256'],
      [slug, payer, amount, nonce, CHAIN_ID],
    ),
  )

  // ── Create escrow on-chain ─────────────────────────────────────────────────
  const txHash = await createEscrowOnChain({
    escrowId,
    slug,
    payer,
    amount,
    validAfter:  BigInt(erc3009.validAfter),
    validBefore: BigInt(erc3009.validBefore),
    nonce,
    v: erc3009.v,
    r: erc3009.r as `0x${string}`,
    s: erc3009.s as `0x${string}`,
  })

  // ── Insert into escrow_transactions ───────────────────────────────────────
  const amountUsdc = Number(amount) / 1_000_000
  const LONG_RUNNING_MS = 24 * 60 * 60 * 1000  // 24h
  const STANDARD_MS = 90 * 1000                  // 90s
  const estimatedCompletion = new Date(
    Date.now() + (agent.long_running ? LONG_RUNNING_MS : STANDARD_MS)
  ).toISOString()

  const { error: insertError } = await svc
    .from('escrow_transactions')
    .insert({
      escrow_id:     escrowId,
      agent_slug:    slug,
      payer_address: payer,
      payer_user_id: keyData.user_id,
      amount_usdc:   amountUsdc,
      status:        'pending',
      tx_create:     txHash,
    })

  if (insertError) {
    logger.error('[invoke-long] DB insert failed', { insertError })
    // Non-fatal if on-chain tx succeeded — escrow exists on-chain
  }

  // ── Dispatch agent async (fire-and-forget) ─────────────────────────────────
  // No await — agent runs asynchronously
  const agentRunnerUrl = `${APP_URL}/api/v1/internal/agents/${slug}/run`
  fetch(agentRunnerUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ escrowId, agentInput }),
  }).catch((err) => {
    logger.warn('[invoke-long] agent runner dispatch failed', { err: String(err) })
  })

  return NextResponse.json(
    {
      escrow_id:            escrowId,
      status:               'pending',
      estimated_completion: estimatedCompletion,
      poll_url:             `/api/v1/escrow/${escrowId}/status`,
    },
    { status: 202, headers: CORS },
  )
}
