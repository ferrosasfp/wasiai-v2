# Story File — HU-5.1: Agent Compose API (Pipeline Secuencial con Pago x402)

> **Artefacto S2 — Scrum Master**
> Épica 5 — Agent-to-Agent Routing
> Fecha: 2026-02-28
> Estado: LISTO PARA DEV
> Gates: HU_APPROVED ✅ | SPEC_APPROVED ✅
>
> ⚠️ ESTE ARCHIVO ES AUTOCONTENIDO — el Dev NO necesita leer ningún otro documento.
> Todo el código, las decisiones de arquitectura, y las instrucciones están aquí.

---

## Historia de Usuario

**Como** agente autónomo (o developer con API key),
**quiero** invocar un pipeline de múltiples agentes IA en una sola llamada HTTP,
**para que** WasiAI orqueste y pague cada paso automáticamente on-chain, sin que yo necesite saber cuántos agentes intermedios existen ni gestionar los pagos individuales.

---

## Contexto de Negocio (resumen ejecutivo)

WasiAI tiene x402 funcionando para invocar **un** agente. El Compose es el salto a **agentes que coordinan agentes**.

**Flujo ejemplo:**
```
POST /api/v1/compose
{
  "steps": [
    { "agent_slug": "ocr-reader",         "input": "<image_url>" },
    { "agent_slug": "translator-es",      "pass_output": true },
    { "agent_slug": "sentiment-analyzer", "pass_output": true }
  ]
}

→ WasiAI ejecuta en secuencia:
   Step 0: ocr-reader         → extrae texto  → paga 0.008 USDC on-chain
   Step 1: translator-es      → traduce texto → paga 0.002 USDC on-chain
   Step 2: sentiment-analyzer → analiza       → paga 0.001 USDC on-chain

→ Response: output del Step 2 + receipts firmados del pipeline
```

---

## Orden de Implementación Obligatorio

```
1. Migration 017          ← schema primero, siempre
2. Endpoint compose       ← lógica de orquestación
3. Rate limit             ← añadir getComposeLimit() a ratelimit.ts
4. Receipts               ← integrar signReceipt() por step
5. Tests                  ← unitarios + integración Fuji
```

No cambiar este orden. Si hay duda, preguntar antes de avanzar.

---

## Archivos a Crear / Modificar

| Acción | Archivo | Notas |
|---|---|---|
| CREAR | `supabase/migrations/017_pipeline_compose.sql` | Columnas pipeline_id + step_index |
| CREAR | `src/app/api/v1/compose/route.ts` | Endpoint principal ~250 líneas |
| MODIFICAR | `src/lib/ratelimit.ts` | Añadir `getComposeLimit()` (lazy singleton) |

**SIN TOCAR:**
- `/invoke/route.ts` — no modificar
- Contratos Solidity — sin cambio on-chain
- Frontend — fuera de scope
- Otras migrations — solo 017

---

## PASO 1 — Migration 017

**Archivo:** `supabase/migrations/017_pipeline_compose.sql`

```sql
-- Migration 017: Add pipeline tracking columns to agent_calls
-- HU-5.1 — Compose API

ALTER TABLE agent_calls
  ADD COLUMN IF NOT EXISTS pipeline_id  uuid    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS step_index   integer DEFAULT NULL;

-- Índice para consultas de auditoría: "dame todos los steps de un pipeline"
CREATE INDEX IF NOT EXISTS idx_agent_calls_pipeline_id
  ON agent_calls (pipeline_id)
  WHERE pipeline_id IS NOT NULL;

-- Índice compuesto para ordenar steps de un pipeline por orden de ejecución
CREATE INDEX IF NOT EXISTS idx_agent_calls_pipeline_step
  ON agent_calls (pipeline_id, step_index)
  WHERE pipeline_id IS NOT NULL;

COMMENT ON COLUMN agent_calls.pipeline_id  IS 'UUID del pipeline compose; NULL para llamadas individuales vía /invoke';
COMMENT ON COLUMN agent_calls.step_index   IS '0-based índice del step dentro del pipeline; NULL para /invoke';
```

