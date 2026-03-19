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
import { validateEndpointUrlAsync }       from '@/lib/security/validateEndpointUrl'
import { getComposeLimit, checkCreatorRateLimits } from '@/lib/ratelimit'
import { signReceipt }               from '@/lib/receipts/signReceipt'
import { keyHashToBytes32 }          from '@/lib/contracts/marketplaceClient'
import { logger }                    from '@/lib/logger'
import { isAgentInScope }            from '@/lib/scope-check'
import { discoverAgent }             from '@/lib/agent-discovery'
import { validateInput }             from '@/lib/schema-validator'
import { assertPaymentType }         from '@/lib/validation/payment-type'

// ── Constantes (env-driven, no hardcodes) ────────────────────────────────────
const MAX_STEPS       = 5
const STEP_TIMEOUT_MS = parseInt(process.env.COMPOSE_STEP_TIMEOUT_MS?.trim() ?? '8000', 10)

// ── Wave 2: Clasificador de errores ──────────────────────────────────────────
/**
 * Determina si un step debe cobrarse basado en el tipo de error.
 * Regla: cobrar solo si el agente procesó la request (respondió con body).
 * AC-4..AC-10
 */
type ChargeDecision = 'charge' | 'refund'

function getChargeDecision(
  err: unknown,
  httpStatus: number | null,
  hasJsonBody: boolean,
): ChargeDecision {
  // Timeout o AbortError → no cobrar (AC-4)
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return 'refund'
  }
  // Sin respuesta HTTP (connection error) → no cobrar (AC-5)
  if (httpStatus === null) return 'refund'
  // 402, 429, 503, 504 → no cobrar (AC-6, AC-10)
  if ([402, 429, 503, 504].includes(httpStatus)) return 'refund'
  // 500 sin body JSON → no cobrar (AC-7)
  if (httpStatus === 500 && !hasJsonBody) return 'refund'
  // 500 con body JSON → cobrar (AC-8)
  if (httpStatus === 500 && hasJsonBody) return 'charge'
  // 200 → cobrar (AC-9)
  if (httpStatus === 200) return 'charge'
  // Default: refund para cualquier otro status no exitoso
  return httpStatus >= 200 && httpStatus < 300 ? 'charge' : 'refund'
}

// ── Tipos ────────────────────────────────────────────────────────────────────
interface ComposeStep {
  agent_slug?:   string          // Ahora opcional (mutuamente excluyente con capability)
  capability?:   string          // nombre de la capability buscada
  constraints?:  {
    max_price_usdc?: number
    min_reputation?: number
    category?:       string
  }
  fallback_slug?: string
  input?:         string
  pass_output?:   boolean
  parallel?:      boolean  // HU-5.2: si true, agrupa con steps consecutivos parallel
}

interface ComposeRequest {
  steps:           ComposeStep[]
  start_from_step?: number
  pipeline_id?:    string
  initial_input?:  string
}

interface StepReceipt {
  step:              number
  agent_slug:        string
  resolved_slug?:    string      // presente cuando se usó discovery dinámico
  cost_usdc:         string
  receipt_signature: string
  call_id:           string
}

interface ComposeResponse {
  pipeline_id:        string
  steps_executed:     number
  groups_executed:    number  // HU-5.2: número de grupos (1 group = N parallel steps)
  total_cost_usdc:    string
  result:             unknown
  receipts:           StepReceipt[]
  refund_failures?:   string[]  // AC-11: presente solo si hay fallos de refund
  resumed_from_step?: number    // WAS-204: presente solo en retry mode
}

interface PipelineFailedResponse {
  error:            string
  code:             'step_failed' | 'all_failed'
  failed_step:      number
  reason:           string
  steps_executed:   number
  partial_receipts: StepReceipt[]
  refund_failures?: string[]
  status?:          'all_failed'  // AC-12
}

interface AgentRow {
  id:             string
  slug:           string
  name:           string
  price_per_call: number
  endpoint_url:   string
  status:         string
  category:       string
  max_rpm:        number
  max_rpd:        number
  input_schema:   unknown | null
  output_schema:  unknown | null
  webhook_secret: string | null
}

interface KeyRow {
  id:                 string
  key_hash:           string
  is_active:          boolean
  budget_usdc:        number
  spent_usdc:         number
  allowed_slugs:      string[] | null
  allowed_categories: string[] | null
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
    .select('id, key_hash, is_active, budget_usdc, spent_usdc, allowed_slugs, allowed_categories')
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

