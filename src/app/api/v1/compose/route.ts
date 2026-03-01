// src/app/api/v1/compose/route.ts
// HU-5.1 — Agent Compose API (POST /api/v1/compose)
// Next.js 14 App Router | createServiceClient | viem v2 | no ethers | no hardcodes
//
// Interface: agent_slug + pass_output (story spec)
// Rate limit: getComposeLimit() de @/lib/ratelimit (rl:compose, 10/1m)
// Receipts: signReceipt() por step de @/lib/receipts/signReceipt
// DB: agent_calls con pipeline_id + step_index, pipeline_executions para tracking

import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomUUID }    from 'crypto'
import { createServiceClient }       from '@/lib/supabase/server'
import { validateEndpointUrl }       from '@/lib/security/validateEndpointUrl'
import { getComposeLimit, getCreatorRpmLimit, getCreatorRpdLimit } from '@/lib/ratelimit'
import { signReceipt }               from '@/lib/receipts/signReceipt'
import { keyHashToBytes32 }          from '@/lib/contracts/marketplaceClient'

// ── Constantes (env-driven, no hardcodes) ────────────────────────────────────
const MAX_STEPS       = 5
const STEP_TIMEOUT_MS = parseInt(process.env.COMPOSE_STEP_TIMEOUT_MS?.trim() ?? '8000', 10)

// ── Tipos ────────────────────────────────────────────────────────────────────
interface ComposeStep {
  agent_slug:   string
  input?:       string
  pass_output?: boolean
}

interface ComposeRequest {
  steps: ComposeStep[]
}

interface StepReceipt {
  step:              number
  agent_slug:        string
  cost_usdc:         string
  receipt_signature: string
  call_id:           string
}

interface ComposeResponse {
  pipeline_id:     string
  steps_executed:  number
  total_cost_usdc: string
  result:          unknown
  receipts:        StepReceipt[]
}

interface PipelineFailedResponse {
  error:            string
  code:             'step_failed'
  failed_step:      number
  reason:           string
  steps_executed:   number
  partial_receipts: StepReceipt[]
}

interface AgentRow {
  id:             string
  slug:           string
  name:           string
  price_per_call: number
  endpoint_url:   string
  status:         string
  max_rpm:        number
  max_rpd:        number
}

interface KeyRow {
  id:          string
  key_hash:    string
  is_active:   boolean
  budget_usdc: number
  spent_usdc:  number
}