**Notas críticas:**
- Columnas nullable — no rompe `/invoke` existente (inserta NULL en ambas)
- RLS hereda de `agent_calls` (ya activo desde migration 000)
- No se necesita RPC nueva — el insert del compose pasa `pipeline_id` y `step_index`

**Verificación post-migration:**
```sql
-- Debe devolver las columnas pipeline_id y step_index
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'agent_calls'
  AND column_name IN ('pipeline_id', 'step_index');
```

---

## PASO 2 — Endpoint Compose

**Archivo:** `src/app/api/v1/compose/route.ts`

### Tipos e Interfaces

```typescript
// ── Request types
interface ComposeStep {
  agent_slug:   string
  input?:       string   // input explícito para este step
  pass_output?: boolean  // si true, usa output del step anterior como input
}

interface ComposeRequest {
  steps: ComposeStep[]   // min: 1, max: 5
}

// ── Response types
interface StepReceipt {
  step:              number
  agent_slug:        string
  cost_usdc:         string        // e.g. "0.008000"
  receipt_signature: string        // firma ECDSA del operator
  call_id:           string        // UUID del agent_call en DB
}

interface ComposeResponse {
  pipeline_id:      string
  steps_executed:   number
  total_cost_usdc:  string
  result:           unknown
  receipts:         StepReceipt[]
}

interface PipelineFailedResponse {
  error:            string
  code:             'step_failed'
  failed_step:      number
  reason:           string
  steps_executed:   number
  partial_receipts: StepReceipt[]
}

// ── Agent row from DB
interface AgentRow {
  id:              string
  slug:            string
  name:            string
  price_per_call:  number
  endpoint_url:    string
  status:          string
}

// ── Key row from DB
interface KeyRow {
  id:          string
  key_hash:    string
  is_active:   boolean
  budget_usdc: number
  spent_usdc:  number
}
```

### Imports y Constantes

```typescript
import { NextRequest, NextResponse }  from 'next/server'
import { createHash }                  from 'crypto'
import { createServiceClient }         from '@/lib/supabase/server'
import { validateEndpointUrl }         from '@/lib/security/validateEndpointUrl'
import { getComposeLimit }             from '@/lib/ratelimit'
import { signReceipt }                 from '@/lib/receipts/signReceipt'
import { keyHashToBytes32 }            from '@/lib/contracts/marketplaceClient'
import { logger }                      from '@/lib/logger'
// NO ethers.js — solo viem v2 (ya migrado en HAL-010)
// NO NEXT_PUBLIC_ para secrets

const MAX_STEPS    = 5
const STEP_TIMEOUT = 8_000  // ms por step
```

### Función Principal POST