  // WAS-204: en retry mode, steps[] es opcional — se recuperan del pipeline original
  const isRetryMode = !!(body.pipeline_id && body.start_from_step !== undefined)

  if (!isRetryMode) {
    const validationError = validateSteps(body?.steps)
    if (validationError) {
      // AC-3 WAS-187: capability+agent_slug juntos → ambiguous_step
      const code = validationError.includes('mutually exclusive') ? 'ambiguous_step' : 'validation_error'
      return NextResponse.json(
        { error: validationError, code },
        { status: 400 },
      )
    }
  }

  const steps = body.steps ?? []

  // ── [3] RESOLVER AGENTES ─────────────────────────────────────────────────
  const agentMap = new Map<string, AgentRow>()

  // Separar slugs estáticos de steps con capability
  const staticSlugs = [...new Set(
    steps.filter((s: ComposeStep) => s.agent_slug).map((s: ComposeStep) => s.agent_slug!)
  )]

  // Cargar agentes estáticos en batch
  if (staticSlugs.length > 0) {
    const { data: agentsData } = await supabase
      .from('agents')
      .select('id, slug, name, price_per_call, endpoint_url, status, category, max_rpm, max_rpd, input_schema, output_schema, webhook_secret')
      .in('slug', staticSlugs)
      .eq('status', 'active')

    for (const a of agentsData ?? []) {
      agentMap.set(a.slug, a as AgentRow)
    }
  }

