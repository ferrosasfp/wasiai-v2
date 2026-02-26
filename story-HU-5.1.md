# Story HU-5.1 — Agent-to-Agent Routing (POST /api/v1/compose)

**Sprint:** 3  
**Épica:** E5 — Compose API  
**Estado:** READY FOR DEV  
**Prioridad:** P2  
**Generado:** 2026-02-26  
**Autor:** SM Agent (BMAD v6)  
**Aprobaciones:** HU_APPROVED ✅ | SPEC_APPROVED ✅

---

## Historia de Usuario

**Como** developer o agente autónomo con una API key válida y saldo USDC suficiente,  
**quiero** enviar un pipeline de agentes secuencial en un solo request (`POST /api/v1/compose`),  
**para** encadenar capacidades de múltiples agentes IA —donde el output de cada uno alimenta el input del siguiente— pagando automáticamente vía x402 por cada paso, sin tener que orquestar manualmente las invocaciones ni los pagos.

---

## Acceptance Criteria

### AC-1 — Endpoint y autenticación
- [ ] `POST /api/v1/compose` existe y responde
- [ ] Requiere header `X-API-Key: <key>` válida; sin key → `401`
- [ ] Key con `status != 'active'` → `403`
- [ ] Rate limit: 10 pipelines/min por key (Upstash Redis prefix `wasiai:compose`) → `429`

### AC-2 — Payload de entrada
- [ ] Body acepta array `steps` de 2–10 elementos; fuera de rango → `400` con mensaje explícito
- [ ] Cada step tiene `agent_id` (UUID válido) e `input` (string u objeto)
- [ ] `"$prev"` en `input` del step N>1 se sustituye por el output del step anterior
- [ ] `"$prev"` en valores de objeto también se sustituye (e.g. `{ "text": "$prev" }`)
- [ ] Campos desconocidos en body o steps: ignorados silenciosamente
- [ ] JSON malformado → `400`

### AC-3 — Pre-flight (sin llamadas externas)
- [ ] Verificar que todos los `agent_id` existen y tienen `status = 'active'` → si no: `422` con `invalid_agents[]`
- [ ] Calcular costo estimado = `SUM(price_per_call)` de todos los agentes; si `keyBalance < estimado` → `402` con `{ required, available, currency: "USDC" }`

### AC-4 — Ejecución secuencial
- [ ] Pasos en orden estricto; paso N+1 no inicia hasta que N responde exitosamente
- [ ] Cada paso invoca `agent.endpoint_url` con el input resuelto
- [ ] `validateUrl()` antes de cada fetch externo (SSRF)
- [ ] Timeout por paso = `COMPOSE_STEP_TIMEOUT_MS` (default 8000ms) via `AbortController`
- [ ] Output extraído de `response` en body del agente; si no existe, body completo como string
- [ ] Output > `COMPOSE_MAX_STEP_OUTPUT_BYTES` (default 100KB) → `413` con error parcial

### AC-5 — Pagos por paso
- [ ] Descuento de `price_per_call` **después** de respuesta exitosa del agente (atómico)
- [ ] UPDATE atómico: `WHERE balance >= price_per_call`; si 0 rows → `402` con resultado parcial
- [ ] Cada paso completado registrado en `agent_calls` con `pipeline_id`, `is_trial: false`
- [ ] Paso fallido NO se cobra

### AC-6 — Respuesta exitosa (200)
- [ ] Body con `pipeline_id`, `steps_completed`, `steps_total`, `status`, `result`, `steps[]`, `total_cost_usdc`, `receipt_signature`
- [ ] `receipt_signature` = firma ECDSA (viem v2) del operator sobre `keccak256(pipelineId + keyId + totalCostUsdc + timestamp)`

### AC-7 — Errores parciales (502/504)
- [ ] Agente externo 4xx/5xx → `502` con `failed_at_step`, `steps_completed`, `result_so_far`, cobro parcial
- [ ] Timeout → `504` con resultado parcial
- [ ] `pipeline_executions` actualizado con `status='partial'` o `'failed'`