```typescript
export async function POST(request: NextRequest) {
  const supabase = createServiceClient()

  // ── [0] RATE LIMIT
  const rawKey = request.headers.get('X-Api-Key') ?? ''
  const keyHash = rawKey
    ? createHash('sha256').update(rawKey).digest('hex')
    : 'anonymous'

  const limiter = getComposeLimit()
  const identifier = `key:${keyHash.slice(0, 24)}`
  const { success, limit, remaining, reset } = await limiter.limit(identifier)

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
      }
    )
  }

  // ── [1] AUTH
  if (!rawKey) {
    return NextResponse.json(
      { error: 'Invalid or inactive API key', code: 'invalid_key' },
      { status: 401 }
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
      { status: 401 }
    )
  }

  // ── [2] PARSE + VALIDAR BODY
  let body: ComposeRequest
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'validation_error' },
      { status: 400 }
    )
  }

  const validationError = validateSteps(body.steps)
  if (validationError) {
    return NextResponse.json(
      { error: validationError, code: 'validation_error' },
      { status: 400 }
    )
  }

  const steps = body.steps

  // ── [3] RESOLVER AGENTES (1 query batch)
  const slugs = [...new Set(steps.map(s => s.agent_slug))]
  const { data: agentsData } = await supabase
    .from('agents')
    .select('id, slug, name, price_per_call, endpoint_url, status')
    .in('slug', slugs)
    .eq('status', 'active')

  const agentMap = new Map<string, AgentRow>(
    (agentsData ?? []).map(a => [a.slug, a as AgentRow])
  )

  for (let i = 0; i < steps.length; i++) {
    if (!agentMap.has(steps[i].agent_slug)) {
      return NextResponse.json(
        { error: 'Agent not found', code: 'agent_not_found', step: i, slug: steps[i].agent_slug },
        { status: 404 }
      )
    }
  }

  // ── [4] PREFLIGHT DE SALDO
  const totalRequired = steps.reduce((acc, s) => acc + (agentMap.get(s.agent_slug)?.price_per_call ?? 0), 0)
  const available = keyRow.budget_usdc - keyRow.spent_usdc

  if (available < totalRequired) {
    return NextResponse.json(
      {
        error:          'Insufficient balance',
        code:           'insufficient_balance',
        required_usdc:  totalRequired.toFixed(6),
        available_usdc: available.toFixed(6),
      },
      { status: 402 }
    )
  }

  // ── [5] SSRF PREFLIGHT (todos los endpoints antes de ejecutar)
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
        { status: 422 }
      )
    }
  }

  // ── [6] REDIS LOCK (race condition mitigation)
  // Importar redis client desde @/lib/ratelimit o @/lib/redis
  const redis = getRedisClient()
  const lockKey = `compose:lock:${keyRow.id}`
  const acquired = await redis.set(lockKey, '1', { nx: true, ex: 30 })

  if (!acquired) {
    return NextResponse.json(
      { error: 'Concurrent pipeline in progress for this key', code: 'key_locked' },
      { status: 409 }
    )
  }

  // ── [7] LOOP SECUENCIAL
  const pipelineId = crypto.randomUUID()
  const receipts: StepReceipt[] = []
  let lastOutput: string | null = null

  try {
    for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
      const step  = steps[stepIndex]
      const agent = agentMap.get(step.agent_slug)!

      // [7a] Construir input del step
      let stepInput: string
      if (stepIndex === 0) {
        stepInput = step.input ?? ''
      } else if (step.pass_output) {
        stepInput = lastOutput ?? ''
      } else {
        stepInput = step.input ?? ''
      }

      // [7b] Deducir saldo atómicamente ANTES del fetch
      const { error: spendError } = await supabase.rpc('increment_agent_key_spend', {
        p_key_id: keyRow.id,
        p_amount: agent.price_per_call,
      })

      if (spendError) {
        logger.warn({ spendError, stepIndex, pipelineId }, 'Spend RPC failed — possible race condition')
        return NextResponse.json(
          {
            error:            `Pipeline failed at step ${stepIndex}`,
            code:             'step_failed',
            failed_step:      stepIndex,
            reason:           'Insufficient balance (race condition detected)',
            steps_executed:   stepIndex,
            partial_receipts: receipts,
          } satisfies PipelineFailedResponse,
          { status: 422 }
        )
      }

      // [7c] Llamar al agente externo
      const startMs = Date.now()
      let stepOutput: unknown
      let stepStatus: 'success' | 'error' = 'success'
      let stepErrorReason = ''

      try {
        const res = await fetch(agent.endpoint_url, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ input: stepInput }),
          signal:  AbortSignal.timeout(STEP_TIMEOUT),
        })

        if (res.ok) {
          const ct = res.headers.get('content-type') ?? ''
          stepOutput = ct.includes('application/json') ? await res.json() : await res.text()
        } else {
          stepStatus = 'error'
          stepErrorReason = `Upstream ${res.status}`
          stepOutput = { error: stepErrorReason }
        }
      } catch (err) {
        stepStatus = 'error'
        stepErrorReason = err instanceof Error && err.name === 'TimeoutError'
          ? 'TIMEOUT'
          : `Upstream unreachable: ${String(err)}`
        stepOutput = { error: stepErrorReason }
      }

      const latencyMs = Date.now() - startMs

      // [7d] Logging del step
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
            agent_slug:  agent.slug,
            is_trial:    false,
            pipeline_id: pipelineId,
            step_index:  stepIndex,
          })
          .select('id')
          .single()
        callId = callRecord?.id ?? ''
      } catch (logErr) {
        logger.warn({ logErr, stepIndex, pipelineId }, 'logCall failed — continuing pipeline')
      }

      // [7e] Firmar receipt del step (best-effort)
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
          .then()
          .catch(e => logger.warn({ e }, 'receipt_signature update failed'))
      } catch (sigErr) {
        logger.warn({ sigErr, stepIndex }, 'signReceipt failed — pipeline continues')
      }

      // [7f] Evaluar resultado del step
      if (stepStatus === 'error') {
        return NextResponse.json(
          {
            error:            `Pipeline failed at step ${stepIndex}`,
            code:             'step_failed',
            failed_step:      stepIndex,
            reason:           stepErrorReason,
            steps_executed:   stepIndex,    // steps 0..stepIndex-1 fueron exitosos
            partial_receipts: receipts,
          } satisfies PipelineFailedResponse,
          { status: 422 }
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

      // [7g] Incrementar stats del agente (fire-and-forget)
      supabase
        .rpc('increment_agent_stats', { p_agent_id: agent.id, p_amount: agent.price_per_call })
        .then()
        .catch(e => logger.warn({ e }, 'increment_agent_stats failed'))
    }
  } finally {
    // Liberar lock siempre, pase lo que pase
    await redis.del(lockKey)
  }

  // ── [8] RESPONSE FINAL
  const totalCost = receipts.reduce((acc, r) => acc + parseFloat(r.cost_usdc), 0)

  return NextResponse.json(
    {
      pipeline_id:     pipelineId,
      steps_executed:  steps.length,
      total_cost_usdc: totalCost.toFixed(6),
      result:          parseOutputSafe(lastOutput),
      receipts,
    } satisfies ComposeResponse,
    { status: 200 }
  )
}
```