  // Resolver steps con capability (discovery dinámico) + scope check estático
  const resolvedSlugs = new Map<number, string>() // stepIndex → resolved slug

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]

    if (step.agent_slug) {
      // Scope check estático (WAS-186)
      const agent = agentMap.get(step.agent_slug)
      if (!agent) {
        return NextResponse.json(
          { error: `Agent not found: ${step.agent_slug}`, code: 'agent_not_found' },
          { status: 404 }
        )
      }
      if (!isAgentInScope(agent.slug, agent.category, keyRow.allowed_slugs, keyRow.allowed_categories)) {
        return NextResponse.json(
          { error: 'Agent not in scope', code: 'agent_not_in_scope', slug: agent.slug },
          { status: 403 }
        )
      }
    } else if (step.capability) {
      // Dynamic discovery
      const discovered = await discoverAgent(
        supabase,
        step.capability,
        step.constraints ?? {},
        keyRow.allowed_slugs,
        keyRow.allowed_categories,
      )

      if (!discovered) {
        // Intentar fallback_slug (WAS-187 AC-6: cargar de DB si no está en mapa)
        let fallbackOutOfScope = false // declarar DENTRO del bloque del step, no fuera del loop
        if (step.fallback_slug) {
          let fbAgent = agentMap.get(step.fallback_slug)
          if (!fbAgent) {
            const { data: fbData } = await supabase
              .from('agents')
              .select('id, slug, name, price_per_call, endpoint_url, status, category, max_rpm, max_rpd, input_schema, output_schema, webhook_secret')
              .eq('slug', step.fallback_slug)
              .eq('status', 'active')
              .single<AgentRow>()
            if (fbData) {
              agentMap.set(fbData.slug, fbData)
              fbAgent = fbData
            }
          }
          if (fbAgent) {
            if (isAgentInScope(fbAgent.slug, fbAgent.category, keyRow.allowed_slugs, keyRow.allowed_categories)) {
              steps[i] = { ...step, agent_slug: step.fallback_slug }
              resolvedSlugs.set(i, step.fallback_slug)
              continue
            } else {
              fallbackOutOfScope = true
            }
          }
        }
        // AC-4: sin match → 422
        return NextResponse.json(
          { error: `No agent found for capability: ${step.capability}`, code: fallbackOutOfScope ? 'agent_not_in_scope' : 'no_agent_match', step: i },
          { status: 422 }
        )
      }

      agentMap.set(discovered.slug, discovered as AgentRow)
      steps[i] = { ...step, agent_slug: discovered.slug }
      resolvedSlugs.set(i, discovered.slug)
    }
  }

  // ── RETRY MODE (WAS-204) ─────────────────────────────────────────────────
  let resumedFromStep: number | undefined
  let retryLastOutput: string | null = null

  if (body.pipeline_id && body.start_from_step !== undefined) {
    const startFrom = body.start_from_step

    const { data: existingPipeline, error: pipelineErr } = await supabase
      .rpc('get_pipeline_for_retry', {
        p_pipeline_id: body.pipeline_id,
        p_key_hash:    keyHash,
      })

    const pipeline = Array.isArray(existingPipeline) ? existingPipeline[0] : existingPipeline

    if (pipelineErr || !pipeline) {
      return NextResponse.json(
        { error: 'Pipeline not found or not resumable', code: 'pipeline_not_resumable' },
        { status: 404 }
      )
    }

    if (pipeline.status === 'success') {
      return NextResponse.json(
        { error: 'Pipeline already completed', code: 'pipeline_not_resumable' },
        { status: 409 }
      )
    }

    if (!pipeline.owned_by_key) {
      return NextResponse.json(
        { error: 'Pipeline access denied', code: 'pipeline_access_denied' },
        { status: 403 }
      )
    }

    // Cargar output previo para encadenamiento
    if (body.initial_input !== undefined) {
      retryLastOutput = body.initial_input
    } else {
      const prevOutputs: Array<{step: number; output: string}> = pipeline.step_outputs ?? []
      const lastStored = prevOutputs
        .filter(o => o.step < startFrom)
        .sort((a, b) => b.step - a.step)[0]
      retryLastOutput = lastStored?.output ?? null
    }

    resumedFromStep = startFrom
  }

  // ── [4] PREFLIGHT DE SALDO ────────────────────────────────────────────────
  // WAS-204: en retry, solo contar steps desde start_from_step en adelante
  const pendingSteps = resumedFromStep !== undefined
    ? steps.slice(resumedFromStep)
    : steps
  const totalRequired = pendingSteps.reduce(
    (acc, s) => acc + (agentMap.get(s.agent_slug ?? '')?.price_per_call ?? 0),
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
    const agent = agentMap.get(steps[i].agent_slug ?? '')!
    try {
      await validateEndpointUrlAsync(agent.endpoint_url)
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
  let lastOutput: string | null = resumedFromStep !== undefined ? retryLastOutput : null
  // WAS-231: Contexto propagado entre steps — tipo expandido para soportar primitivos numéricos/booleanos.
  // Los campos acumulados se envían al body de cada agente endpoint junto con el input explícito.
  // Nota de diseño: todos los agentes son de WasiAI hoy; si se admiten agentes de terceros en el
  // futuro, revisar qué campos del ctx se exponen por razones de privacidad.
  const pipelineCtx: Record<string, string | number | boolean> = {}
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
  // Wave 3a: retorno extendido con chargeDecision + refundFailure
  interface StepResult {
    receipt:        StepReceipt | null
    output:         string | null
    status:         'success' | 'error'
    reason:         string
    chargeDecision: ChargeDecision
    refundFailure:  string | null
  }

  async function executeStep(step: ComposeStep, stepIndex: number, stepInput: string): Promise<StepResult> {
    const agent = agentMap.get(step.agent_slug ?? '')!

    // Rate limit check pre-step (fail-open via checkCreatorRateLimits)
    const consumerRlId = `${step.agent_slug ?? ''}:${rawKey.substring(0, 24)}`
    const rlRes = await checkCreatorRateLimits(step.agent_slug ?? '', agent.max_rpm ?? 60, agent.max_rpd ?? 1000, consumerRlId)
    if (rlRes) return { receipt: null, output: null, status: 'error', reason: `rate_limited:${step.agent_slug ?? ''}`, chargeDecision: 'refund', refundFailure: null }

    // Deducir saldo
    const { data: deductOk, error: deductError } = await supabase.rpc(
      'deduct_key_balance',
      { p_key_id: safeKeyRow.id, p_amount: agent.price_per_call },
    )
    if (deductError || deductOk === false) {
      return { receipt: null, output: null, status: 'error', reason: 'insufficient_balance', chargeDecision: 'refund', refundFailure: null }
    }

    // Llamar al agente externo
    const startMs = Date.now()

    // Wave 3b: hoist de variables para que getChargeDecision pueda acceder a ambos casos
    let res: Response | undefined
    let caughtErr: unknown = null
    let hasJsonBody = false
    let stepOutput: unknown
    let stepStatus: 'success' | 'error' = 'success'
    let stepErrorReason = ''

    try {
      res = await fetch(agent.endpoint_url, {
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Cache-Control':  'no-store',
          'X-Pipeline-Id':  pipelineId,
          'X-Pipeline-Step': String(stepIndex),
          ...(agent.webhook_secret ? {
            'Authorization': `Bearer ${agent.webhook_secret}`,
            'X-WasiAI-Agent-Id': agent.id,
          } : (logger.warn('[compose] agent missing webhook_secret', { slug: agent.slug }), {})),
        },
        body:     JSON.stringify({ input: stepInput, ...pipelineCtx }),
        signal:   AbortSignal.timeout(STEP_TIMEOUT_MS),
        redirect: 'error',
      })
      if (res.ok) {
        const ct = res.headers.get('content-type') ?? ''
        hasJsonBody = ct.includes('application/json')
        stepOutput  = hasJsonBody ? await res.json() : await res.text()
      } else {
        const ct = res.headers.get('content-type') ?? ''
        hasJsonBody = ct.includes('application/json')
        if (hasJsonBody) { try { stepOutput = await res.json() } catch { stepOutput = null; hasJsonBody = false } }
        stepStatus      = 'error'
        stepErrorReason = res.status === 402
          ? 'payment_rejected'
          : `El agente "${agent.slug}" respondió con error ${res.status}.`
      }
    } catch (err) {
      caughtErr       = err
      stepStatus      = 'error'
      stepErrorReason = err instanceof Error && err.name === 'TimeoutError' ? 'step_timeout' : `Upstream unreachable: ${String(err)}`
    }

    // Wave 3b: ahora res, caughtErr y hasJsonBody están en scope
    const chargeDecision = getChargeDecision(caughtErr, res?.status ?? null, hasJsonBody)

    const latencyMs = Date.now() - startMs

    // Wave 3c: refund sync si el step falló y no debe cobrarse
    let refundFailure: string | null = null
    if (stepStatus === 'error' && chargeDecision === 'refund') {
      const { data: refundOk, error: refundErr } = await supabase.rpc(
        'refund_key_balance',
        { p_key_id: safeKeyRow.id, p_amount: agent.price_per_call },
      )
      if (refundErr || !refundOk) {
        logger.error('[compose] refund failed', { stepIndex, keyId: safeKeyRow.id, amount: agent.price_per_call, error: refundErr })
        refundFailure = `step_${stepIndex}`
      }
    }

    // WAS-202: validar output_schema ANTES de insertar agent_calls (solo si step exitoso)
    if (stepStatus === 'success' && agent.output_schema) {
      const outputErr = validateInput(agent.output_schema, stepOutput)
      if (outputErr) {
        // Refund
        const { data: refundOk, error: refundErr } = await supabase.rpc(
          'refund_key_balance',
          { p_key_id: safeKeyRow.id, p_amount: agent.price_per_call },
        )
        const schemaRefundFailure = (!refundOk || refundErr) ? `step_${stepIndex}` : null
        // Insert agent_calls con result_type schema_violation
        try {
          assertPaymentType('api_key')
          await supabase
            .from('agent_calls')
            .insert({ agent_id: agent.id, caller_type: 'agent', amount_paid: 0, tx_hash: null, status: 'error', result_type: 'schema_violation', latency_ms: latencyMs, key_id: safeKeyRow.id, is_trial: false, pipeline_id: pipelineId, step_index: stepIndex, called_at: new Date().toISOString(), payment_type: 'api_key', agent_slug: agent.slug })
        } catch { /* best-effort */ }
        return { receipt: null, output: null, status: 'error', reason: `output_schema_violation: ${outputErr}`, chargeDecision: 'refund', refundFailure: schemaRefundFailure }
      }
    }

    // Determinar result_type para el insert de agent_calls
    const agentCallResultType = stepStatus === 'success' ? 'success' : 'agent_error'

    // Log en agent_calls
    let callId = ''
    try {
      assertPaymentType('api_key')
      const { data: callRecord } = await supabase
        .from('agent_calls')
        .insert({ agent_id: agent.id, caller_type: 'agent', amount_paid: agent.price_per_call, tx_hash: null, status: stepStatus, result_type: agentCallResultType, latency_ms: latencyMs, key_id: safeKeyRow.id, is_trial: false, pipeline_id: pipelineId, step_index: stepIndex, called_at: new Date().toISOString(), payment_type: 'api_key', agent_slug: agent.slug })
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

    if (stepStatus === 'error') return { receipt: null, output: null, status: 'error', reason: stepErrorReason, chargeDecision, refundFailure }

    const output = typeof stepOutput === 'string' ? stepOutput : JSON.stringify(stepOutput)

    // WAS-231: Propagar campos clave entre steps. Los outputs tienen estructura { result: {...}, meta: {...} }
    // — acceder a out.result primero, con fallback a out para retrocompatibilidad.
    // Bug fix: código anterior accedía out.* (raíz) pero los campos viven en out.result.*.
    if (stepOutput && typeof stepOutput === 'object') {
      const top = stepOutput as Record<string, unknown>
      const src = (top.result && typeof top.result === 'object')
        ? top.result as Record<string, unknown>
        : top

      // String fields
      const strFields = ['token_address', 'token_symbol', 'token_name'] as const
      for (const f of strFields) {
        if (typeof src[f] === 'string' && src[f]) pipelineCtx[f] = src[f] as string
      }

      // Number fields
      const numFields = ['price_usd', 'volatility_7d_pct', 'sentiment_score',
                         'holder_count', 'contract_age_days', 'top10_concentration_pct',
                         'bytecode_size', 'risk_score'] as const
      for (const f of numFields) {
        if (typeof src[f] === 'number') pipelineCtx[f] = src[f] as number
      }

      // Boolean fields
      const boolFields = ['is_verified'] as const
      for (const f of boolFields) {
        if (typeof src[f] === 'boolean') pipelineCtx[f] = src[f] as boolean
      }
    }
    supabase.rpc('increment_agent_stats', { p_agent_id: agent.id, p_amount: agent.price_per_call }).then(undefined, () => {})

    return {
      status: 'success',
      output,
      reason: '',
      chargeDecision: 'charge' as ChargeDecision,
      refundFailure: null,
      receipt: { step: stepIndex, agent_slug: agent.slug, cost_usdc: agent.price_per_call.toFixed(6), receipt_signature: signature, call_id: callId },
    }
  }

  // Wave 3d: acumular refund_failures del pipeline
  const refundFailures: string[] = []

  try {
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const group = groups[groupIndex]

      if (group.length === 1) {
        // ── Step secuencial ─────────────────────────────────────────────────
        const step = group[0]

        // WAS-204: skip steps before resumedFromStep (no execute, no charge)
        if (resumedFromStep !== undefined && globalStepIndex < resumedFromStep) {
          globalStepIndex++
          continue
        }

        const stepInput = globalStepIndex === 0 ? (step.input ?? '') : (step.pass_output ? (lastOutput ?? '') : (step.input ?? ''))

        // AC-6: Validar input contra schema ANTES de cobrar (WAS-200)
        const agentForStep = agentMap.get(step.agent_slug ?? '')!
        if (agentForStep.input_schema) {
          const inputToValidate = typeof stepInput === 'string'
            ? (() => { try { return JSON.parse(stepInput) } catch { return stepInput } })()
            : stepInput
          const validErr = validateInput(agentForStep.input_schema, inputToValidate)
          if (validErr) {
            return NextResponse.json(
              { error: validErr, code: 'input_validation_failed', step: globalStepIndex },
              { status: 422 }
            )
          }
        }

        const result = await executeStep(step, globalStepIndex, stepInput)

        if (result.refundFailure) refundFailures.push(result.refundFailure)

        if (result.status === 'error') {
          supabase.from('pipeline_executions').update({ status: receipts.length === 0 ? 'failed' : 'partial', steps_completed: globalStepIndex, total_cost_usdc: receipts.reduce((a, r) => a + parseFloat(r.cost_usdc), 0), failed_at_step: globalStepIndex + 1, error_detail: result.reason, completed_at: new Date().toISOString() }).eq('id', pipelineId).then(undefined, () => {})

          // AC-12: si todos los steps fallaron (ningún receipt exitoso) → HTTP 200 all_failed
          const allFailed = receipts.length === 0
          if (allFailed) {
            return NextResponse.json({
              error:            'All pipeline steps failed',
              code:             'all_failed' as const,
              status:           'all_failed' as const,
              failed_step:      globalStepIndex,
              reason:           result.reason,
              steps_executed:   0,
              partial_receipts: receipts,
              ...(refundFailures.length > 0 && { refund_failures: refundFailures }),
            } satisfies PipelineFailedResponse, { status: 200 })
          }
          return NextResponse.json({
            error:            `Pipeline failed at step ${globalStepIndex}`,
            code:             'step_failed' as const,
            failed_step:      globalStepIndex,
            reason:           result.reason,
            steps_executed:   globalStepIndex,
            partial_receipts: receipts,
            ...(refundFailures.length > 0 && { refund_failures: refundFailures }),
          } satisfies PipelineFailedResponse, { status: 422 })
        }

        const pushedReceipt = result.receipt!
        if (resolvedSlugs.has(globalStepIndex)) {
          pushedReceipt.resolved_slug = resolvedSlugs.get(globalStepIndex)
        }
        receipts.push(pushedReceipt)
        lastOutput = result.output
        // Best-effort: no await, no bloquea el pipeline
        supabase.rpc('append_step_output', {
          p_pipeline_id: pipelineId,
          p_step:        globalStepIndex,
          p_output:      typeof result.output === 'string' ? result.output : JSON.stringify(result.output),
          p_agent_slug:  step.agent_slug ?? '',
        }).then(undefined, () => undefined)
        globalStepIndex++

      } else {
        // ── Grupo paralelo ──────────────────────────────────────────────────
        // AR20-1: preflight de saldo para el grupo completo antes del allSettled
        const groupCost = group.reduce((acc, s) => acc + (agentMap.get(s.agent_slug ?? '')?.price_per_call ?? 0), 0)
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

        const groupStartIndex = globalStepIndex
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
            // Best-effort: persist output for parallel step (mirrors serial block)
            supabase.rpc('append_step_output', {
              p_pipeline_id: pipelineId,
              p_step:        groupStartIndex + i,
              p_output:      typeof gr.value.output === 'string' ? gr.value.output : JSON.stringify(gr.value.output),
              p_agent_slug:  group[i].agent_slug ?? '',
            }).then(undefined, () => undefined)
          } else {
            const reason = gr.status === 'rejected' ? String(gr.reason) : gr.value.reason
            if (gr.status === 'fulfilled' && gr.value.refundFailure) refundFailures.push(gr.value.refundFailure)
            receipts.push({ step: stepIdx, agent_slug: group[i].agent_slug ?? '', cost_usdc: '0.000000', receipt_signature: '', call_id: '' })
            logger.warn('[compose] parallel step failed', { stepIdx, reason })
          }
        }

        globalStepIndex += group.length

        // Si todos fallaron → abort
        if (successResults.length === 0) {
          supabase.from('pipeline_executions').update({ status: 'failed', steps_completed: globalStepIndex - group.length, total_cost_usdc: receipts.reduce((a, r) => a + parseFloat(r.cost_usdc), 0), completed_at: new Date().toISOString() }).eq('id', pipelineId).then(undefined, () => {})
          return NextResponse.json({
            error:            `Pipeline failed — all parallel steps in group ${groupIndex} failed`,
            code:             'step_failed' as const,
            failed_step:      globalStepIndex - group.length,
            reason:           'all_parallel_failed',
            steps_executed:   globalStepIndex - group.length,
            partial_receipts: receipts,
            ...(refundFailures.length > 0 && { refund_failures: refundFailures }),
          } satisfies PipelineFailedResponse, { status: 422 })
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
      ...(refundFailures.length > 0 && { refund_failures: refundFailures }),
      ...(resumedFromStep !== undefined && { resumed_from_step: resumedFromStep }),
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

    // AC-3: capability + agent_slug juntos → error
    if (s.capability && s.agent_slug) {
      return `Step ${i}: capability and agent_slug are mutually exclusive`
    }

    // Debe tener uno u otro
    if (!s.capability && (!s.agent_slug || typeof s.agent_slug !== 'string')) {
      return `Step ${i}: agent_slug or capability is required`
    }

    if (s.input !== undefined && s.pass_output === true) {
      return `Step ${i}: input and pass_output are mutually exclusive`
    }
    if (i === 0 && s.pass_output === true) {
      return 'Step 0 cannot use pass_output (no previous output exists)'
    }
    if (!s.pass_output && (s.input === undefined || (typeof s.input === 'string' && s.input.trim() === ''))) {
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