### AC-8 — Seguridad
- [ ] `createServiceClient()` — nunca `createServerClient()` ni `createClient()`
- [ ] Cero `NEXT_PUBLIC_` para secrets
- [ ] Cero hardcodes; todo desde env vars o DB
- [ ] Headers de respuesta de agente externo NO propagados al caller
- [ ] Output del agente validado como JSON antes de pasar al siguiente (si no parsea: pasa como string)

### AC-9 — Observabilidad
- [ ] Cada pipeline tiene `pipeline_id` (UUID v4) en logs y DB
- [ ] Logs estructurados JSON en cada evento (`pipeline_start`, `pipeline_step`, `pipeline_complete`, `pipeline_abort`)
- [ ] `pipeline_executions` registra `status`, `steps_completed`, `steps_requested`, `total_cost_usdc`

---

## Ruta del archivo

```
src/app/api/v1/compose/route.ts
```

**Archivo único de lógica nueva.** Reutiliza libs existentes:
- `@/lib/supabase/service` → `createServiceClient()`
- `@/lib/viem` → `getOperatorClient()`
- `@/lib/ssrf` → `validateUrl()`
- `@/lib/upstash` → nueva instancia `composeRatelimit`

---

## Migration SQL — 017

**Archivo:** `supabase/migrations/017_pipeline_executions.sql`

```sql
-- ============================================================
-- Migration 017: pipeline_executions + pipeline_id en agent_calls
-- Proyecto: WasiAI | Sprint: 3 | HU: 5.1
-- ============================================================

-- Tabla principal de ejecución de pipelines
CREATE TABLE IF NOT EXISTS pipeline_executions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id            UUID NOT NULL REFERENCES api_keys(id) ON DELETE RESTRICT,
  steps_requested   SMALLINT NOT NULL CHECK (steps_requested BETWEEN 2 AND 10),
  steps_completed   SMALLINT NOT NULL DEFAULT 0,
  total_cost_usdc   NUMERIC(18, 6) NOT NULL DEFAULT 0,
  status            TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  failed_at_step    SMALLINT,           -- NULL si success
  error_detail      TEXT,               -- mensaje del error si aplica
  receipt_signature TEXT,               -- ECDSA hex, NULL si failed antes de completar
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

-- FK opcional en agent_calls para trazabilidad de pipeline
ALTER TABLE agent_calls
  ADD COLUMN IF NOT EXISTS pipeline_id UUID REFERENCES pipeline_executions(id) ON DELETE SET NULL;

-- Índices
CREATE INDEX IF NOT EXISTS idx_pipeline_executions_key_id
  ON pipeline_executions(key_id);

CREATE INDEX IF NOT EXISTS idx_pipeline_executions_created_at
  ON pipeline_executions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_calls_pipeline_id
  ON agent_calls(pipeline_id)
  WHERE pipeline_id IS NOT NULL;

-- RLS
ALTER TABLE pipeline_executions ENABLE ROW LEVEL SECURITY;

-- Service role acceso total (endpoint usa createServiceClient)
CREATE POLICY "service_role_full_access" ON pipeline_executions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Owners de keys pueden leer sus pipelines (futuro dashboard)
CREATE POLICY "key_owner_read" ON pipeline_executions
  FOR SELECT
  USING (
    key_id IN (
      SELECT id FROM api_keys WHERE user_id = auth.uid()
    )
  );
```

---

## Request / Response Schema

### Request

```
POST /api/v1/compose
X-API-Key: wai_sk_xxxxx
Content-Type: application/json
```

```json
{
  "steps": [
    {
      "agent_id": "550e8400-e29b-41d4-a716-446655440000",
      "input": "Resume este contrato legal: El contrato establece que las partes..."
    },
    {
      "agent_id": "550e8400-e29b-41d4-a716-446655440001",
      "input": "$prev"
    },
    {
      "agent_id": "550e8400-e29b-41d4-a716-446655440002",
      "input": {
        "text": "$prev",
        "format": "json",
        "language": "es"
      }
    }
  ]
}
```