### Helpers

```typescript
// ── Validar el array de steps
function validateSteps(steps: unknown): string | null {
  if (!Array.isArray(steps)) return 'steps must be an array'
  if (steps.length < 1)      return 'steps must have at least 1 element'
  if (steps.length > MAX_STEPS) return `Max ${MAX_STEPS} steps per pipeline`

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

// ── Parsear output de forma segura (intenta JSON.parse, si falla devuelve string)
function parseOutputSafe(raw: string | null): unknown {
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

// ── Obtener Redis client (reusar el de Upstash ya configurado)
// Importar desde @/lib/ratelimit o crear helper propio
function getRedisClient() {
  // El mismo Redis de Upstash ya está en el proyecto vía @upstash/redis
  // Reusar la instancia existente de ratelimit.ts
  // Si no hay export de redis client, crear:
  const { Redis } = require('@upstash/redis')
  return new Redis({
    url:   process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
}
```

---

## PASO 3 — Rate Limit

**Archivo:** `src/lib/ratelimit.ts` — **AÑADIR** al final del archivo existente (no reemplazar nada):

```typescript
// ── Compose rate limiter (añadir a ratelimit.ts existente)
let _compose: Ratelimit | null = null

export function getComposeLimit() {
  return _compose ??= new Ratelimit({
    redis:   makeRedis(),          // usa el helper existente del archivo
    limiter: Ratelimit.slidingWindow(10, '1 m'),
    prefix:  'rl:compose',
  })
}
```

**Notas:**
- `makeRedis()` ya existe en `ratelimit.ts` — reutilizar
- Mismo patrón lazy singleton que los otros limiters del archivo
- Prefix `rl:compose` distinto de `rl:invoke` para no contaminar métricas

---

## PASO 4 — Receipts (ya integrados en el endpoint)

Los receipts reutilizan exactamente los mismos helpers que `/invoke`:

```typescript
import { signReceipt }      from '@/lib/receipts/signReceipt'
import { keyHashToBytes32 } from '@/lib/contracts/marketplaceClient'

// Cada step llama:
const signature = await signReceipt({
  keyId:      keyHashToBytes32(keyRow.key_hash),
  callId:     callId,           // UUID del agent_call del step
  agentSlug:  agent.slug,
  amountUsdc: agent.price_per_call,
  timestamp:  Math.floor(Date.now() / 1000),
})
```

**Comportamiento si `signReceipt` falla:**
- Loggear `warn` pero NO abortar el pipeline
- `receipt_signature` = `''` para ese step
- El pago ya ocurrió — no podemos revertirlo

---

## PASO 5 — Tests

### Tests unitarios (Vitest, junto al código)

