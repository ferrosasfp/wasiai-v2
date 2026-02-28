# SDD — HU-5.1: Agent Compose API (Pipeline Secuencial)

> **Artefacto S1 — Architect**
> Épica 5 — Agent-to-Agent Routing
> Fecha: 2026-02-28
> Estado: PENDIENTE SPEC_APPROVED de Fer
> Basado en: hu-compose-draft.md (HU_APPROVED), codebase real sprint 1-2

---

## 1. Archivo a crear

```
src/app/api/v1/compose/route.ts
```

No se modifica ningún archivo existente. Es endpoint nuevo, autónomo.

---

## 2. Decisiones de Arquitectura Tomadas (ADR-014)

Las siguientes preguntas abiertas del S0 quedan resueltas:

| Pregunta | Decisión | Razón |
|---|---|---|
| ¿Orquestador llama directo o vía /invoke? | **Directo al `endpoint_url` del agente** | Evita latencia extra por hop HTTP interno; el logging se hace en compose directamente |
| ¿Deducción de saldo por step o al final? | **Por step, atómicamente antes de cada fetch** | Si el agente externo falla, no cobramos ese step; saldo coherente siempre |
| ¿`pipeline_id` dónde se genera? | **En el endpoint, al inicio del request** | `crypto.randomUUID()` — disponible en Node 18+, sin dependencias |
| ¿`pipeline_id`/`step_index` en columnas o JSONB? | **Columnas propias (migration 017)** | Permite queries `WHERE pipeline_id = $1` sin jsonb operators; índice eficiente |

---

## 3. Schema de Request

### `POST /api/v1/compose`

**Headers requeridos:**
```
X-Api-Key: wai_...       ← API key del consumer (obligatorio)
Content-Type: application/json
```

**Body:**
```typescript
interface ComposeRequest {
  steps: ComposeStep[]   // min: 1, max: 5
}

interface ComposeStep {
  agent_slug:   string   // slug del agente en el marketplace (activo y publicado)
  input?:       string   // input explícito para este step (texto plano o JSON stringificado)
  pass_output?: boolean  // si true, usa el output del step anterior como input
                         // mutuamente excluyente con `input` para steps N>0
                         // en step 0: pass_output=true es error (no hay step anterior)
}
```

**Reglas de validación del body:**
- `steps` ausente o no array → `400`
- `steps.length < 1` → `400`
- `steps.length > 5` → `400` con `{ error: "Max 5 steps per pipeline" }`
- Step sin `agent_slug` → `400`
- Step con `input` + `pass_output: true` simultáneamente → `400`
- Step 0 con `pass_output: true` → `400` (no hay output previo)
- `agent_slug` no existe o no está `active` → `404` con `{ error: "Agent not found", step: N, slug: "..." }`

---

## 4. Schema de Response

### `200 OK` — Pipeline completado

```typescript
interface ComposeResponse {
  pipeline_id:      string        // UUID del pipeline
  steps_executed:   number        // igual a steps.length en success
  total_cost_usdc:  string        // suma exacta con 6 decimales, e.g. "0.011000"
  result:           unknown       // output del último step (JSON parseado o string)
  receipts: StepReceipt[]
}

interface StepReceipt {
  step:             number        // 0-based
  agent_slug:       string
  cost_usdc:        string        // price_per_call del agente, e.g. "0.008000"
  receipt_signature: string       // firma ECDSA del operator (mismo formato que /invoke)
  call_id:          string        // UUID del agent_call en DB (auditoría)
}
```

### `400 Bad Request` — Validación fallida

```json
{ "error": "string", "code": "validation_error", "detail": "string opcional" }
```

### `401 Unauthorized` — Key inválida o ausente

```json
{ "error": "Invalid or inactive API key", "code": "invalid_key" }
```

### `402 Payment Required` — Saldo insuficiente (preflight)