**Reglas:**
- `steps`: array, 2–10 elementos. Requerido.
- `steps[].agent_id`: UUID v4 válido. Requerido.
- `steps[].input`: `string | object`. Requerido.
- `"$prev"` (string exacto): en step N>1, se sustituye por output del step N-1.
- `"$prev"` en valores de objeto también se sustituye.
- Step 1 no puede usar `"$prev"` (no hay output previo).
- Campos extra: ignorados silenciosamente.

### Response exitosa (200 OK)

```json
{
  "pipeline_id": "7f3e9c2a-1b4d-4e8f-a6c0-2d5b9f0e3a1c",
  "steps_completed": 3,
  "steps_total": 3,
  "status": "success",
  "result": "{\"summary\": [\"Punto 1\", \"Punto 2\"]}",
  "steps": [
    {
      "step": 1,
      "agent_id": "550e8400-e29b-41d4-a716-446655440000",
      "input": "Resume este contrato legal: El contrato establece que...",
      "output": "El contrato establece tres obligaciones principales...",
      "latency_ms": 1240,
      "cost_usdc": "0.050000"
    },
    {
      "step": 2,
      "agent_id": "550e8400-e29b-41d4-a716-446655440001",
      "input": "El contrato establece tres obligaciones principales...",
      "output": "Puntos clave: 1. Entrega en 30 días. 2. Pago neto 60.",
      "latency_ms": 980,
      "cost_usdc": "0.030000"
    },
    {
      "step": 3,
      "agent_id": "550e8400-e29b-41d4-a716-446655440002",
      "input": "{\"text\":\"Puntos clave: 1. Entrega en 30 días...\",\"format\":\"json\",\"language\":\"es\"}",
      "output": "{\"summary\": [\"Punto 1\", \"Punto 2\"]}",
      "latency_ms": 1510,
      "cost_usdc": "0.040000"
    }
  ],
  "total_cost_usdc": "0.120000",
  "receipt_signature": "0xabc123...def456"
}
```

### Response error parcial (502 Bad Gateway)

```json
{
  "pipeline_id": "7f3e9c2a-1b4d-4e8f-a6c0-2d5b9f0e3a1c",
  "status": "partial",
  "failed_at_step": 2,
  "steps_completed": 1,
  "steps_total": 3,
  "error": "Agent 550e8400-e29b-41d4-a716-446655440001 returned 500",
  "result_so_far": "El contrato establece tres obligaciones principales...",
  "steps": [
    {
      "step": 1,
      "agent_id": "550e8400-e29b-41d4-a716-446655440000",
      "output": "El contrato establece tres obligaciones principales...",
      "latency_ms": 1240,
      "cost_usdc": "0.050000"
    }
  ],
  "total_cost_usdc": "0.050000"
}
```

### Códigos de error

| HTTP | Condición | Body |
|------|-----------|------|
| `400` | JSON malformado o steps fuera de rango | `{ "error": "steps must be an array of 2–10 elements" }` |
| `401` | X-API-Key ausente o no encontrada | `{ "error": "Unauthorized" }` |
| `402` | Saldo insuficiente pre-flight | `{ "error": "Insufficient balance", "required": "0.12", "available": "0.05", "currency": "USDC" }` |
| `403` | Key inactiva | `{ "error": "API key is inactive" }` |
| `413` | Output de step supera límite | `{ "error": "Step 2 output exceeds size limit (100KB)" }` |
| `422` | Agentes inválidos o inactivos | `{ "error": "Invalid agents", "invalid_agents": ["<uuid>"] }` |
| `429` | Rate limit excedido | `{ "error": "Rate limit exceeded. Try again in 60 seconds." }` |
| `502` | Agente externo retornó error | Ver schema error parcial |
| `504` | Timeout en un step | `{ ..., "error": "Step 2 timed out after 8000ms", "status": "partial" }` |

---

## Código completo — route.ts

