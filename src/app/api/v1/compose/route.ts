// src/app/api/v1/compose/route.ts
// HU-5.1 — Agent Compose API (POST /api/v1/compose)
// HU-5.2 — Ejecución paralela de agentes (parallel: boolean en ComposeStep)
// Next.js 14 App Router | createServiceClient | viem v2 | no ethers | no hardcodes
//
// Interface: agent_slug + pass_output + parallel (story spec)
// Rate limit: getComposeLimit() de @/lib/ratelimit (rl:compose, 10/1m)
// Receipts: signReceipt() por step de @/lib/receipts/signReceipt
// DB: agent_calls con pipeline_id + step_index, pipeline_executions para tracking

import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomUUID }    from 'crypto'
import { createServiceClient }       from '@/lib/supabase/server'
import { validateEndpointUrl }       from '@/lib/security/validateEndpointUrl'
import { getComposeLimit, checkCreatorRateLimits } from '@/lib/ratelimit'
import { signReceipt }               from '@/lib/receipts/signReceipt'
import { keyHashToBytes32 }          from '@/lib/contracts/marketplaceClient'
import { logger }                    from '@/lib/logger'

// ── Constantes (env-driven, no hardcodes) ────────────────────────────────────
const MAX_STEPS       = 5
const STEP_TIMEOUT_MS = parseInt(process.env.COMPOSE_STEP_TIMEOUT_MS?.trim() ?? '8000', 10)

