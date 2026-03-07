/**
 * POST /api/v1/sandbox/invoke/[slug]
 * WAS-75 — Sandbox Gratuito
 *
 * Auth: usuario autenticado via sesión (NO API key)
 * Rate limit: 10 calls / 1 hora por usuario (sliding window)
 * Balance: deducción atómica via deduct_sandbox_balance RPC
 * Reembolso automático si el agente externo falla
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { logger } from '@/lib/logger'
import { validateEndpointUrl } from '@/lib/security/validateEndpointUrl'
import { checkIpLimit } from '@/lib/rate-limit-ip'

// ── Rate limiter sandbox (lazy singleton) ────────────────────────────────────
let _sandboxLimit: Ratelimit | null = null
function getSandboxLimit(): Ratelimit {
  return _sandboxLimit ??= new Ratelimit({
    redis: new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    }),
    limiter: Ratelimit.slidingWindow(10, '1 h'),
    prefix:  'rl:sandbox',
  })
}

// ── Tipos ────────────────────────────────────────────────────────────────────
interface SandboxInvokeRequest {
  input: Record<string, unknown> | string
}

interface SandboxInvokeResponse {
  result: unknown
  cost_usdc: string
  balance_remaining: string
  call_id: string
}

interface SandboxInsufficientResponse {
  error: 'Insufficient sandbox credits'
  code: 'insufficient_sandbox_credits'
  balance_usdc: string
  required_usdc: string
}

interface SandboxRateLimitResponse {
  error: 'Rate limit exceeded'
  code: 'sandbox_rate_limited'
  limit: number
  reset_at: string
}

interface AgentRow {
  id: string
  endpoint_url: string
  price_per_call: number
  status: string
}

interface SandboxCreditsRow {
  balance_usdc: number
}

// ── Handler ───────────────────────────────────────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const supabase = await createClient()

  // 1. Auth (optional — anonymous allowed)
  const { data: { user } } = await supabase.auth.getUser()
  const isAnonymous = !user

  // 1b. IP rate limit for anonymous users — 5 calls/day
  if (isAnonymous) {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
    const { success, reset } = await checkIpLimit(ip, 'sandbox-anon', 5)
    if (!success) {
      return NextResponse.json({
        error: 'Anonymous rate limit exceeded',
        code: 'anon_rate_limited',
        limit: 5,
        remaining: 0,
        reset_at: new Date(reset).toISOString(),
        message: 'Crea una cuenta gratuita para seguir probando',
      }, { status: 429 })
    }
  }

  // 2. Rate limit — sliding window 10 calls / 1 hora (authenticated only)
  if (!isAnonymous) {
    const { success, limit, reset } = await getSandboxLimit().limit(user!.id)
    if (!success) {
      const body: SandboxRateLimitResponse = {
        error:    'Rate limit exceeded',
        code:     'sandbox_rate_limited',
        limit,
        reset_at: new Date(reset).toISOString(),
      }
      return NextResponse.json(body, { status: 429 })
    }
  }

  // 3. Obtener agente por slug
  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .select('id, endpoint_url, price_per_call, status')
    .eq('slug', slug)
    .single<AgentRow>()

  if (agentError || !agent || agent.status !== 'active') {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  // 4-6. Balance check & deduction (authenticated only)
  if (!isAnonymous) {
    // 4. Obtener/crear fila sandbox_credits (ignorar duplicados)
    await supabase
      .from('sandbox_credits')
      .upsert({ user_id: user!.id }, { onConflict: 'user_id', ignoreDuplicates: true })

    const { data: creditsRow, error: creditsError } = await supabase
      .from('sandbox_credits')
      .select('balance_usdc')
      .eq('user_id', user!.id)
      .single<SandboxCreditsRow>()

    if (creditsError || !creditsRow) {
      logger.error('[sandbox/invoke] No se pudo obtener sandbox_credits', { userId: user!.id })
      return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }

    // 5. Verificar balance previo a deducción
    if (creditsRow.balance_usdc < agent.price_per_call) {
      const body: SandboxInsufficientResponse = {
        error:         'Insufficient sandbox credits',
        code:          'insufficient_sandbox_credits',
        balance_usdc:  creditsRow.balance_usdc.toString(),
        required_usdc: agent.price_per_call.toString(),
      }
      return NextResponse.json(body, { status: 402 })
    }

    // 6. Deducir balance atómicamente via DB function
    const { data: deducted, error: deductError } = await supabase
      .rpc('deduct_sandbox_balance', {
        p_user_id: user!.id,
        p_amount:  agent.price_per_call,
      })

    if (deductError || !deducted) {
      const { data: freshRow } = await supabase
        .from('sandbox_credits')
        .select('balance_usdc')
        .eq('user_id', user!.id)
        .single<SandboxCreditsRow>()

      const body: SandboxInsufficientResponse = {
        error:         'Insufficient sandbox credits',
        code:          'insufficient_sandbox_credits',
        balance_usdc:  (freshRow?.balance_usdc ?? 0).toString(),
        required_usdc: agent.price_per_call.toString(),
      }
      return NextResponse.json(body, { status: 402 })
    }
  }

  // 7. Validar endpoint_url contra SSRF (B-02)
  try {
    validateEndpointUrl(agent.endpoint_url)
  } catch {
    // Reembolso atómico antes de retornar (authenticated only)
    if (!isAnonymous) {
      await supabase.rpc('refund_sandbox_balance', {
        p_user_id: user!.id,
        p_amount:  agent.price_per_call,
      })
    }
    return NextResponse.json({ error: 'invalid_endpoint' }, { status: 422 })
  }

  // 8. Parsear body de la request
  let input: Record<string, unknown> | string = {}
  try {
    const rawBody = await req.json() as SandboxInvokeRequest
    input = rawBody.input ?? {}
  } catch {
    // body vacío — usar input vacío
  }

  // 9. Llamar agente externo (timeout 8s)
  let agentResult: unknown = null
  let agentFailed = false

  try {
    const agentResponse = await fetch(agent.endpoint_url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ input }),
      signal:  AbortSignal.timeout(8000),
    })

    if (!agentResponse.ok) {
      agentFailed = true
    } else {
      agentResult = await agentResponse.json()
    }
  } catch (err) {
    logger.warn('[sandbox/invoke] Agent invocation failed', { slug, err })
    agentFailed = true
  }

  // 9b. Reembolso si el agente falló — incremento atómico (B-01)
  if (agentFailed) {
    if (!isAnonymous) {
      await supabase.rpc('refund_sandbox_balance', {
        p_user_id: user!.id,
        p_amount:  agent.price_per_call,
      })
    }
    return NextResponse.json({ error: 'Agent invocation failed' }, { status: 422 })
  }

  // 10. Registrar en agent_calls
  const callId = randomUUID()
  await supabase.from('agent_calls').insert({
    id:           callId,
    agent_id:     agent.id,
    caller_id:    user?.id ?? null,
    caller_type:  'human',
    amount_paid:  agent.price_per_call,  // columna real (no cost_usdc)
    is_trial:     true,
    payment_type: 'sandbox',
    status:       'completed',
    called_at:    new Date().toISOString(),
  })

  // 11. Obtener balance restante actualizado
  let balanceRemaining: string
  if (isAnonymous) {
    balanceRemaining = '0'
  } else {
    const { data: updatedCredits } = await supabase
      .from('sandbox_credits')
      .select('balance_usdc')
      .eq('user_id', user!.id)
      .single<SandboxCreditsRow>()
    balanceRemaining = (updatedCredits?.balance_usdc ?? 0).toString()
  }

  // 12. Respuesta final
  const responseBody: SandboxInvokeResponse = {
    result:            agentResult,
    cost_usdc:         agent.price_per_call.toString(),
    balance_remaining: balanceRemaining,
    call_id:           callId,
  }

  return NextResponse.json(responseBody, { status: 200 })
}