Crear: `src/app/api/v1/compose/route.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Tests de validateSteps (helper puro, fácil de aislar)
describe('validateSteps', () => {
  it('rechaza array vacío', () => {
    expect(validateSteps([])).toBe('steps must have at least 1 element')
  })

  it('rechaza más de 5 steps', () => {
    const steps = Array(6).fill({ agent_slug: 'a' })
    expect(validateSteps(steps)).toBe('Max 5 steps per pipeline')
  })

  it('rechaza step sin agent_slug', () => {
    expect(validateSteps([{}])).toMatch(/agent_slug is required/)
  })

  it('rechaza input + pass_output juntos', () => {
    const steps = [
      { agent_slug: 'a' },
      { agent_slug: 'b', input: 'foo', pass_output: true },
    ]
    expect(validateSteps(steps)).toMatch(/mutually exclusive/)
  })

  it('rechaza pass_output en step 0', () => {
    expect(validateSteps([{ agent_slug: 'a', pass_output: true }])).toMatch(/Step 0 cannot use pass_output/)
  })

  it('acepta pipeline válido de 3 steps', () => {
    const steps = [
      { agent_slug: 'ocr',        input: 'hello' },
      { agent_slug: 'translator', pass_output: true },
      { agent_slug: 'sentiment',  pass_output: true },
    ]
    expect(validateSteps(steps)).toBeNull()
  })
})

// ── Tests de parseOutputSafe
describe('parseOutputSafe', () => {
  it('parsea JSON válido', () => {
    expect(parseOutputSafe('{"foo":"bar"}')).toEqual({ foo: 'bar' })
  })

  it('devuelve string si no es JSON', () => {
    expect(parseOutputSafe('hello world')).toBe('hello world')
  })

  it('devuelve null para null', () => {
    expect(parseOutputSafe(null)).toBeNull()
  })
})
```

### Tests de integración (Fuji testnet)

Crear: `src/app/api/v1/compose/compose.integration.test.ts`

```typescript
// Tests contra Fuji — requieren agentes mock registrados en la DB

describe('POST /api/v1/compose (Fuji integration)', () => {
  it('AC-1: 401 sin X-Api-Key', async () => {
    const res = await fetch('/api/v1/compose', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('AC-4: 402 con saldo insuficiente', async () => {
    // Usar key con saldo 0.000001 USDC
    // Pipeline de 2 agentes que cuestan 0.01 USDC total
    // Verificar que ningún step se ejecutó
  })

  it('AC-7: 400 con más de 5 steps', async () => {
    const res = await fetch('/api/v1/compose', {
      method: 'POST',
      headers: { 'X-Api-Key': testKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ steps: Array(6).fill({ agent_slug: 'mock-echo' }) }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Max 5 steps/)
  })

  it('AC-8: 429 después de 10 requests en 1 minuto', async () => {
    // Enviar 11 requests seguidos con la misma key
    // El 11vo debe devolver 429
  })

  it('AC-9: SSRF bloqueado → 422 con SSRF_BLOCKED', async () => {
    // Registrar agente mock con endpoint_url = 'http://localhost/evil'
    // Verificar que el endpoint devuelve 422 con reason 'SSRF_BLOCKED'
  })

  it('AC-2 + AC-3 + AC-6: Pipeline de 3 steps con pass_output', async () => {
    // Pipeline de 3 agentes mock (echo que devuelven input + sufijo)
    // Verificar:
    // - result = output del step 2
    // - receipts.length = 3
    // - steps_executed = 3
    // - cada receipt tiene receipt_signature no vacío
    // - en DB: 3 filas con mismo pipeline_id y step_index 0,1,2
    // - saldo de la key disminuyó en sum(prices)
  })

  it('AC-5: Fallo en step 1 de 3 → 422 con steps_executed: 0', async () => {
    // Agente mock que siempre devuelve 500
    // Pipeline: [echo, failing-agent, echo]
    // Verificar: steps_executed=0 (step 0 OK, step 1 falla → 422)
    //   NOTA: step 0 ya cobrado, no hay reembolso
  })
})
```

---

## Acceptance Criteria (verificables uno a uno)