```typescript
// src/app/api/v1/compose/route.ts
// HU-5.1 — Agent-to-Agent Routing
// GOLDEN PATH: Next.js 14 App Router | createServiceClient | viem v2 | no ethers | no hardcodes

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getOperatorClient } from '@/lib/viem'
import { validateUrl } from '@/lib/ssrf'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { keccak256, encodePacked } from 'viem'
import { randomUUID } from 'crypto'

// ─── Config desde env vars (no hardcodes) ────────────────────────
const STEP_TIMEOUT_MS = parseInt(
  process.env.COMPOSE_STEP_TIMEOUT_MS?.trim() ?? '8000',
  10
)
const MAX_STEP_OUTPUT_BYTES = parseInt(
  process.env.COMPOSE_MAX_STEP_OUTPUT_BYTES?.trim() ?? '102400',
  10
)

// ─── Rate limit: wasiai:compose, 10 req/min por key ──────────────
const composeRatelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '60 s'),
  prefix: 'wasiai:compose',
  analytics: false,
})

// ─── Tipos internos ───────────────────────────────────────────────
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

// ─── Handler principal ────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = createServiceClient()

  // ── [1] Parse & Validate body ──────────────────────────────────
  let body: { steps?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    )
  }

  const rawSteps = body?.steps
  if (!Array.isArray(rawSteps) || rawSteps.length < 2 || rawSteps.length > 10) {
    return NextResponse.json(
      { error: 'steps must be an array of 2–10 elements' },
      { status: 400 }
    )
  }

  const steps: PipelineStep[] = []
  for (let i = 0; i < rawSteps.length; i++) {
    const s = rawSteps[i]
    if (!s || typeof s !== 'object') {
      return NextResponse.json(
        { error: `Step ${i + 1} is invalid` },
        { status: 400 }
      )
    }
    const { agent_id, input } = s as Record<string, unknown>
    if (typeof agent_id !== 'string' || !isValidUUID(agent_id)) {
      return NextResponse.json(
        { error: `Step ${i + 1}: agent_id must be a valid UUID` },
        { status: 400 }
      )
    }
    if (input === undefined || input === null) {
      return NextResponse.json(
        { error: `Step ${i + 1}: input is required` },
        { status: 400 }
      )
    }
    // $prev en step 1 no tiene sentido (no hay output previo)
    if (i === 0 && input === '$prev') {
      return NextResponse.json(
        { error: 'Step 1 cannot use "$prev" (no previous output)' },
        { status: 400 }
      )
    }
    steps.push({ agent_id, input: input as string | Record<string, unknown> })
  }

  // ── [2] Auth: validar API key ──────────────────────────────────
  const apiKey = req.headers.get('x-api-key')?.trim()
  if (!apiKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Comparar con hash SHA-256 de la key (mismo patrón que HU-1.1)
  const keyHash = await hashApiKey(apiKey)
  const { data: keyRow, error: keyError } = await supabase
    .from('api_keys')
    .select('id, status, balance, user_id')
    .eq('key_hash', keyHash)
    .single()

  if (keyError || !keyRow) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (keyRow.status !== 'active') {
    return NextResponse.json({ error: 'API key is inactive' }, { status: 403 })
  }

  const keyId: string = keyRow.id

  // ── [3] Rate limit (por keyId, no IP) ─────────────────────────
  const { success: rlSuccess } = await composeRatelimit.limit(keyId)
  if (!rlSuccess) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again in 60 seconds.' },
      { status: 429 }
    )
  }

  // ── [4] Pre-flight: validar agentes ───────────────────────────
  const agentIds = steps.map((s) => s.agent_id)
  const { data: agentRows, error: agentError } = await supabase
    .from('agents')
    .select('id, status, price_per_call, endpoint_url')
    .in('id', agentIds)

  if (agentError) {
    return NextResponse.json({ error: 'Internal error validating agents' }, { status: 500 })
  }

  const foundAgents = new Map<string, AgentRow>(
    (agentRows ?? []).map((a: AgentRow) => [a.id, a])
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
      { status: 422 }
    )
  }

  // ── [5] Pre-flight: verificar saldo ───────────────────────────
  // Precio se lee por agent_id en orden del pipeline (puede haber duplicados)
  const estimatedCost = steps.reduce((sum, s) => {
    const agent = foundAgents.get(s.agent_id)!
    return sum + (agent.price_per_call ?? 0)
  }, 0)

  const currentBalance: number = keyRow.balance ?? 0
  if (currentBalance < estimatedCost) {
    return NextResponse.json(
      {
        error: 'Insufficient balance',
        required: estimatedCost.toFixed(6),
        available: currentBalance.toFixed(6),
        currency: 'USDC',
      },
      { status: 402 }
    )
  }

  // ── [6] Crear pipeline_execution provisional ──────────────────
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

  // ── [7] Loop de ejecución secuencial ──────────────────────────
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

    // [7b] Re-leer precio actual del agente desde DB (no cachear del pre-flight)
    const { data: freshAgent, error: freshAgentError } = await supabase
      .from('agents')
      .select('price_per_call, endpoint_url, status')
      .eq('id', stepDef.agent_id)
      .single()

    if (freshAgentError || !freshAgent || freshAgent.status !== 'active') {
      await abortPipeline(supabase, pipelineId, stepNum, stepResults, totalCost,
        `Agent ${stepDef.agent_id} is no longer active`)
      return buildPartialResponse(pipelineId, stepNum, stepResults, totalCost,
        `Agent ${stepDef.agent_id} is no longer active`, 502)
    }

    const pricePerCall: number = freshAgent.price_per_call ?? 0
    const endpointUrl: string = freshAgent.endpoint_url

    // [7c] SSRF protection
    const isSafe = await validateUrl(endpointUrl)
    if (!isSafe) {
      await abortPipeline(supabase, pipelineId, stepNum, stepResults, totalCost,
        `Agent ${stepDef.agent_id} endpoint URL failed SSRF validation`)
      return buildPartialResponse(pipelineId, stepNum, stepResults, totalCost,
        `Agent ${stepDef.agent_id} endpoint URL is invalid`, 502)
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
      })
      clearTimeout(timeoutId)

      if (!agentRes.ok) {
        const latencyMs = Date.now() - stepStart
        structuredLog('pipeline_step', {
          pipeline_id: pipelineId, step: stepNum,
          agent_id: stepDef.agent_id, latency_ms: latencyMs,
          status: 'error', http_status: agentRes.status,
        })
        await abortPipeline(supabase, pipelineId, stepNum, stepResults, totalCost,
          `Agent ${stepDef.agent_id} returned ${agentRes.status}`)
        return buildPartialResponse(pipelineId, stepNum, stepResults, totalCost,
          `Agent ${stepDef.agent_id} returned ${agentRes.status}`, 502)
      }

      // NO propagar headers del agente externo al caller
      agentResponseBody = await agentRes.json().catch(() => agentRes.text())

    } catch (err: unknown) {
      clearTimeout(timeoutId)
      const latencyMs = Date.now() - stepStart
      const isTimeout = err instanceof Error && err.name === 'AbortError'
      const errMsg = isTimeout
        ? `Step ${stepNum} timed out after ${STEP_TIMEOUT_MS}ms`
        : `Step ${stepNum} fetch error: ${String(err)}`

      structuredLog('pipeline_step', {
        pipeline_id: pipelineId, step: stepNum,
        agent_id: stepDef.agent_id, latency_ms: latencyMs,
        status: isTimeout ? 'timeout' : 'error',
      })
      await abortPipeline(supabase, pipelineId, stepNum, stepResults, totalCost, errMsg)
      return buildPartialResponse(pipelineId, stepNum, stepResults, totalCost,
        errMsg, isTimeout ? 504 : 502)
    }

    const latencyMs = Date.now() - stepStart

    // [7e] Extraer output
    const rawOutput = extractOutput(agentResponseBody)

    // Verificar tamaño del output
    const outputBytes = new TextEncoder().encode(rawOutput).length
    if (outputBytes > MAX_STEP_OUTPUT_BYTES) {
      await abortPipeline(supabase, pipelineId, stepNum, stepResults, totalCost,
        `Step ${stepNum} output exceeds size limit`)
      return NextResponse.json(
        { error: `Step ${stepNum} output exceeds size limit (${Math.round(MAX_STEP_OUTPUT_BYTES / 1024)}KB)` },
        { status: 413 }
      )
    }

    prevOutput = rawOutput

    // [7f] Descuento atómico de saldo (UPDATE ... WHERE balance >= price)
    const { data: updateData, error: updateError } = await supabase.rpc(
      'deduct_key_balance',
      { p_key_id: keyId, p_amount: pricePerCall }
    )

    // Si la función RPC no existe, usar UPDATE directo con count check:
    // const { count } = await supabase
    //   .from('api_keys')
    //   .update({ balance: supabase.rpc('balance - ' + pricePerCall) })
    //   .eq('id', keyId)
    //   .gte('balance', pricePerCall)
    // if (count === 0) { ... }

    if (updateError || updateData === false) {
      // Saldo insuficiente en mitad del pipeline
      await abortPipeline(supabase, pipelineId, stepNum, stepResults, totalCost,
        'Insufficient balance mid-pipeline')
      const partialResp = buildPartialResponse(
        pipelineId, stepNum, stepResults, totalCost,
        'Insufficient balance mid-pipeline', 402
      )
      return partialResp
    }

    totalCost += pricePerCall

    // [7g] Registrar agent_call individual
    await supabase.from('agent_calls').insert({
      agent_id: stepDef.agent_id,
      key_id: keyId,
      pipeline_id: pipelineId,
      status: 'success',
      latency_ms: latencyMs,
      cost_usdc: pricePerCall,
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
      pipeline_id: pipelineId, step: stepNum,
      agent_id: stepDef.agent_id, latency_ms: latencyMs,
      status: 'success', cost_usdc: pricePerCall,
    })
  }

  // ── [8] Firma ECDSA del receipt ────────────────────────────────
  const timestamp = Math.floor(Date.now() / 1000)
  const receiptSignature = await signPipelineReceipt(
    pipelineId,
    keyId,
    totalCost.toFixed(6),
    timestamp
  )

  // ── [9] Actualizar pipeline_execution ─────────────────────────
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

  // ── [10] Responder 200 ─────────────────────────────────────────
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

// ─── Helpers ──────────────────────────────────────────────────────

/** Sustituye "$prev" (string exacto o valores en objeto) por prevOutput */
function resolvePrev(
  input: string | Record<string, unknown>,
  prevOutput: string
): string | Record<string, unknown> {
  if (typeof input === 'string') {
    return input === '$prev' ? prevOutput : input
  }
  // objeto: sustituir valores string que sean "$prev"
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
    // Si tiene campo "response", usarlo
    if ('response' in obj) {
      const r = obj['response']
      return typeof r === 'string' ? r : JSON.stringify(r)
    }
    // Body completo como string
    return JSON.stringify(obj)
  }
  return String(body)
}

/** Firma ECDSA del receipt del pipeline usando viem v2 */
async function signPipelineReceipt(
  pipelineId: string,
  keyId: string,
  totalCostUsdc: string,
  timestamp: number
): Promise<string> {
  const operatorClient = getOperatorClient()

  const messageHash = keccak256(
    encodePacked(
      ['string', 'string', 'string', 'uint256'],
      [pipelineId, keyId, totalCostUsdc, BigInt(timestamp)]
    )
  )

  const signature = await operatorClient.signMessage({
    message: { raw: messageHash },
  })

  return signature // "0x..."
}

/** Actualiza pipeline_executions como abortado y loguea */
async function abortPipeline(
  supabase: ReturnType<typeof createServiceClient>,
  pipelineId: string,
  failedAtStep: number,
  stepResults: StepResult[],
  totalCost: number,
  errorDetail: string
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
  httpStatus: number
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
      error,
      ...(resultSoFar !== undefined ? { result_so_far: resultSoFar } : {}),
      steps: stepResults,
      total_cost_usdc: totalCost.toFixed(6),
    },
    { status: httpStatus }
  )
}

/** Log estructurado JSON (no console.log con strings sueltos) */
function structuredLog(event: string, data: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ...data, ts: new Date().toISOString() }))
}

/** UUID v4 validation */
function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str)
}

/** Hash SHA-256 de la API key (mismo patrón que HU-1.1) */
async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(key)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
```