// ── Tipos ────────────────────────────────────────────────────────────────────
interface ComposeStep {
  agent_slug:   string
  input?:       string
  pass_output?: boolean
  parallel?:    boolean  // HU-5.2: si true, agrupa con steps consecutivos parallel
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
  groups_executed: number  // HU-5.2: número de grupos (1 group = N parallel steps)
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

// ── HU-5.2: Agrupador de steps ───────────────────────────────────────────────
/** Agrupa steps consecutivos con parallel:true en sub-arrays */
export function groupSteps(steps: ComposeStep[]): ComposeStep[][] {
  const groups: ComposeStep[][] = []
  let i = 0
  while (i < steps.length) {
    if (steps[i].parallel) {
      const group: ComposeStep[] = []
      while (i < steps.length && steps[i].parallel) group.push(steps[i++])
      groups.push(group)
    } else {
      groups.push([steps[i++]])
    }
  }
  return groups
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

  // ── [6] LOOP POR GRUPOS (secuencial + paralelo) ──────────────────────────
  const pipelineId = randomUUID()
  const receipts: StepReceipt[] = []
  let lastOutput: string | null = null
  // Contexto propagado entre steps (token_address, token_symbol, etc.)
  const pipelineCtx: Record<string, string> = {}
  const groups = groupSteps(steps)
  let globalStepIndex = 0

  // Crear pipeline_executions provisional para tracking
  await supabase.from('pipeline_executions').insert({
    id:              pipelineId,
    key_id:          keyRow.id,
    steps_requested: steps.length,
    steps_completed: 0,
    total_cost_usdc: 0,
    status:          'failed',
  }).then(() => {}, () => {/* best-effort */})

  // ── Helper: ejecutar un step individual ──────────────────────────────────
  const safeKeyRow = keyRow! // guard ya verificado arriba (línea 141)
  async function executeStep(step: ComposeStep, stepIndex: number, stepInput: string): Promise<{
    receipt: StepReceipt | null
    output: string | null
    status: 'success' | 'error'
    reason: string
  }> {
    const agent = agentMap.get(step.agent_slug)!

    // Rate limit check pre-step (fail-open via checkCreatorRateLimits)
    const consumerRlId = `${step.agent_slug}:${rawKey.substring(0, 24)}`
    const rlRes = await checkCreatorRateLimits(step.agent_slug, agent.max_rpm ?? 60, agent.max_rpd ?? 1000, consumerRlId)
    if (rlRes) return { receipt: null, output: null, status: 'error', reason: `rate_limited:${step.agent_slug}` }

    // Deducir saldo
    const { data: deductOk, error: deductError } = await supabase.rpc(
      'deduct_key_balance',
      { p_key_id: safeKeyRow.id, p_amount: agent.price_per_call },
    )
    if (deductError || deductOk === false) {
      return { receipt: null, output: null, status: 'error', reason: 'insufficient_balance' }
    }

    // Llamar al agente externo
    const startMs = Date.now()
    let stepOutput: unknown
    let stepStatus: 'success' | 'error' = 'success'
    let stepErrorReason = ''

    try {
      const res = await fetch(agent.endpoint_url, {
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Pipeline-Id': pipelineId, 'X-Pipeline-Step': String(stepIndex) },
        body:     JSON.stringify({ input: stepInput, ...pipelineCtx }),
        signal:   AbortSignal.timeout(STEP_TIMEOUT_MS),
        redirect: 'error',
      })
      if (res.ok) {
        const ct = res.headers.get('content-type') ?? ''
        stepOutput = ct.includes('application/json') ? await res.json() : await res.text()
      } else {
        stepStatus      = 'error'
        stepErrorReason = `El agente "${agent.slug}" respondió con error ${res.status}. Verifica que su endpoint esté activo y acepte { "input": "..." }.`
        stepOutput      = { error: stepErrorReason }
      }
    } catch (err) {
      stepStatus      = 'error'
      stepErrorReason = err instanceof Error && err.name === 'TimeoutError' ? 'step_timeout' : `Upstream unreachable: ${String(err)}`
      stepOutput      = { error: stepErrorReason }
    }

    const latencyMs = Date.now() - startMs

    // Log en agent_calls
    let callId = ''
    try {
      const { data: callRecord } = await supabase
        .from('agent_calls')
        .insert({ agent_id: agent.id, caller_type: 'agent', amount_paid: agent.price_per_call, tx_hash: null, status: stepStatus, latency_ms: latencyMs, key_id: safeKeyRow.id, is_trial: false, pipeline_id: pipelineId, step_index: stepIndex })
        .select('id').single()
      callId = callRecord?.id ?? ''
    } catch { /* best-effort */ }

    // Firmar receipt
    let signature = ''
    try {
      const ts = Math.floor(Date.now() / 1000)
      signature = await signReceipt({ keyId: keyHashToBytes32(safeKeyRow.key_hash), callId, agentSlug: agent.slug, amountUsdc: agent.price_per_call, timestamp: ts })
      supabase.from('agent_calls').update({ receipt_signature: signature }).eq('id', callId).then(undefined, () => {})
    } catch { /* best-effort */ }

    if (stepStatus === 'error') return { receipt: null, output: null, status: 'error', reason: stepErrorReason }

    const output = typeof stepOutput === 'string' ? stepOutput : JSON.stringify(stepOutput)

    // Propagar campos clave entre steps (token_address, token_symbol)
    if (stepOutput && typeof stepOutput === 'object') {
      const out = stepOutput as Record<string, unknown>
      if (typeof out.token_address === 'string' && out.token_address) pipelineCtx.token_address = out.token_address
      if (typeof out.token_symbol  === 'string' && out.token_symbol)  pipelineCtx.token_symbol  = out.token_symbol
    }
    supabase.rpc('increment_agent_stats', { p_agent_id: agent.id, p_amount: agent.price_per_call }).then(undefined, () => {})

    return {
      status: 'success',
      output,
      reason: '',
      receipt: { step: stepIndex, agent_slug: agent.slug, cost_usdc: agent.price_per_call.toFixed(6), receipt_signature: signature, call_id: callId },
    }
  }

  try {
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const group = groups[groupIndex]

      if (group.length === 1) {
        // ── Step secuencial ─────────────────────────────────────────────────
        const step = group[0]
        const stepInput = globalStepIndex === 0 ? (step.input ?? '') : (step.pass_output ? (lastOutput ?? '') : (step.input ?? ''))
        const result = await executeStep(step, globalStepIndex, stepInput)

        if (result.status === 'error') {
          supabase.from('pipeline_executions').update({ status: receipts.length === 0 ? 'failed' : 'partial', steps_completed: globalStepIndex, total_cost_usdc: receipts.reduce((a, r) => a + parseFloat(r.cost_usdc), 0), failed_at_step: globalStepIndex + 1, error_detail: result.reason, completed_at: new Date().toISOString() }).eq('id', pipelineId).then(undefined, () => {})
          return NextResponse.json({ error: `Pipeline failed at step ${globalStepIndex}`, code: 'step_failed', failed_step: globalStepIndex, reason: result.reason, steps_executed: globalStepIndex, partial_receipts: receipts } satisfies PipelineFailedResponse, { status: 422 })
        }

        receipts.push(result.receipt!)
        lastOutput = result.output
        globalStepIndex++

      } else {
        // ── Grupo paralelo ──────────────────────────────────────────────────
        // AR20-1: preflight de saldo para el grupo completo antes del allSettled
        const groupCost = group.reduce((acc, s) => acc + (agentMap.get(s.agent_slug)?.price_per_call ?? 0), 0)
        const { data: freshKey } = await supabase
          .from('agent_keys')
          .select('budget_usdc, spent_usdc')
          .eq('id', safeKeyRow.id)
          .single()
        const available = freshKey ? freshKey.budget_usdc - freshKey.spent_usdc : 0
        if (available < groupCost) {
          return NextResponse.json(
            { error: `Insufficient balance for parallel group ${groupIndex}. Required: $${groupCost.toFixed(6)}, available: $${available.toFixed(6)}`, code: 'step_failed', failed_step: globalStepIndex, reason: 'insufficient_balance_for_group', steps_executed: globalStepIndex, partial_receipts: receipts } satisfies PipelineFailedResponse,
            { status: 422 },
          )
        }

        const groupResults = await Promise.allSettled(
          group.map((step, i) => {
            const stepInput = step.input ?? ''
            return executeStep(step, globalStepIndex + i, stepInput)
          })
        )

        const successResults: string[] = []
        for (let i = 0; i < groupResults.length; i++) {
          const gr = groupResults[i]
          const stepIdx = globalStepIndex + i
          if (gr.status === 'fulfilled' && gr.value.status === 'success') {
            receipts.push(gr.value.receipt!)
            successResults.push(gr.value.output ?? '')
          } else {
            const reason = gr.status === 'rejected' ? String(gr.reason) : gr.value.reason
            receipts.push({ step: stepIdx, agent_slug: group[i].agent_slug, cost_usdc: '0.000000', receipt_signature: '', call_id: '' })
            logger.warn('[compose] parallel step failed', { stepIdx, reason })
          }
        }

        globalStepIndex += group.length

        // Si todos fallaron → abort
        if (successResults.length === 0) {
          supabase.from('pipeline_executions').update({ status: 'failed', steps_completed: globalStepIndex - group.length, total_cost_usdc: receipts.reduce((a, r) => a + parseFloat(r.cost_usdc), 0), completed_at: new Date().toISOString() }).eq('id', pipelineId).then(undefined, () => {})
          return NextResponse.json({ error: `Pipeline failed — all parallel steps in group ${groupIndex} failed`, code: 'step_failed', failed_step: globalStepIndex - group.length, reason: 'all_parallel_failed', steps_executed: globalStepIndex - group.length, partial_receipts: receipts } satisfies PipelineFailedResponse, { status: 422 })
        }

        // pass_output del último step del grupo
        const lastStep = group[group.length - 1]
        if (lastStep.pass_output) {
          lastOutput = JSON.stringify(successResults)
        } else {
          lastOutput = successResults[successResults.length - 1] ?? null
        }
      }
    }
  } catch (unexpectedErr) {
    supabase.from('pipeline_executions').update({ status: 'failed', completed_at: new Date().toISOString() }).eq('id', pipelineId).then(undefined, () => {})
    throw unexpectedErr
  }

  // ── Compat: mantener variable steps_executed = globalStepIndex ────────────
  const stepsExecuted = globalStepIndex

  // ── [7] RESPONSE FINAL ────────────────────────────────────────────────────
  const totalCost = receipts.reduce((acc, r) => acc + parseFloat(r.cost_usdc), 0)

  supabase
    .from('pipeline_executions')
    .update({ status: 'success', steps_completed: stepsExecuted, total_cost_usdc: totalCost, completed_at: new Date().toISOString() })
    .eq('id', pipelineId)
    .then(undefined, () => {/* best-effort */})

  return NextResponse.json(
    {
      pipeline_id:     pipelineId,
      steps_executed:  stepsExecuted,
      groups_executed: groups.length,
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
    // Step sin pass_output debe tener input no vacío
    if (!s.pass_output && (s.input === undefined || s.input.trim() === '')) {
      return `Step ${i}: input is required when pass_output is false`
    }
  }
  return null
}

/** Parsea output de forma segura (intenta JSON.parse, si falla devuelve string) */
export function parseOutputSafe(raw: string | null): unknown {
  if (raw === null) return null
  try { return JSON.parse(raw) } catch { return raw }
}