```json
{
  "error": "Insufficient balance",
  "code": "insufficient_balance",
  "required_usdc": "0.011000",
  "available_usdc": "0.005000"
}
```

### `404 Not Found` — Agente no existe

```json
{ "error": "Agent not found", "code": "agent_not_found", "step": 2, "slug": "bad-slug" }
```

### `422 Unprocessable Entity` — Fallo en step intermedio

```typescript
interface PipelineFailedResponse {
  error:            string        // "Pipeline failed at step N"
  code:             "step_failed"
  failed_step:      number        // 0-based, step donde ocurrió el fallo
  reason:           string        // mensaje de error del agente o "SSRF_BLOCKED" | "TIMEOUT" | "UPSTREAM_ERROR"
  steps_executed:   number        // steps 0..N-1 completados exitosamente
  partial_receipts: StepReceipt[] // receipts de los steps exitosos (no se reembolsan)
}
```

### `429 Too Many Requests` — Rate limit

```json
{ "error": "Rate limit exceeded", "code": "rate_limited", "limit": 10, "remaining": 0, "reset_at": "ISO8601" }
```
Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`

### `500 Internal Server Error`

```json
{ "error": "Internal server error" }
```
En development: añade `"detail": "string"`.

---

## 5. Migration 017

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

**Notas:**
- Columnas nullable — no rompe /invoke existente (inserta NULL en ambas)
- RLS: hereda de agent_calls (ya activo desde migration 000)
- No se necesita RPC nueva — el insert en logCall del compose pasa pipeline_id y step_index

---

## 6. Lógica de Orquestación — Pseudocódigo Detallado

```
POST /api/v1/compose

[0] RATE LIMIT
    identifier = `compose:key:${keyHash.slice(0,24)}`
    limit = getComposeLimit()   ← 10 pipelines/min por keyId
    hit = checkRateLimit(limit, identifier)
    if hit → return 429

[1] AUTH
    rawKey = header 'X-Api-Key'
    if !rawKey → return 401
    keyHash = sha256(rawKey)
    keyRow = SELECT id, key_hash, is_active, budget_usdc, spent_usdc
             FROM agent_keys
             WHERE key_hash = $keyHash AND is_active = true
    if !keyRow → return 401

[2] PARSE + VALIDAR BODY
    body = await request.json()
    steps = body.steps
    validar array, min 1, max 5
    validar cada step (agent_slug presente, no input+pass_output juntos, no pass_output en step 0)
    if error → return 400

[3] RESOLVER AGENTES (1 query batch)
    slugs = steps.map(s => s.agent_slug)
    agents = SELECT id, slug, name, price_per_call, endpoint_url, status
             FROM agents
             WHERE slug = ANY($slugs) AND status = 'active'
    
    -- Verificar que TODOS los slugs del pipeline existen y están activos
    -- Respetar el orden original (un agente puede repetirse en el pipeline)
    agentMap = Map<slug, agentRow>
    for (i, step) in enumerate(steps):
      if !agentMap.has(step.agent_slug) → return 404 { step: i, slug: step.agent_slug }

[4] PREFLIGHT DE SALDO
    totalRequired = sum(agents[step.agent_slug].price_per_call for step in steps)
    available = keyRow.budget_usdc - keyRow.spent_usdc
    if available < totalRequired →
      return 402 {
        required_usdc: totalRequired.toFixed(6),
        available_usdc: available.toFixed(6)
      }
    -- NOTA: El preflight usa el saldo en DB (no on-chain).
    -- El saldo on-chain (keyBalances) es la fuente de verdad para el cron de settlement.
    -- El saldo en DB (spent_usdc) es la fuente de verdad para el preflight.
    -- Riesgo de race condition mitigado: Redis lock por keyId (ver sección 9)

[5] SSRF PREFLIGHT (todos los endpoints antes de ejecutar)
    for (i, step) in enumerate(steps):
      agent = agentMap[step.agent_slug]
      try:
        validateEndpointUrl(agent.endpoint_url)
      catch err:
        return 422 { failed_step: i, reason: 'SSRF_BLOCKED', steps_executed: 0, partial_receipts: [] }