> **NOTA para Dev:** La función RPC `deduct_key_balance` puede no existir. Si no existe, implementar el descuento atómico con UPDATE directo:
>
> ```sql
> -- Agregar a migration 017 o crear migration 017b
> CREATE OR REPLACE FUNCTION deduct_key_balance(p_key_id UUID, p_amount NUMERIC)
> RETURNS BOOLEAN AS $$
> DECLARE
>   rows_updated INT;
> BEGIN
>   UPDATE api_keys
>     SET balance = balance - p_amount
>   WHERE id = p_key_id AND balance >= p_amount;
>   GET DIAGNOSTICS rows_updated = ROW_COUNT;
>   RETURN rows_updated > 0;
> END;
> $$ LANGUAGE plpgsql SECURITY DEFINER;
> ```

---

## Definition of Done (checklist completo)

### Código
- [ ] `src/app/api/v1/compose/route.ts` existe y compila sin errores TypeScript
- [ ] Cero imports de `ethers` en archivos nuevos
- [ ] Cero variables `NEXT_PUBLIC_` para secrets
- [ ] Cero valores hardcodeados (UUIDs, addresses, precios, timeouts)
- [ ] `createServiceClient()` usado — sin `createClient()` ni `createServerClient()`
- [ ] `validateUrl()` llamado antes de cada fetch externo
- [ ] `AbortController` con `COMPOSE_STEP_TIMEOUT_MS` en cada fetch de agente externo
- [ ] Headers de respuesta del agente externo NO propagados al caller
- [ ] Output de paso validado contra `COMPOSE_MAX_STEP_OUTPUT_BYTES`
- [ ] Descuento atómico implementado (función RPC o UPDATE con WHERE balance >= price)
- [ ] Rate limiting con prefix `wasiai:compose`, sliding window 10 req/60s por `keyId`
- [ ] Logs estructurados JSON (no strings sueltos en `console.log`)