| ID | Criterio | Verificación |
|---|---|---|
| **AC-1** | `POST /api/v1/compose` responde `401` sin `X-Api-Key` o con key inválida | `curl -X POST /api/v1/compose` sin header → `401` |
| **AC-2** | Pipeline de 3 steps con `pass_output: true`: output de step 0 llega a step 1, output de step 1 llega a step 2 | Test de integración con agentes mock echo |
| **AC-3** | Cada step ejecutado genera tx en Fuji; `receipts[]` tiene firma ECDSA válida por step; saldo disminuye en `sum(price_usdc)` | Verificar en DB + on-chain después del pipeline |
| **AC-4** | Con saldo insuficiente → `402` antes de ejecutar cualquier step; saldo no cambia | Usar key con saldo bajo; verificar saldo post-request |
| **AC-5** | Si step N falla → `422` con `steps_executed: N-1`; steps N+1..fin no ejecutados ni cobrados | Test con agente que devuelve 500 en step 1 de 3 |
| **AC-6** | Cada step genera fila en `agent_calls` con `pipeline_id`, `step_index`, `status`, `latency_ms` | `SELECT * FROM agent_calls WHERE pipeline_id = $uuid` |
| **AC-7** | `steps > 5` → `400`; `agent_slug` inexistente → `404`; `pass_output: true` en step 0 → `400` | Tests unitarios de validateSteps |
| **AC-8** | 11 requests seguidos desde la misma key → el 11vo devuelve `429` con `Retry-After` | Test de rate limit (Upstash sliding window 10/1m) |
| **AC-9** | `endpoint_url = 'http://localhost/evil'` → `422` con `reason: 'SSRF_BLOCKED'` | Registrar agente mock con URL interna |
| **AC-10** | Response `200` incluye `pipeline_id`, `steps_executed`, `total_cost_usdc`, `result`, `receipts[]` con schema exacto | Validar JSON response contra TypeScript interface |

---

## Definition of Done

- [ ] **DoD-1** — `supabase/migrations/017_pipeline_compose.sql` aplicada; columnas `pipeline_id` y `step_index` existen en `agent_calls`; índices creados; `/invoke` existente no roto
- [ ] **DoD-2** — `src/app/api/v1/compose/route.ts` creado; `npm run build` pasa con 0 errores TypeScript en strict mode
- [ ] **DoD-3** — `getComposeLimit()` añadido a `src/lib/ratelimit.ts`; prefix `rl:compose`; límite `10/1m`
- [ ] **DoD-4** — Request con `X-Api-Key` inválida o ausente → `401` ✅ (AC-1)
- [ ] **DoD-5** — Pipeline de 3 steps con `pass_output: true` ejecuta en secuencia; `result` = output del step 2 ✅ (AC-2)
- [ ] **DoD-6** — Cada step exitoso genera 1 fila en `agent_calls` con `pipeline_id` y `step_index` correctos; `receipts[]` contiene firma ECDSA válida ✅ (AC-3 + AC-6)
- [ ] **DoD-7** — Con saldo insuficiente → `402` antes de ejecutar cualquier step; saldo no cambia ✅ (AC-4)
- [ ] **DoD-8** — Step 1 de 3 falla → response `422` con `steps_executed: 0`; step 2 no ejecutado; saldo de step 2 no deducido ✅ (AC-5)
- [ ] **DoD-9** — `steps.length > 5` → `400`; slug inexistente → `404`; `pass_output: true` en step 0 → `400` ✅ (AC-7)
- [ ] **DoD-10** — 11 requests seguidos desde la misma key → el 11vo devuelve `429` con `Retry-After` header ✅ (AC-8)
- [ ] **DoD-11** — Step con `endpoint_url = http://localhost/evil` → `422` con `reason: 'SSRF_BLOCKED'` ✅ (AC-9)
- [ ] **DoD-12** — Adversarial Review ejecutado (`review-adversarial-general.xml`); 0 issues BLOQUEANTES; Code Review (`code-review/instructions.xml`) pasa; `git push origin master master:main` exitoso

---

## Notas de Implementación (patrones del codebase)