[6] GENERAR pipeline_id
    pipelineId = crypto.randomUUID()
    receipts = []
    lastOutput = null
    stepsFailed = false

[7] LOOP SECUENCIAL (hasta 5 steps)
    for (stepIndex, step) in enumerate(steps):
      agent = agentMap[step.agent_slug]
      
      [7a] CONSTRUIR INPUT
           if stepIndex === 0:
             input = step.input ?? ''
           else if step.pass_output:
             input = lastOutput   ← string del output del step anterior
           else:
             input = step.input ?? ''
      
      [7b] DEDUCIR SALDO ATÓMICAMENTE (antes del fetch)
           result = await supabase.rpc('increment_agent_key_spend', {
             p_key_id: keyRow.id,
             p_amount: agent.price_per_call
           })
           -- Este RPC es el mismo que usa /invoke (ya probado y atómico)
           -- Si falla (ej. saldo insuficiente por race condition) → return 422
      
      [7c] LLAMAR AL AGENTE EXTERNO
           startMs = Date.now()
           try:
             response = fetch(agent.endpoint_url, {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ input }),
               signal: AbortSignal.timeout(8_000)  ← 8s por step (5 steps × 8s = 40s teórico, Vercel 25s total)
             })
             -- NOTA: el timeout por step es 8s pero el pipeline completo debe caber en 25s.
             -- Para pipelines de 5 steps, la latencia máxima real por step es ~4s.
             -- Esto es aceptable en hackathon context; HU-5.1b introduce async.
             latencyMs = Date.now() - startMs
             
             if response.ok:
               stepOutput = await response.json()  ← o response.text() si no es JSON
               stepStatus = 'success'
             else:
               stepOutput = { error: `Upstream ${response.status}` }
               stepStatus = 'error'
           catch err:
             latencyMs = Date.now() - startMs
             stepOutput = { error: 'Upstream unreachable', detail: String(err) }
             stepStatus = 'error'
      
      [7d] LOGGING DEL STEP
           callRecord = await supabase.from('agent_calls').insert({
             agent_id:    agent.id,
             caller_type: 'agent',
             amount_paid: agent.price_per_call,
             tx_hash:     null,            ← compose no tiene tx_hash individual por step
             status:      stepStatus,
             latency_ms:  latencyMs,
             key_id:      keyRow.id,
             agent_slug:  agent.slug,
             is_trial:    false,
             pipeline_id: pipelineId,      ← nuevo campo (migration 017)
             step_index:  stepIndex,        ← nuevo campo (migration 017)
           }).select('id').single()
           callId = callRecord.data.id
      
      [7e] FIRMAR RECEIPT DEL STEP
           receiptTimestamp = Math.floor(Date.now() / 1000)
           signature = await signReceipt({
             keyId:      keyHashToBytes32(keyRow.key_hash),
             callId:     callId,
             agentSlug:  agent.slug,
             amountUsdc: agent.price_per_call,
             timestamp:  receiptTimestamp,
           })
           -- best-effort: si signReceipt falla, loggear warn pero NO abortar el pipeline
           
           -- Guardar signature en DB (best-effort)
           supabase.from('agent_calls')
             .update({ receipt_signature: signature })
             .eq('id', callId)   ← fire-and-forget
      
      [7f] EVALUAR RESULTADO DEL STEP
           if stepStatus === 'error':
             return 422 {
               error: `Pipeline failed at step ${stepIndex}`,
               code: 'step_failed',
               failed_step: stepIndex,
               reason: stepOutput.error ?? 'Unknown upstream error',
               steps_executed: stepIndex,   ← steps 0..stepIndex-1 fueron exitosos
               partial_receipts: receipts   ← lo que se firmó hasta ahora
             }
           
           -- Step exitoso: acumular
           lastOutput = typeof stepOutput === 'string'
             ? stepOutput
             : JSON.stringify(stepOutput)
           
           receipts.push({
             step:              stepIndex,
             agent_slug:        agent.slug,
             cost_usdc:         agent.price_per_call.toFixed(6),
             receipt_signature: signature ?? '',
             call_id:           callId,
           })
      
      [7g] INCREMENTAR STATS DEL AGENTE
           supabase.rpc('increment_agent_stats', {
             p_agent_id: agent.id,
             p_amount:   agent.price_per_call,
           })   ← fire-and-forget, no bloquea