// ── Handler principal ────────────────────────────────────────────────────────
export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = createServiceClient()

  // ── [0] RATE LIMIT ────────────────────────────────────────────────────────
  const rawKey  = request.headers.get('x-api-key')?.trim() ?? ''
  const keyHash = rawKey
    ? createHash('sha256').update(rawKey).digest('hex')
    : 'anonymous'

  const limiter    = getComposeLimit()
  const identifier = `key:${keyHash.slice(0, 24)}`
  const { success, limit, reset } = await limiter.limit(identifier)

  if (!success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', code: 'rate_limited', limit, remaining: 0, reset_at: new Date(reset).toISOString() },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit':     String(limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset':     String(reset),
          'Retry-After':           String(Math.ceil((reset - Date.now()) / 1000)),
        },
      },
    )
  }

  // ── [1] AUTH ──────────────────────────────────────────────────────────────
  if (!rawKey) {
    return NextResponse.json(
      { error: 'Invalid or inactive API key', code: 'invalid_key' },
      { status: 401 },
    )
  }

  const { data: keyRow, error: keyError } = await supabase
    .from('agent_keys')
    .select('id, key_hash, is_active, budget_usdc, spent_usdc')
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .single<KeyRow>()

  if (keyError || !keyRow) {
    return NextResponse.json(
      { error: 'Invalid or inactive API key', code: 'invalid_key' },
      { status: 401 },
    )
  }

  // ── [2] PARSE + VALIDAR BODY ──────────────────────────────────────────────
  let body: ComposeRequest
  try {
    body = await request.json() as ComposeRequest
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'validation_error' },
      { status: 400 },
    )
  }

  const validationError = validateSteps(body?.steps)
  if (validationError) {
    return NextResponse.json(
      { error: validationError, code: 'validation_error' },
      { status: 400 },
    )
  }

  const steps = body.steps

  // ── [3] RESOLVER AGENTES (1 query batch) ─────────────────────────────────
  const slugs = [...new Set(steps.map(s => s.agent_slug))]
  const { data: agentsData } = await supabase
    .from('agents')
    .select('id, slug, name, price_per_call, endpoint_url, status, max_rpm, max_rpd')
    .in('slug', slugs)
    .eq('status', 'active')

  const agentMap = new Map<string, AgentRow>(
    (agentsData ?? []).map((a: AgentRow) => [a.slug, a]),
  )

  for (let i = 0; i < steps.length; i++) {
    if (!agentMap.has(steps[i].agent_slug)) {
      return NextResponse.json(
        { error: 'Agent not found', code: 'agent_not_found', step: i, slug: steps[i].agent_slug },
        { status: 404 },
      )
    }
  }

  // ── [4] PREFLIGHT DE SALDO ────────────────────────────────────────────────
  const totalRequired = steps.reduce(
    (acc, s) => acc + (agentMap.get(s.agent_slug)?.price_per_call ?? 0),
    0,
  )
  const available = keyRow.budget_usdc - keyRow.spent_usdc

  if (available < totalRequired) {
    return NextResponse.json(
      {
        error:          'Insufficient balance',
        code:           'insufficient_balance',
        required_usdc:  totalRequired.toFixed(6),
        available_usdc: available.toFixed(6),
      },
      { status: 402 },
    )
  }

  // ── [5] SSRF PREFLIGHT (todos los endpoints antes de ejecutar) ────────────
  for (let i = 0; i < steps.length; i++) {
    const agent = agentMap.get(steps[i].agent_slug)!
    try {
      validateEndpointUrl(agent.endpoint_url)
    } catch {
      return NextResponse.json(
        {
          error:            `Pipeline failed at step ${i}`,
          code:             'step_failed',
          failed_step:      i,
          reason:           'SSRF_BLOCKED',
          steps_executed:   0,
          partial_receipts: [],
        } satisfies PipelineFailedResponse,
        { status: 422 },
      )
    }
  }

  // ── [6] LOOP SECUENCIAL ───────────────────────────────────────────────────
  const pipelineId = randomUUID()
  const receipts: StepReceipt[] = []
  let lastOutput: string | null = null

  // Crear pipeline_executions provisional para tracking
  await supabase.from('pipeline_executions').insert({
    id:              pipelineId,
    key_id:          keyRow.id,
    steps_requested: steps.length,
    steps_completed: 0,
    total_cost_usdc: 0,
    status:          'failed',
  }).then(() => {}, () => {/* best-effort */})

  try {
    for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
      const step  = steps[stepIndex]
      const agent = agentMap.get(step.agent_slug)!

      // [6a] Construir input del step
      let stepInput: string
      if (stepIndex === 0) {
        stepInput = step.input ?? ''
      } else if (step.pass_output) {
        stepInput = lastOutput ?? ''
      } else {
        stepInput = step.input ?? ''
      }

      // [6a.5] HU-8.4: Creator rate limit check per step (FAST fix — bypass bug)
      const consumerRlId = `${step.agent_slug}:${rawKey.substring(0, 24)}`
      // AR-fix: fail-open if Upstash unavailable
      try {
        const rpmOk = await getCreatorRpmLimit(step.agent_slug, agent.max_rpm ?? 60).limit(consumerRlId)
        if (!rpmOk.success) {
          return NextResponse.json(
            { error: `Rate limit exceeded for agent ${step.agent_slug}`, code: 'rate_limited', failed_step: stepIndex },
            { status: 429, headers: { 'Retry-After': String(Math.ceil((rpmOk.reset - Date.now()) / 1000)) } },
          )
        }
        const rpdOk = await getCreatorRpdLimit(step.agent_slug, agent.max_rpd ?? 1000).limit(consumerRlId)
        if (!rpdOk.success) {
          return NextResponse.json(
            { error: `Daily limit reached for agent ${step.agent_slug}`, code: 'daily_limit_reached', failed_step: stepIndex },
            { status: 429, headers: { 'Retry-After': String(Math.ceil((rpdOk.reset - Date.now()) / 1000)) } },
          )
        }
      } catch {
        console.warn('[rate-limit] Creator rate limit check failed (fail-open)', { slug: step.agent_slug })
      }

      // [6b] Deducir saldo atómicamente ANTES del fetch (uso de deduct_key_balance para atomicidad)
      const { data: deductOk, error: deductError } = await supabase.rpc(
        'deduct_key_balance',
        { p_key_id: keyRow.id, p_amount: agent.price_per_call },
      )

      if (deductError || deductOk === false) {
        return NextResponse.json(
          {
            error:            `Pipeline failed at step ${stepIndex}`,
            code:             'step_failed',
            failed_step:      stepIndex,
            reason:           'Insufficient balance (race condition detected)',
            steps_executed:   stepIndex,
            partial_receipts: receipts,
          } satisfies PipelineFailedResponse,
          { status: 422 },
        )
      }

      // [6c] Llamar al agente externo
      const startMs = Date.now()
      let stepOutput: unknown
      let stepStatus: 'success' | 'error' = 'success'
      let stepErrorReason = ''

      try {
        const res = await fetch(agent.endpoint_url, {
          method:  'POST',
          headers: {
            'Content-Type':   'application/json',
            'X-Pipeline-Id':  pipelineId,
            'X-Pipeline-Step': String(stepIndex),
          },
          body:    JSON.stringify({ input: stepInput }),
          signal:  AbortSignal.timeout(STEP_TIMEOUT_MS),
          redirect: 'error',
        })

        if (res.ok) {
          const ct = res.headers.get('content-type') ?? ''
          stepOutput = ct.includes('application/json') ? await res.json() : await res.text()
        } else {
          stepStatus      = 'error'
          stepErrorReason = `Upstream ${res.status}`
          stepOutput      = { error: stepErrorReason }
        }
      } catch (err) {
        stepStatus      = 'error'
        stepErrorReason = err instanceof Error && err.name === 'TimeoutError'
          ? 'TIMEOUT'
          : `Upstream unreachable: ${String(err)}`
        stepOutput = { error: stepErrorReason }
      }

      const latencyMs = Date.now() - startMs

      // [6d] Log en agent_calls con pipeline_id + step_index
      let callId = ''
      try {
        const { data: callRecord } = await supabase
          .from('agent_calls')
          .insert({
            agent_id:    agent.id,
            caller_type: 'agent',
            amount_paid: agent.price_per_call,
            tx_hash:     null,
            status:      stepStatus,
            latency_ms:  latencyMs,
            key_id:      keyRow.id,
            is_trial:    false,
            pipeline_id: pipelineId,
            step_index:  stepIndex,
          })
          .select('id')
          .single()
        callId = callRecord?.id ?? ''
      } catch {
        // best-effort — no abortar el pipeline por fallo de log
      }

      // [6e] Firmar receipt del step (best-effort)
      let signature = ''
      try {
        const receiptTimestamp = Math.floor(Date.now() / 1000)
        signature = await signReceipt({
          keyId:      keyHashToBytes32(keyRow.key_hash),
          callId,
          agentSlug:  agent.slug,
          amountUsdc: agent.price_per_call,
          timestamp:  receiptTimestamp,
        })
        // Guardar signature en DB (fire-and-forget)
        supabase
          .from('agent_calls')
          .update({ receipt_signature: signature })
          .eq('id', callId)
          .then(undefined, () => {/* best-effort */})
      } catch {
        // sign failed — continuar sin abortar
      }

      // [6f] Evaluar resultado del step
      if (stepStatus === 'error') {
        // Actualizar pipeline_executions como parcial/fallido
        supabase
          .from('pipeline_executions')
          .update({
            status:          receipts.length === 0 ? 'failed' : 'partial',
            steps_completed: stepIndex,
            total_cost_usdc: receipts.reduce((acc, r) => acc + parseFloat(r.cost_usdc), 0),
            failed_at_step:  stepIndex + 1,
            error_detail:    stepErrorReason,
            completed_at:    new Date().toISOString(),
          })
          .eq('id', pipelineId)
          .then(undefined, () => {/* best-effort */})

        return NextResponse.json(
          {
            error:            `Pipeline failed at step ${stepIndex}`,
            code:             'step_failed',
            failed_step:      stepIndex,
            reason:           stepErrorReason,
            steps_executed:   stepIndex,
            partial_receipts: receipts,
          } satisfies PipelineFailedResponse,
          { status: 422 },
        )
      }

      // Step exitoso — acumular
      lastOutput = typeof stepOutput === 'string'
        ? stepOutput
        : JSON.stringify(stepOutput)

      receipts.push({
        step:              stepIndex,
        agent_slug:        agent.slug,
        cost_usdc:         agent.price_per_call.toFixed(6),
        receipt_signature: signature,
        call_id:           callId,
      })

      // Incrementar stats del agente (fire-and-forget)
      supabase
        .rpc('increment_agent_stats', { p_agent_id: agent.id, p_amount: agent.price_per_call })
        .then(undefined, () => {/* best-effort */})
    }
  } catch (unexpectedErr) {
    // Error inesperado — actualizar pipeline como fallido y re-throw
    supabase
      .from('pipeline_executions')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', pipelineId)
      .then(undefined, () => {/* best-effort */})
    throw unexpectedErr
  }

  // ── [7] RESPONSE FINAL ────────────────────────────────────────────────────
  const totalCost = receipts.reduce((acc, r) => acc + parseFloat(r.cost_usdc), 0)

  // Actualizar pipeline_executions como exitoso
  supabase
    .from('pipeline_executions')
    .update({
      status:          'success',
      steps_completed: steps.length,
      total_cost_usdc: totalCost,
      completed_at:    new Date().toISOString(),
    })
    .eq('id', pipelineId)
    .then(undefined, () => {/* best-effort */})

  return NextResponse.json(
    {
      pipeline_id:     pipelineId,
      steps_executed:  steps.length,
      total_cost_usdc: totalCost.toFixed(6),
      result:          parseOutputSafe(lastOutput),
      receipts,
    } satisfies ComposeResponse,
    { status: 200 },
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Valida el array de steps; retorna string de error o null si válido */
export function validateSteps(steps: unknown): string | null {
  if (!Array.isArray(steps))      return 'steps must be an array'
  if (steps.length < 1)           return 'steps must have at least 1 element'
  if (steps.length > MAX_STEPS)   return `Max ${MAX_STEPS} steps per pipeline`

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i] as ComposeStep
    if (!s.agent_slug || typeof s.agent_slug !== 'string') {
      return `Step ${i}: agent_slug is required`
    }
    if (s.input !== undefined && s.pass_output === true) {
      return `Step ${i}: input and pass_output are mutually exclusive`
    }
    if (i === 0 && s.pass_output === true) {
      return 'Step 0 cannot use pass_output (no previous output exists)'
    }
  }
  return null
}

/** Parsea output de forma segura (intenta JSON.parse, si falla devuelve string) */
export function parseOutputSafe(raw: string | null): unknown {
  if (raw === null) return null
  try { return JSON.parse(raw) } catch { return raw }
}