### Sobre `increment_agent_key_spend` RPC
- Ya existe en Supabase (creado en HAL-011 para `/invoke`)
- Acepta: `p_key_id UUID`, `p_amount NUMERIC`
- Es atómica — usa `UPDATE ... RETURNING` sin race conditions
- Si falla → significa race condition o saldo agotado → abortar pipeline con `422`

### Sobre `signReceipt` y `keyHashToBytes32`
- En `src/lib/receipts/signReceipt.ts` — ya migrado a viem v2 (HAL-010)
- En `src/lib/contracts/marketplaceClient.ts`
- Usar exactamente igual que en `/invoke/route.ts` — no reimplementar

### Sobre `validateEndpointUrl`
- En `src/lib/security/validateEndpointUrl.ts` (HAL-014/022)
- Lanza excepción si la URL es interna, loopback, o no HTTP/S
- Llamar antes del fetch, no dentro del try-catch del fetch

### Sobre el Redis lock
- Usar `@upstash/redis` directamente (ya es dependency del proyecto)
- `nx: true` = "set only if not exists" (exclusión mutua)
- `ex: 30` = expira en 30s (timeout de seguridad si el proceso muere)
- `finally { await redis.del(lockKey) }` = siempre liberar

### Sobre el timeout de Vercel (25s)
- 5 steps × 8s timeout por step = 40s teórico (supera el límite)
- En práctica: agentes rápidos (<3s) completan el pipeline en <15s
- Para el hackathon es aceptable; HU-5.1b introduce async para pipelines largos
- Documentar en README del endpoint: "Max pipeline latency ~20s recomendado"

### Sobre agentes mock para el hackathon
- Si no hay agentes OCR/Translator/Sentiment reales en Fuji, crear endpoints mock internos
- Ejemplo: `POST /api/v1/mock/echo` — devuelve el input tal cual
- Registrarlos en el marketplace con `status: 'active'` y `endpoint_url` apuntando al propio servidor

### Sobre el campo `tx_hash` en `agent_calls`
- Para compose: insertar `null` (no hay tx hash individual por step en este modelo)
- El settlement on-chain ocurre en lote vía cron — igual que en `/invoke`

### Sobre `caller_type`
- Para compose: usar `'agent'` (el caller es un agente o developer usando API key)
- Mismo valor que `/invoke` con API key

---

## Riesgos Conocidos (no bloqueantes)

| Riesgo | Mitigación implementada |
|---|---|
| Timeout 25s de Vercel con 5 agentes lentos | 8s por step + documentación; HU-5.1b para async |
| Race condition en saldo (múltiples pipelines simultáneos) | Redis lock por keyId (sección PASO 2, step [6]) |
| No-reembolso de steps ya ejecutados | Documentado en response 422; política explícita |
| Demo sin agentes reales | Crear agentes mock internos antes del hackathon |

---

## Política de No-Reembolso (documentar en API)

Los steps ya ejecutados exitosamente **no se reembolsan** si un step posterior falla:
1. El agente externo ya procesó y entregó el resultado
2. El saldo ya fue deducido atómicamente (`increment_agent_key_spend`)
3. El cron de settlement puede haber procesado el lote

Esto es intencional y debe estar documentado en la documentación pública de la API.

---

## Stack y Restricciones (Nexus Golden Path)

```
✅ Next.js 14 App Router
✅ Supabase (createServiceClient — server-side)
✅ @upstash/ratelimit con Upstash Redis
✅ viem v2 (signReceipt ya migrado)
✅ TypeScript strict mode

❌ ethers.js — PROHIBIDO
❌ NEXT_PUBLIC_ para secrets — PROHIBIDO
❌ Hardcodes de addresses o amounts — PROHIBIDO
❌ Datos simulados en producción — PROHIBIDO
❌ Ejecución paralela — OUT OF SCOPE (HU-5.2)
❌ Frontend/UI — OUT OF SCOPE (HU-5.4)
❌ Mainnet — OUT OF SCOPE (HU-6.x)
```

---

## Comando de Deploy

```bash
git push origin master master:main
```

---

*Story file generado por San (SM — Scrum Master) | 2026-02-28*
*Gates: HU_APPROVED ✅ | SPEC_APPROVED ✅*
*Siguiente: Dev implementa desde este archivo — sin leer ningún otro documento*