[8] RESPONSE FINAL
    totalCost = receipts.reduce((acc, r) => acc + parseFloat(r.cost_usdc), 0)
    return 200 {
      pipeline_id:     pipelineId,
      steps_executed:  steps.length,
      total_cost_usdc: totalCost.toFixed(6),
      result:          parseOutputSafe(lastOutput),  ← intenta JSON.parse, si falla devuelve string
      receipts:        receipts,
    }
```

---

## 7. Manejo de Fallo en Step Intermedio

**Principio:** "Fail fast, no reembolso de steps ya ejecutados."

| Escenario | Comportamiento |
|---|---|
| Agente externo responde 4xx/5xx | `stepStatus = 'error'` → pipeline se detiene → `422` |
| Agente externo no responde (timeout 8s) | `AbortSignal.timeout(8000)` lanza → capturado → `422` |
| `validateEndpointUrl` falla (SSRF) | SSRF preflight en paso [5] antes del loop → `422` con `steps_executed: 0` |
| `signReceipt` falla | Warning + receipt vacío — pipeline **NO** se aborta (el pago ya ocurrió) |
| `increment_agent_key_spend` falla en step N | Race condition detectada → `422` — steps N+1..fin no se cobran |
| `logCall` falla | Warning — pipeline **NO** se aborta (mejor cobrar sin log que romper la ejecución) |

**Política de no-reembolso:** documentada en la response `422` y en la documentación de la API. Los steps ya completados no se reembolsan porque:
1. El agente externo ya procesó y entregó el resultado
2. El saldo ya fue deducido atómicamente
3. El cron de settlement ya puede haber procesado el lote

---

## 8. Rate Limiting

**Nuevo limiter:** `getComposeLimit()`

```typescript
// src/lib/ratelimit.ts — añadir:
let _compose: Ratelimit | null = null
export function getComposeLimit() {
  return _compose ??= new Ratelimit({
    redis:   makeRedis(),
    limiter: Ratelimit.slidingWindow(10, '1 m'),
    prefix:  'rl:compose',
  })
}
```

**Identifier:**
```typescript
// Compose siempre tiene X-Api-Key (autenticación requerida)
// Usamos el inicio del keyHash (no el raw key por seguridad)
const identifier = `key:${keyHash.slice(0, 24)}`
```

**Justificación del límite (10/min):**
- Un pipeline de 5 steps puede ser costoso computacionalmente
- Los agentes externos tienen sus propios rate limits
- 10/min = suficiente para demos y uso real de hackathon
- Se puede elevar en HU-5.x sin cambio de arquitectura

---

## 9. Race Condition en Saldo — Mitigación

**Problema:** Dos requests de compose simultáneos desde la misma key pasan el preflight con saldo suficiente, pero juntos superan el saldo disponible.

**Solución adoptada:** Redis Lock por keyId

```typescript
// Antes del loop de steps, adquirir lock de 30s en Redis
const lockKey = `compose:lock:${keyRow.id}`
const redis = getRedisClient()
const acquired = await redis.set(lockKey, '1', { nx: true, ex: 30 })
if (!acquired) {
  return NextResponse.json(
    { error: 'Concurrent pipeline in progress for this key', code: 'key_locked' },
    { status: 409 }
  )
}
try {
  // ... todo el loop de steps ...
} finally {
  await redis.del(lockKey)
}
```

**Justificación:**
- El mismo Redis de Upstash ya está en el proyecto (ratelimit.ts)
- Lock de 30s cubre el caso de timeout total de Vercel (25s)
- `nx: true` garantiza exclusión mutua
- `finally` garantiza liberación incluso si el pipeline falla

---

## 10. Receipts Firmados por Step

Cada step reutiliza exactamente el mismo `signReceipt` de `/invoke`:

```typescript
import { signReceipt } from '@/lib/receipts/signReceipt'
import { keyHashToBytes32 } from '@/lib/contracts/marketplaceClient'

