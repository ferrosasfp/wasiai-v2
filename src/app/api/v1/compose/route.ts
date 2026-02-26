// src/app/api/v1/compose/route.ts
// HU-5.1 — Agent-to-Agent Routing (POST /api/v1/compose)
// Next.js 14 App Router | createServiceClient | viem v2 | no ethers | no hardcodes
//
// ADAPTACIONES vs story file:
//   - agent_keys (no api_keys) — schema real del proyecto
//   - is_active + budget_usdc/spent_usdc (no status/balance)
//   - validateEndpointUrl() de @/lib/security/validateEndpointUrl (throws, no boolean)
//   - Firma ECDSA directa con privateKeyToAccount (no getOperatorClient)
//   - createHash('sha256') de 'crypto' (mismo patrón que invoke/route.ts)

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { validateEndpointUrl } from '@/lib/security/validateEndpointUrl'
import { privateKeyToAccount } from 'viem/accounts'
import { keccak256, encodePacked, toBytes } from 'viem'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { randomUUID } from 'crypto'

// ─── Config desde env vars (no hardcodes) ────────────────────────────────────
const STEP_TIMEOUT_MS = parseInt(
  process.env.COMPOSE_STEP_TIMEOUT_MS?.trim() ?? '8000',
  10,
)
const MAX_STEP_OUTPUT_BYTES = parseInt(
  process.env.COMPOSE_MAX_STEP_OUTPUT_BYTES?.trim() ?? '102400',
  10,
)

// ─── Rate limit: wasiai:compose, 10 req/min por key ──────────────────────────
let _composeRatelimit: Ratelimit | null = null
function getComposeRatelimit(): Ratelimit {
  return (_composeRatelimit ??= new Ratelimit({
    redis: new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    }),
    limiter: Ratelimit.slidingWindow(10, '60 s'),
    prefix: 'wasiai:compose',
    analytics: false,
  }))
}

// ─── Tipos internos ───────────────────────────────────────────────────────────
interface PipelineStep {
  agent_id: string
  input: string | Record<string, unknown>
}

interface StepResult {
  step: number
  agent_id: string
  input: string
  output: string
  latency_ms: number
  cost_usdc: string
}

interface AgentRow {
  id: string
  status: string
  price_per_call: number
  endpoint_url: string
}

