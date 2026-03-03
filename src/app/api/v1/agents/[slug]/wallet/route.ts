/**
 * POST /api/v1/agents/[slug]/wallet — inicializar wallet del agente
 * GET  /api/v1/agents/[slug]/wallet — address + balance Fuji
 *
 * WAS-71 — Auth: sesión Supabase + ownership check
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  generateAgentWallet,
  getAgentWalletAddress,
  getAgentWalletBalance,
  getAgentWalletUsdcBalance,
} from '@/lib/agent-wallets/agentWallet'

interface Params { params: Promise<{ slug: string }> }

async function getAgentWithOwnership(slug: string, userId: string) {
  const supabase = await createClient()
  const { data: agent, error } = await supabase
    .from('agents')
    .select('id, creator_id')
    .eq('slug', slug)
    .single()

  if (error || !agent) return { agent: null, error: 'not_found' as const }
  if (agent.creator_id !== userId) return { agent: null, error: 'forbidden' as const }
  return { agent, error: null }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { slug } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { agent, error } = await getAgentWithOwnership(slug, user.id)
  if (error === 'not_found') return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  if (error === 'forbidden')  return NextResponse.json({ error: 'Not owner' }, { status: 403 })

  try {
    const { address } = await generateAgentWallet(agent!.id)
    return NextResponse.json({ address })
  } catch (err) {
    console.error('[POST /wallet] Error:', (err as Error).message)  // solo message, no stack con key
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest, { params }: Params) {
  const { slug } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { agent, error } = await getAgentWithOwnership(slug, user.id)
  if (error === 'not_found') return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  if (error === 'forbidden')  return NextResponse.json({ error: 'Not owner' }, { status: 403 })

  const address = await getAgentWalletAddress(agent!.id)

  if (!address) {
    return NextResponse.json({ address: null, balanceWei: '0', balanceFormatted: '0' })
  }

  const [{ balanceWei, balanceFormatted }, { balanceUsdcFormatted }] = await Promise.all([
    getAgentWalletBalance(address),
    getAgentWalletUsdcBalance(address),
  ])
  return NextResponse.json({ address, balanceWei, balanceFormatted, balanceUsdcFormatted })
}