const signature = await signReceipt({
  keyId:      keyHashToBytes32(keyRow.key_hash),
  callId:     callId,           // UUID del agent_call del step
  agentSlug:  agent.slug,
  amountUsdc: agent.price_per_call,
  timestamp:  Math.floor(Date.now() / 1000),
})
```

El consumer puede verificar cada receipt con `verifyReceipt()` del mismo lib.
Esto garantiza auditoría criptográfica step a step — no solo del pipeline completo.

---

## 11. Estructura Final del Archivo

```typescript
// src/app/api/v1/compose/route.ts

import { NextRequest, NextResponse }           from 'next/server'
import { createHash }                           from 'crypto'
import { createServiceClient }                  from '@/lib/supabase/server'
import { validateEndpointUrl }                  from '@/lib/security/validateEndpointUrl'
import { getComposeLimit, getIdentifier, checkRateLimit } from '@/lib/ratelimit'
import { signReceipt }                          from '@/lib/receipts/signReceipt'
import { keyHashToBytes32 }                     from '@/lib/contracts/marketplaceClient'
import { logger }                               from '@/lib/logger'
// NO: ethers.js / permissionless / NEXT_PUBLIC_ secrets

// ── Constants
const MAX_STEPS    = 5
const STEP_TIMEOUT = 8_000   // ms por step