// ─── Handler principal ────────────────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = createServiceClient()

  // ── [1] Parse & Validate body ─────────────────────────────────────────────
  let body: { steps?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const rawSteps = body?.steps
  if (!Array.isArray(rawSteps) || rawSteps.length < 2 || rawSteps.length > 10) {
    return NextResponse.json(
      { error: 'steps must be an array of 2–10 elements' },
      { status: 400 },
    )
  }

  const steps: PipelineStep[] = []
  for (let i = 0; i < rawSteps.length; i++) {
    const s = rawSteps[i]
    if (!s || typeof s !== 'object') {
      return NextResponse.json(
        { error: `Step ${i + 1} is invalid` },
        { status: 400 },
      )
    }
    const { agent_id, input } = s as Record<string, unknown>
    if (typeof agent_id !== 'string' || !isValidUUID(agent_id)) {
      return NextResponse.json(
        { error: `Step ${i + 1}: agent_id must be a valid UUID` },
        { status: 400 },
      )
    }
    if (input === undefined || input === null) {
      return NextResponse.json(
        { error: `Step ${i + 1}: input is required` },
        { status: 400 },
      )
    }
    if (i === 0 && input === '$prev') {
      return NextResponse.json(
        { error: 'Step 1 cannot use "$prev" (no previous output)' },
        { status: 400 },
      )
    }
    steps.push({ agent_id, input: input as string | Record<string, unknown> })
  }

  // ── [2] Auth: validar API key ─────────────────────────────────────────────
  const apiKey = req.headers.get('x-api-key')?.trim()
  if (!apiKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const keyHash = createHash('sha256').update(apiKey).digest('hex')

  const { data: keyRow, error: keyError } = await supabase
    .from('agent_keys')
    .select('id, is_active, budget_usdc, spent_usdc, owner_id')
    .eq('key_hash', keyHash)
    .single()

  if (keyError || !keyRow) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!keyRow.is_active) {
    return NextResponse.json({ error: 'API key is inactive' }, { status: 403 })
  }

  const keyId: string = keyRow.id

  // ── [3] Rate limit (por keyId) ────────────────────────────────────────────
  const { success: rlSuccess } = await getComposeRatelimit().limit(keyId)
  if (!rlSuccess) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again in 60 seconds.' },
      { status: 429 },
    )
  }

  // ── [4] Pre-flight: validar agentes ──────────────────────────────────────
  const agentIds = steps.map((s) => s.agent_id)
  const { data: agentRows, error: agentError } = await supabase
    .from('agents')
    .select('id, status, price_per_call, endpoint_url')
    .in('id', agentIds)

  if (agentError) {
    return NextResponse.json(
      { error: 'Internal error validating agents' },
      { status: 500 },
    )
  }

  const foundAgents = new Map<string, AgentRow>(
    (agentRows ?? []).map((a: AgentRow) => [a.id, a]),
  )

  const invalidAgents: string[] = []
  for (const id of agentIds) {
    const agent = foundAgents.get(id)
    if (!agent || agent.status !== 'active') {
      invalidAgents.push(id)
    }
  }
  if (invalidAgents.length > 0) {
    return NextResponse.json(
      { error: 'Invalid agents', invalid_agents: invalidAgents },
      { status: 422 },
    )
  }

  // ── [5] Pre-flight: verificar saldo ──────────────────────────────────────
  const estimatedCost = steps.reduce((sum, s) => {
    const agent = foundAgents.get(s.agent_id)!
    return sum + (agent.price_per_call ?? 0)
  }, 0)

  const currentBalance: number =
    (keyRow.budget_usdc ?? 0) - (keyRow.spent_usdc ?? 0)

  if (currentBalance < estimatedCost) {
    return NextResponse.json(
      {
        error: 'Insufficient balance',
        required: estimatedCost.toFixed(6),
        available: currentBalance.toFixed(6),
        currency: 'USDC',
      },
      { status: 402 },
    )
  }

  // ── [6] Crear pipeline_execution provisional ─────────────────────────────
  const pipelineId = randomUUID()
  const startTs = Date.now()

  await supabase.from('pipeline_executions').insert({
    id: pipelineId,
    key_id: keyId,
    steps_requested: steps.length,
    steps_completed: 0,
    total_cost_usdc: 0,
    status: 'failed', // provisional — se actualiza al terminar
  })

  structuredLog('pipeline_start', {
    pipeline_id: pipelineId,
    key_id: keyId,
    steps_count: steps.length,
  })

  // ── [7] Loop de ejecución secuencial ─────────────────────────────────────
  const stepResults: StepResult[] = []
  let prevOutput = ''
  let totalCost = 0

  for (let i = 0; i < steps.length; i++) {
    const stepNum = i + 1
    const stepDef = steps[i]

    // [7a] Resolver input ($prev)
    const resolvedInput = resolvePrev(stepDef.input, prevOutput)
    const resolvedInputStr =
      typeof resolvedInput === 'string'
        ? resolvedInput
        : JSON.stringify(resolvedInput)

    // [7b] Re-leer precio actual del agente (no cachear del pre-flight)
    const { data: freshAgent, error: freshAgentError } = await supabase
      .from('agents')
      .select('price_per_call, endpoint_url, status')
      .eq('id', stepDef.agent_id)
      .single()

    if (freshAgentError || !freshAgent || freshAgent.status !== 'active') {
      await abortPipeline(
        supabase, pipelineId, stepNum, stepResults, totalCost,
        `Agent ${stepDef.agent_id} is no longer active`,
      )
      return buildPartialResponse(
        pipelineId, stepNum, stepResults, totalCost,
        `Agent ${stepDef.agent_id} is no longer active`, 502, steps.length,
      )
    }

    const pricePerCall: number = freshAgent.price_per_call ?? 0
    const endpointUrl: string = freshAgent.endpoint_url

    // [7c] SSRF protection
    try {
      validateEndpointUrl(endpointUrl)
    } catch (ssrfErr) {
      await abortPipeline(
        supabase, pipelineId, stepNum, stepResults, totalCost,
        `Agent ${stepDef.agent_id} endpoint URL failed SSRF validation: ${String(ssrfErr)}`,
      )
      return buildPartialResponse(
        pipelineId, stepNum, stepResults, totalCost,
        `Agent ${stepDef.agent_id} endpoint URL is invalid`, 502, steps.length,
      )
    }

    // [7d] Fetch al agente externo con timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), STEP_TIMEOUT_MS)
    const stepStart = Date.now()

    let agentResponseBody: unknown
    try {
      const agentRes = await fetch(endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Pipeline-Id': pipelineId,
          'X-Pipeline-Step': String(stepNum),
        },
        body: JSON.stringify({ input: resolvedInput }),
        signal: controller.signal,
        redirect: 'error',
      })
      clearTimeout(timeoutId)

      if (!agentRes.ok) {
        const latencyMs = Date.now() - stepStart
        structuredLog('pipeline_step', {
          pipeline_id: pipelineId,
          step: stepNum,
          agent_id: stepDef.agent_id,
          latency_ms: latencyMs,
          status: 'error',
          http_status: agentRes.status,
        })
        await abortPipeline(
          supabase, pipelineId, stepNum, stepResults, totalCost,
          `Agent ${stepDef.agent_id} returned ${agentRes.status}`,
        )
        return buildPartialResponse(
          pipelineId, stepNum, stepResults, totalCost,
          `Agent ${stepDef.agent_id} returned ${agentRes.status}`, 502, steps.length,
        )
      }

      // NO propagar headers del agente externo al caller
      const rawAgentText = await agentRes.text()
      try { agentResponseBody = JSON.parse(rawAgentText) } catch { agentResponseBody = rawAgentText }
    } catch (err: unknown) {
      clearTimeout(timeoutId)
      const latencyMs = Date.now() - stepStart
      const isTimeout = err instanceof Error && err.name === 'AbortError'
      const errMsg = isTimeout
        ? `Step ${stepNum} timed out after ${STEP_TIMEOUT_MS}ms`
        : `Step ${stepNum} fetch error: ${String(err)}`

      structuredLog('pipeline_step', {
        pipeline_id: pipelineId,
        step: stepNum,
        agent_id: stepDef.agent_id,
        latency_ms: latencyMs,
        status: isTimeout ? 'timeout' : 'error',
      })
      await abortPipeline(supabase, pipelineId, stepNum, stepResults, totalCost, errMsg)
      return buildPartialResponse(
        pipelineId, stepNum, stepResults, totalCost,
        errMsg, isTimeout ? 504 : 502, steps.length,
      )
    }

    const latencyMs = Date.now() - stepStart

    // [7e] Extraer output
    const rawOutput = extractOutput(agentResponseBody)

    // Verificar tamaño del output
    const outputBytes = new TextEncoder().encode(rawOutput).length
    if (outputBytes > MAX_STEP_OUTPUT_BYTES) {
      await abortPipeline(
        supabase, pipelineId, stepNum, stepResults, totalCost,
        `Step ${stepNum} output exceeds size limit`,
      )
      return NextResponse.json(
        {
          pipeline_id: pipelineId,
          error: `Step ${stepNum} output exceeds size limit (${Math.round(MAX_STEP_OUTPUT_BYTES / 1024)}KB)`,
        },
        { status: 413 },
      )
    }

    prevOutput = rawOutput

    // [7f] Descuento atómico de saldo (deduct_key_balance RPC)
    const { data: deductOk, error: deductError } = await supabase.rpc(
      'deduct_key_balance',
      { p_key_id: keyId, p_amount: pricePerCall },
    )

    if (deductError || deductOk === false) {
      await abortPipeline(
        supabase, pipelineId, stepNum, stepResults, totalCost,
        'Insufficient balance mid-pipeline',
      )
      return buildPartialResponse(
        pipelineId, stepNum, stepResults, totalCost,
        'Insufficient balance mid-pipeline', 402, steps.length,
      )
    }

    totalCost += pricePerCall

    // [7g] Registrar agent_call individual
    await supabase.from('agent_calls').insert({
      agent_id: stepDef.agent_id,
      caller_type: 'agent',
      key_id: keyId,
      pipeline_id: pipelineId,
      status: 'success',
      latency_ms: latencyMs,
      amount_paid: pricePerCall,
      is_trial: false,
    })

    const stepResult: StepResult = {
      step: stepNum,
      agent_id: stepDef.agent_id,
      input: resolvedInputStr,
      output: rawOutput,
      latency_ms: latencyMs,
      cost_usdc: pricePerCall.toFixed(6),
    }
    stepResults.push(stepResult)

    structuredLog('pipeline_step', {
      pipeline_id: pipelineId,
      step: stepNum,
      agent_id: stepDef.agent_id,
      latency_ms: latencyMs,
      status: 'success',
      cost_usdc: pricePerCall,
    })
  }

  // ── [8] Firma ECDSA del receipt ───────────────────────────────────────────
  const timestamp = Math.floor(Date.now() / 1000)
  const receiptSignature = await signPipelineReceipt(
    pipelineId,
    keyId,
    totalCost.toFixed(6),
    timestamp,
  )

  // ── [9] Actualizar pipeline_execution ────────────────────────────────────
  await supabase
    .from('pipeline_executions')
    .update({
      status: 'success',
      steps_completed: steps.length,
      total_cost_usdc: totalCost,
      receipt_signature: receiptSignature,
      completed_at: new Date().toISOString(),
    })
    .eq('id', pipelineId)

  structuredLog('pipeline_complete', {
    pipeline_id: pipelineId,
    status: 'success',
    steps_completed: steps.length,
    total_cost_usdc: totalCost,
    total_latency_ms: Date.now() - startTs,
  })

  // ── [10] Responder 200 ────────────────────────────────────────────────────
  return NextResponse.json({
    pipeline_id: pipelineId,
    steps_completed: steps.length,
    steps_total: steps.length,
    status: 'success',
    result: prevOutput,
    steps: stepResults,
    total_cost_usdc: totalCost.toFixed(6),
    receipt_signature: receiptSignature,
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Sustituye "$prev" (string exacto o valores en objeto) por prevOutput */
function resolvePrev(
  input: string | Record<string, unknown>,
  prevOutput: string,
): string | Record<string, unknown> {
  if (typeof input === 'string') {
    return input === '$prev' ? prevOutput : input
  }
  const resolved: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    resolved[k] = typeof v === 'string' && v === '$prev' ? prevOutput : v
  }
  return resolved
}

/** Extrae el output de la respuesta del agente externo */
function extractOutput(body: unknown): string {
  if (typeof body === 'string') return body
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>
    if ('response' in obj) {
      const r = obj['response']
      return typeof r === 'string' ? r : JSON.stringify(r)
    }
    return JSON.stringify(obj)
  }
  return String(body)
}