### Migration
- [ ] `supabase/migrations/017_pipeline_executions.sql` existe
- [ ] Migration es idempotente (`IF NOT EXISTS` en todos los CREATE)
- [ ] `pipeline_executions` tiene RLS activo con policies `service_role_full_access` y `key_owner_read`
- [ ] `agent_calls.pipeline_id` columna nullable con FK a `pipeline_executions`
- [ ] Índices creados en `key_id`, `created_at DESC`, `pipeline_id` (partial)
- [ ] Función SQL `deduct_key_balance` creada (si se usa RPC approach)

### Tests manuales (curl / Postman)
- [ ] Sin `X-API-Key` → `401`
- [ ] Key inexistente → `401`
- [ ] Key con `status = 'suspended'` → `403`
- [ ] `steps` con 1 elemento → `400` con mensaje
- [ ] `steps` con 11 elementos → `400` con mensaje
- [ ] `agent_id` inexistente → `422` con `invalid_agents`
- [ ] Agente inactivo → `422` con `invalid_agents`
- [ ] Saldo insuficiente pre-flight → `402` con `required/available/currency`
- [ ] Pipeline de 2 steps exitoso → `200` con `receipt_signature` no nulo y no vacío
- [ ] `"$prev"` en step 2 resuelto con output real del step 1
- [ ] `"$prev"` dentro de objeto (`{ "text": "$prev" }`) resuelto correctamente
- [ ] Agente externo retorna `500` en step 2 → `502` con `steps_completed: 1`, cobro parcial en DB
- [ ] Timeout simulado (agente que cuelga >8s) → `504` con resultado parcial
- [ ] URL de agente con IP privada (`192.168.1.1`) → bloqueada por SSRF, pipeline aborta
- [ ] 11 requests seguidos desde misma key → el 11vo → `429`
- [ ] `pipeline_executions` tiene registro con `status='success'` después de pipeline exitoso
- [ ] `agent_calls` tiene `pipeline_id` vinculado en cada step del pipeline exitoso