// ── Types (interfaces ComposeRequest, ComposeStep, ComposeResponse, etc.)
// ── Helpers (validateSteps, resolveAgents, buildStepInput, callStepAgent, logStep, signStep)
// ── export async function POST(request: NextRequest)
```

El archivo se mantiene en ~250 líneas divididas en helpers < 50 líneas cada uno, mismo patrón que invoke.

---

## 12. Implementation Readiness Check

| Check | Estado | Detalle |
|---|---|---|
| ¿Endpoint path claro sin ambigüedad? | ✅ | `src/app/api/v1/compose/route.ts` |
| ¿Request schema completo y tipado? | ✅ | Sección 3 con TypeScript interfaces |
| ¿Response schema para todos los casos (200/400/401/402/404/422/429/500)? | ✅ | Sección 4 |
| ¿Migration lista para implementar? | ✅ | Migration 017 completa en sección 5 |
| ¿Lógica de orquestación sin ambigüedades? | ✅ | Pseudocódigo paso a paso sección 6 |
| ¿Fallo de step intermedio definido con precisión? | ✅ | Sección 7, tabla de escenarios |
| ¿Rate limiting especificado (limiter, prefix, identifier, límite)? | ✅ | Sección 8 |
| ¿Race condition mitigada? | ✅ | Redis lock sección 9 |
| ¿Receipts firmados por step con mismo mecanismo que /invoke? | ✅ | Sección 10 |
| ¿Sin ethers.js? | ✅ | Solo viem v2 (signReceipt ya migrado HAL-010) |
| ¿Sin hardcodes de addresses? | ✅ | Todas las addresses de env vars (heredado de invoke) |
| ¿Sin NEXT_PUBLIC_ para secrets? | ✅ | OPERATOR_PRIVATE_KEY es server-only |
| ¿Migration numerada correctamente? | ✅ | 017 (próxima disponible según project-context) |
| ¿Push command correcto? | ✅ | `git push origin master master:main` |
| ¿Dependencias disponibles? | ✅ | /invoke completo, keyBalances operativo, validateEndpointUrl listo |
| ¿ACs verificables sin ambigüedad? | ✅ | AC-1 a AC-10 del S0 cubiertos 1:1 |
| ¿Cabe en timeout de Vercel (25s)? | ⚠️ | 5 steps × 8s teórico = 40s. En práctica: agentes rápidos (<3s cada uno) caben. Documentar límite. HU-5.1b para async. |
| ¿Agentes demo disponibles para hackathon? | ⚠️ | Riesgo identificado en S0 — crear agentes mock internos si no hay reales |

**Veredicto:** ✅ IMPLEMENTABLE — los dos ⚠️ son riesgos conocidos con mitigación documentada, no bloqueantes.

---

## 13. Definition of Done (12 ítems)

- [ ] **DoD-1** — `supabase/migrations/017_pipeline_compose.sql` aplicada en dev; columnas `pipeline_id` y `step_index` existen en `agent_calls`; índices creados; no rompe /invoke
- [ ] **DoD-2** — `src/app/api/v1/compose/route.ts` creado; `npm run build` pasa con 0 errores TypeScript en strict mode
- [ ] **DoD-3** — `getComposeLimit()` añadido a `src/lib/ratelimit.ts` con prefix `rl:compose` y límite `10/1m`
- [ ] **DoD-4** — Request con `X-Api-Key` inválida o ausente devuelve `401` (AC-1 verificado)
- [ ] **DoD-5** — Pipeline de 3 steps con `pass_output: true` ejecuta en secuencia; `result` = output del step 2 (AC-2 verificado con agentes mock)
- [ ] **DoD-6** — Cada step exitoso genera 1 fila en `agent_calls` con `pipeline_id` y `step_index` correctos; `receipts[]` en response contiene firma ECDSA válida por step (AC-3 + AC-6 verificados)
- [ ] **DoD-7** — Con saldo insuficiente, responde `402` antes de ejecutar cualquier step; saldo no cambia (AC-4 verificado)
- [ ] **DoD-8** — Step 2 de 3 falla → response `422` con `steps_executed: 1`, step 3 no ejecutado, saldo de step 3 no deducido (AC-5 verificado)
- [ ] **DoD-9** — `steps.length > 5` → `400`; step con `agent_slug` inexistente → `404`; `pass_output: true` en step 0 → `400` (AC-7 verificado)
- [ ] **DoD-10** — 11 requests seguidos desde la misma key → el 11vo devuelve `429` con `Retry-After` header (AC-8 verificado)
- [ ] **DoD-11** — Step cuyo `endpoint_url` es `http://localhost/evil` falla con `SSRF_BLOCKED`; pipeline responde `422` (AC-9 verificado)
- [ ] **DoD-12** — Adversarial Review ejecutado (`review-adversarial-general.xml`); 0 issues BLOQUEANTES; Code Review (`code-review/instructions.xml`) pasa; `git push origin master master:main` exitoso

---

## 14. Archivos que se crean/modifican

| Acción | Archivo | Notas |
|---|---|---|
| CREAR | `src/app/api/v1/compose/route.ts` | Endpoint principal |
| CREAR | `supabase/migrations/017_pipeline_compose.sql` | Columnas pipeline_id + step_index |
| MODIFICAR | `src/lib/ratelimit.ts` | Añadir `getComposeLimit()` (lazy singleton, mismo patrón) |

**Sin cambios en:**
- `/invoke/route.ts` — no se toca
- Contratos Solidity — no hay cambio on-chain
- Frontend — fuera de scope HU-5.1
- Otras migrations — solo 017

---

*Artefacto generado por San (S1 — Architect) | 2026-02-28*
*Siguiente gate: SPEC_APPROVED de Fer → SM genera story-HU-5.1.md*