/** Firma ECDSA del receipt del pipeline usando viem v2 */
async function signPipelineReceipt(
  pipelineId: string,
  keyId: string,
  totalCostUsdc: string,
  timestamp: number,
): Promise<string> {
  const operatorKey = process.env.OPERATOR_PRIVATE_KEY?.trim()
  if (!operatorKey) throw new Error('OPERATOR_PRIVATE_KEY not set')

  const key = operatorKey.startsWith('0x') ? operatorKey : `0x${operatorKey}`
  const account = privateKeyToAccount(key as `0x${string}`)

  const messageHash = keccak256(
    encodePacked(
      ['string', 'string', 'string', 'uint256'],
      [pipelineId, keyId, totalCostUsdc, BigInt(timestamp)],
    ),
  )

  return account.signMessage({ message: { raw: toBytes(messageHash) } })
}

/** Actualiza pipeline_executions como abortado y loguea */
async function abortPipeline(
  supabase: ReturnType<typeof createServiceClient>,
  pipelineId: string,
  failedAtStep: number,
  stepResults: StepResult[],
  totalCost: number,
  errorDetail: string,
): Promise<void> {
  const status = stepResults.length === 0 ? 'failed' : 'partial'
  await supabase
    .from('pipeline_executions')
    .update({
      status,
      steps_completed: stepResults.length,
      failed_at_step: failedAtStep,
      total_cost_usdc: totalCost,
      error_detail: errorDetail,
      completed_at: new Date().toISOString(),
    })
    .eq('id', pipelineId)

  structuredLog('pipeline_abort', {
    pipeline_id: pipelineId,
    failed_at_step: failedAtStep,
    steps_completed: stepResults.length,
    reason: errorDetail,
  })
}

/** Construye el response de error parcial */
function buildPartialResponse(
  pipelineId: string,
  failedAtStep: number,
  stepResults: StepResult[],
  totalCost: number,
  error: string,
  httpStatus: number,
  stepsTotal: number,
): NextResponse {
  const resultSoFar =
    stepResults.length > 0
      ? stepResults[stepResults.length - 1].output
      : undefined

  return NextResponse.json(
    {
      pipeline_id: pipelineId,
      status: stepResults.length === 0 ? 'failed' : 'partial',
      failed_at_step: failedAtStep,
      steps_completed: stepResults.length,
      steps_total: stepsTotal,
      error,
      ...(resultSoFar !== undefined ? { result_so_far: resultSoFar } : {}),
      steps: stepResults,
      total_cost_usdc: totalCost.toFixed(6),
    },
    { status: httpStatus },
  )
}

/** Log estructurado JSON */
function structuredLog(event: string, data: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ...data, ts: new Date().toISOString() }))
}

/** UUID v4 validation */
function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str)
}