### Observabilidad
- [ ] `pipeline_id` UUID v4 aparece en logs estructurados de cada evento
- [ ] Logs contienen: `pipeline_start`, `pipeline_step` (por cada step), `pipeline_complete` o `pipeline_abort`
- [ ] `pipeline_executions` refleja estado final correcto (`success` / `partial` / `failed`)

### Seguridad
- [ ] URL con IP privada bloqueada (10.x, 192.168.x, 127.x, 169.254.x, ::1)
- [ ] URL con protocolo `http://` bloqueada (solo HTTPS)
- [ ] URL con protocolo `file://` bloqueada
- [ ] `OPERATOR_PRIVATE_KEY` nunca expuesto en response ni logs

### Deploy checklist
- [ ] Variables de entorno en Vercel: `COMPOSE_STEP_TIMEOUT_MS`, `COMPOSE_MAX_STEP_OUTPUT_BYTES` (opcionales con defaults)
- [ ] Migration 017 aplicada en Supabase antes de activar el endpoint en producción
- [ ] Vercel Pro verificado (timeout 60s suficiente para pipeline 25s + overhead)

---

## Notas de implementación

### 1. Función RPC `deduct_key_balance`
Si el codebase ya tiene pattern de funciones RPC en Supabase, preferir esa vía para el descuento atómico. Si no, el UPDATE directo con `rowsAffected` también es válido pero requiere manejo cuidadoso. La función SQL proporcionada en el código es la implementación recomendada.

### 2. Hash de API key
El patrón `hashApiKey()` en el route usa `crypto.subtle` (Web Crypto API, disponible en Edge/Node >=18). Si el codebase ya tiene una función de hash compartida en `@/lib/api-keys.ts` o similar, **usa esa en lugar de reimplementar**. Verificar primero.

### 3. `$prev` en objetos anidados
La implementación actual sustituye solo valores de primer nivel en objetos (`{ "text": "$prev" }`). No hace deep substitution. Si se necesita sustitución profunda en el futuro, es E5.2.

### 4. `deduct_key_balance` — race condition
El UPDATE atómico es la única protección real contra race conditions. El pre-flight es solo una estimación de costo — el balance real puede cambiar entre el pre-flight y la ejecución de cada step (si hay requests paralelos desde la misma key). El UPDATE `WHERE balance >= price` es la garantía definitiva.

### 5. Precio re-leído por step
El precio del agente se re-lee de DB en cada step (no se cachea del pre-flight). Esto previene cobrar un precio obsoleto si el creator actualiza el precio mientras el pipeline está corriendo. El costo estimado del pre-flight puede diferir del costo real; el costo real es la suma de los `price_per_call` leídos en [7b].

### 6. Vercel timeout
Pipeline timeout = 25s (no configurable en route.ts, es una propiedad del plan Vercel). Con `COMPOSE_STEP_TIMEOUT_MS=8000` y hasta 10 steps, el peor caso es 80s — eso supera el timeout de Vercel Pro (60s). En práctica, 10 steps de 8s cada uno es un caso extremo; el default razonable para la mayoría de pipelines es ≤5 steps × ≤3s = 15s. Considerar documentar que 10 steps a max timeout no está garantizado sin Edge Streaming.

### 7. `X-Pipeline-Id` en requests a agentes
El header `X-Pipeline-Id` que se envía a cada agente externo permite que los agentes (si lo soportan) correlacionen llamadas del mismo pipeline. No es obligatorio para los agentes procesarlo.

### 8. Output como string
Todo output se normaliza a string antes de pasarlo al siguiente step. Si el agente retorna JSON y el siguiente agente espera JSON, el siguiente agente recibirá el JSON como string y deberá parsearlo. Esto es intencional — WasiAI no conoce el tipo de datos de cada agente.

### 9. `composeRatelimit` — instancia
La instancia `composeRatelimit` puede vivir en `@/lib/upstash.ts` como export adicional, o en un archivo separado `@/lib/upstash-compose.ts`. Verificar la estructura actual del archivo `@/lib/upstash.ts` antes de decidir dónde ponerla para no romper el singleton existente del rate limiter de trials (prefix `wasiai:trial`).

### 10. `NEXT_PUBLIC_` check
Antes de hacer commit, correr:
```bash
grep -r "NEXT_PUBLIC_" src/app/api/v1/compose/
```
Debe retornar vacío.

---

*Story generado por SM Agent (BMAD v6) — 2026-02-26*  
*100% autocontenido — el Dev puede implementar desde este archivo sin contexto adicional*
