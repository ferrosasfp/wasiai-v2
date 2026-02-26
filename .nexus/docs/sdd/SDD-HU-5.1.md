# SDD-HU-5.1 — Agent-to-Agent Routing (POST /api/v1/compose)

**HU:** HU-5.1  
**Épica:** E5 — Compose API  
**Estado:** S1 — Software Design Document  
**Generado:** 2026-02-26  
**Autor:** PM Agent (BMAD v6)  
**Aprobaciones requeridas:** SPEC_APPROVED explícito de Fer antes de pasar a SM

---

## 1. Decisiones de arquitectura (PO-confirmed)

| Decisión | Valor |
|----------|-------|
| Modo de ejecución | **SÍNCRONO** — timeout total 25s (Vercel Pro requerido) |
| Pasos del pipeline | 2–10, secuenciales estrictos |
| Timeout por paso | `COMPOSE_STEP_TIMEOUT_MS` env var (default: 8 000 ms) |
| Propagación | `output → input` automático con literal `"$prev"` |
| Pago | x402 (deducción de `keyBalance`) por cada paso exitoso |
| Receipt final | ECDSA firmado por operator wallet (viem v2) |
| Tabla nueva | `pipeline_executions` — migration 017 |
| Cliente DB | `createServiceClient()` — nunca `createClient()` |
| Firma ECDSA | viem v2 — cero ethers.js |
| Secrets | Cero variables `NEXT_PUBLIC_` |
| SSRF | `validateUrl()` obligatorio antes de cada fetch externo |
| Rate limiting | Upstash Redis — prefix `wasiai:compose`, 10 req/min por key |

---

## 2. Archivo a crear

```
src/app/api/v1/compose/route.ts
```

**Único archivo nuevo de lógica.** Funciones auxiliares reutilizan:
- `@/lib/supabase/service` → `createServiceClient()`
- `@/lib/viem` → `getOperatorClient()`
- `@/lib/ssrf` → `validateUrl()`
- `@/lib/upstash` → `ratelimit` (nueva instancia `composeRatelimit`)

---

## 3. Variables de entorno requeridas

| Variable | Descripción | Default |
|----------|-------------|---------|
| `COMPOSE_STEP_TIMEOUT_MS` | Timeout por step individual (ms) | `8000` |
| `COMPOSE_MAX_STEP_OUTPUT_BYTES` | Límite de bytes de output por step | `102400` (100KB) |
| `OPERATOR_PRIVATE_KEY` | Ya existe — key de firma ECDSA | — |

> Ninguna nueva variable con prefijo `NEXT_PUBLIC_`.

---

## 4. Migration SQL — 017

Archivo: `supabase/migrations/017_pipeline_executions.sql`

```sql
-- ============================================================
-- Migration 017: pipeline_executions + pipeline_id en agent_calls
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
CREATE INDEX IF NOT EXISTS idx_pipeline_executions_key_id ON pipeline_executions(key_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_executions_created_at ON pipeline_executions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_calls_pipeline_id ON agent_calls(pipeline_id) WHERE pipeline_id IS NOT NULL;

-- RLS: solo service role puede insertar/actualizar (endpoint usa createServiceClient)
ALTER TABLE pipeline_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON pipeline_executions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Lectura por el owner de la key (para futuros dashboards)
CREATE POLICY "key_owner_read" ON pipeline_executions
  FOR SELECT
  USING (
    key_id IN (
      SELECT id FROM api_keys WHERE user_id = auth.uid()
    )
  );
```

---

## 5. Schemas de Request / Response

### 5.1 Request

```
POST /api/v1/compose
X-API-Key: <api_key>
Content-Type: application/json
```

```json
{
  "steps": [
    {
      "agent_id": "550e8400-e29b-41d4-a716-446655440000",
      "input": "Resume este contrato legal: ..."
    },
    {
      "agent_id": "550e8400-e29b-41d4-a716-446655440001",
      "input": "$prev"
    },
    {
      "agent_id": "550e8400-e29b-41d4-a716-446655440002",
      "input": {
        "text": "$prev",
        "format": "json"
      }
    }
  ]
}
```

**Reglas del payload:**
- `steps`: array, 2–10 elementos. Requerido.
- `steps[].agent_id`: UUID v4 válido. Requerido.
- `steps[].input`: `string | object`. Requerido.
- `"$prev"` en `input` (string exacto) o en cualquier valor de string dentro de un objeto: se sustituye por el output del step anterior como string.
- Campos extra en el body o en cada step: ignorados silenciosamente.

### 5.2 Response exitosa (200 OK)

```json
{
  "pipeline_id": "7f3e9c2a-1b4d-4e8f-a6c0-2d5b9f0e3a1c",
  "steps_completed": 3,
  "steps_total": 3,
  "status": "success",
  "result": "<output del último paso como string>",
  "steps": [
    {
      "step": 1,
      "agent_id": "550e8400-e29b-41d4-a716-446655440000",
      "input": "Resume este contrato legal: ...",
      "output": "El contrato establece...",
      "latency_ms": 1240,
      "cost_usdc": "0.050000"
    },
    {
      "step": 2,
      "agent_id": "550e8400-e29b-41d4-a716-446655440001",
      "input": "El contrato establece...",
      "output": "Puntos clave: 1. ...",
      "latency_ms": 980,
      "cost_usdc": "0.030000"
    },
    {
      "step": 3,
      "agent_id": "550e8400-e29b-41d4-a716-446655440002",
      "input": "{\"text\":\"Puntos clave: 1. ...\",\"format\":\"json\"}",
      "output": "{\"summary\": [...]}",
      "latency_ms": 1510,
      "cost_usdc": "0.040000"
    }
  ],
  "total_cost_usdc": "0.120000",
  "receipt_signature": "0xabc123...def456"
}
```

### 5.3 Response de error parcial (502 Bad Gateway)

```json
{
  "pipeline_id": "7f3e9c2a-1b4d-4e8f-a6c0-2d5b9f0e3a1c",
  "status": "partial",
  "failed_at_step": 2,
  "steps_completed": 1,
  "steps_total": 3,
  "error": "Agent 550e8400-e29b-41d4-a716-446655440001 returned 500",
  "result_so_far": "El contrato establece...",
  "steps": [
    {
      "step": 1,
      "agent_id": "550e8400-e29b-41d4-a716-446655440000",
      "output": "El contrato establece...",
      "latency_ms": 1240,
      "cost_usdc": "0.050000"
    }
  ],
  "total_cost_usdc": "0.050000"
}
```

### 5.4 Códigos de error estándar

| HTTP | Condición | Body ejemplo |
|------|-----------|-------------|
| 400 | JSON malformado o steps fuera de rango | `{ "error": "steps must be an array of 2–10 elements" }` |
| 401 | X-API-Key ausente o inválida | `{ "error": "Unauthorized" }` |
| 402 | Saldo insuficiente (pre-flight) | `{ "error": "Insufficient balance", "required": "0.12", "available": "0.05", "currency": "USDC" }` |
| 402 | Saldo insuficiente (mid-pipeline) | Ver 5.3 con `status: "partial"` |
| 403 | Key inactiva | `{ "error": "API key is inactive" }` |
| 413 | Output de un step supera `COMPOSE_MAX_STEP_OUTPUT_BYTES` | `{ "error": "Step 2 output exceeds size limit (100KB)" }` |
| 422 | Agentes inválidos o inactivos | `{ "error": "Invalid agents", "invalid_agents": ["<uuid1>", "<uuid2>"] }` |
| 429 | Rate limit excedido | `{ "error": "Rate limit exceeded. Try again in 60 seconds." }` |
| 504 | Timeout en un step | `{ "pipeline_id": "...", "status": "partial", "error": "Step 2 timed out after 8000ms", ... }` |

---

## 6. Flujo interno paso a paso

```
POST /api/v1/compose
         │
         ▼
[1] PARSE & VALIDATE INPUT
    ├── Parsear JSON body
    ├── Verificar steps.length ∈ [2,10]
    └── Verificar cada step tiene agent_id (UUID) e input (string|object)
         → Error: 400 si falla
         │
         ▼
[2] AUTH: VALIDAR API KEY
    ├── Leer header X-API-Key
    ├── createServiceClient()
    ├── SELECT * FROM api_keys WHERE key_hash = hash(X-API-Key) LIMIT 1
    ├── No encontrada → 401
    └── key.status !== 'active' → 403
         │
         ▼
[3] RATE LIMIT (Upstash)
    ├── composeRatelimit.limit(`wasiai:compose:${keyId}`)
    └── !success → 429
         │
         ▼
[4] PRE-FLIGHT: VALIDAR AGENTES
    ├── SELECT id, status, price_per_call, endpoint_url
        FROM agents WHERE id = ANY(agentIds)
    ├── Verificar todos los agentIds existen → 422 con invalid_agents[]
    └── Verificar todos tienen status = 'active' → 422 con invalid_agents[]
         │
         ▼
[5] PRE-FLIGHT: VERIFICAR SALDO
    ├── Calcular estimated_cost = SUM(agent.price_per_call) de todos los steps
    ├── SELECT balance FROM api_keys WHERE id = keyId
    └── balance < estimated_cost → 402 con { required, available, currency: "USDC" }
         │
         ▼
[6] CREAR REGISTRO pipeline_executions (status: 'failed' provisional)
    ├── INSERT INTO pipeline_executions {id, key_id, steps_requested, status: 'failed', ...}
    └── pipeline_id = id generado
         │
         ▼
[7] BUCLE DE EJECUCIÓN SECUENCIAL (step 1..N)
    │
    ├── Para cada step i:
    │   ├── [7a] Resolver input:
    │   │       Si input === "$prev" → usar prevOutput (string)
    │   │       Si input es objeto con valores "$prev" → sustituir cada valor
    │   │       Step 1 no puede tener "$prev" (sin prev)
    │   │
    │   ├── [7b] Leer precio actual del agente desde DB
    │   │       (re-leer, no cachear del pre-flight — ADR de consistencia)
    │   │
    │   ├── [7c] SSRF protection
    │   │       validateUrl(agent.endpoint_url)
    │   │       → Si falla: abort pipeline, 502
    │   │
    │   ├── [7d] Fetch al agente externo
    │   │       AbortController con COMPOSE_STEP_TIMEOUT_MS
    │   │       POST agent.endpoint_url
    │   │       Headers: { "Content-Type": "application/json", "X-Pipeline-Id": pipelineId }
    │   │       Body: { "input": resolvedInput }
    │   │       NO propagar headers de respuesta del agente al caller
    │   │       → Timeout → 504 con resultado parcial
    │   │       → 4xx/5xx → 502 con resultado parcial
    │   │
    │   ├── [7e] Extraer output
    │   │       Si response.body tiene campo "response" → usar ese campo
    │   │       Si no → usar body completo como string
    │   │       Verificar tamaño ≤ COMPOSE_MAX_STEP_OUTPUT_BYTES → 413 si excede
    │   │       Guardar como prevOutput
    │   │
    │   ├── [7f] DESCUENTO ATÓMICO DE SALDO
    │   │       UPDATE api_keys
    │   │         SET balance = balance - price_per_call
    │   │       WHERE id = keyId AND balance >= price_per_call
    │   │       → 0 rows updated → saldo insuficiente → 402 con resultado parcial
    │   │
    │   ├── [7g] Registrar agent_call
    │   │       INSERT INTO agent_calls {
    │   │         agent_id, key_id, pipeline_id,
    │   │         status: 'success', latency_ms, cost_usdc,
    │   │         is_trial: false
    │   │       }
    │   │
    │   └── Guardar step result en stepResults[]
    │
    ▼
[8] FIRMA ECDSA DEL RECEIPT
    ├── payload = keccak256(pipelineId + keyId + totalCostUsdc + timestamp)
    ├── getOperatorClient() — viem v2 (no ethers.js)
    └── receiptSignature = await operatorClient.signMessage({ message: { raw: payload } })
         │
         ▼
[9] ACTUALIZAR pipeline_executions
    ├── UPDATE SET status='success', steps_completed=N,
        total_cost_usdc, receipt_signature, completed_at=NOW()
    └── WHERE id = pipelineId
         │
         ▼
[10] RESPONDER 200 OK
     Body según schema 5.2
```

---

## 7. Manejo de errores parciales (mid-pipeline)

Cuando el pipeline aborta en el step `k` (con `k > 1`):

1. **NO se cobra** el step `k` (falló antes de completar).
2. **Sí se cobran** los steps `1..k-1` (trabajo real realizado, balances ya decrementados atómicamente en [7f]).
3. Se actualiza `pipeline_executions` con `status='partial'`, `steps_completed=k-1`, `failed_at_step=k`, `error_detail`.
4. Se responde con el schema de error parcial (sección 5.3).
5. Los `agent_calls` de los steps completados ya están en DB con `pipeline_id` vinculado.

---

## 8. SSRF Protection

Implementación en `@/lib/ssrf.ts` — función `validateUrl(url: string): Promise<boolean>`:

```typescript
// Reglas obligatorias (deny list):
const BLOCKED_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./,    // link-local
  /^::1$/,          // IPv6 loopback
  /^fc00:/,         // IPv6 ULA
  /^localhost$/i,
];

// Protocolo: solo https (no http, no file, no ftp)
// Resolución DNS: resolver la URL y verificar la IP resultante contra BLOCKED_RANGES
// Puerto: solo 443 y 80 permitidos (o sin puerto explícito)
```

Si `validateUrl` retorna `false`, el pipeline aborta con error parcial antes de intentar el fetch.

---

## 9. Rate Limiting Config

Crear instancia específica en `@/lib/upstash.ts` (o archivo separado `@/lib/upstash-compose.ts`):

```typescript
import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"

export const composeRatelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "60 s"),
  prefix: "wasiai:compose",
  analytics: false,  // no tracking adicional
})
```

**Identifier:** `keyId` (no IP — el rate limit es por API key).

---

## 10. Firma ECDSA del Receipt

```typescript
import { getOperatorClient } from '@/lib/viem'
import { keccak256, encodePacked } from 'viem'

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
    message: { raw: messageHash }
  })
  
  return signature  // hex string: "0x..."
}
```

> `OPERATOR_PRIVATE_KEY` ya existe en env. No se hardcodea ninguna address.

---

## 11. Logging estructurado

Cada step debe loguear (no `console.log` suelto — usar estructura JSON):

```typescript
console.log(JSON.stringify({
  event: 'pipeline_step',
  pipeline_id: pipelineId,
  step: stepIndex,
  agent_id: agentId,
  latency_ms: latencyMs,
  status: 'success' | 'error' | 'timeout',
  cost_usdc: costUsdc,
}))
```

Eventos adicionales:
- `pipeline_start` — al recibir el request (con key_id, steps_count)
- `pipeline_complete` — al terminar (con total_cost, status)
- `pipeline_abort` — al abortar (con failed_at_step, reason)

---

## 12. Estructura del archivo route.ts

```typescript
// src/app/api/v1/compose/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getOperatorClient } from '@/lib/viem'
import { validateUrl } from '@/lib/ssrf'
import { composeRatelimit } from '@/lib/upstash-compose'
import { keccak256, encodePacked } from 'viem'
import { randomUUID } from 'crypto'

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

// ─── Handler principal ────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  // [1] Parse & Validate
  // [2] Auth
  // [3] Rate limit
  // [4] Pre-flight: agentes
  // [5] Pre-flight: saldo
  // [6] Crear pipeline_execution provisional
  // [7] Loop de ejecución
  // [8] Firma ECDSA
  // [9] Update pipeline_execution
  // [10] Response
}

// ─── Helpers ──────────────────────────────────────────────────────
function resolvePrev(input: unknown, prevOutput: string): string { ... }
function extractOutput(body: unknown): string { ... }
async function signReceipt(...): Promise<string> { ... }
function structuredLog(event: string, data: Record<string, unknown>): void { ... }
```

---

## 13. Diagrama de estados del pipeline

```
CREATED → PRE_FLIGHT → RUNNING → SUCCESS
                    ↘          ↘
                   FAILED    PARTIAL (aborta mid-step)
```

Mapeado a `pipeline_executions.status`:
- `'success'` → todos los steps completaron OK
- `'partial'` → ≥1 step completó, pipeline abortó en step posterior
- `'failed'` → falló en pre-flight o en step 1 (0 steps completados)

---

## 14. DoD verificable (Definition of Done)

Cada ítem es una verificación explícita, no subjetiva.

### Código
- [ ] Archivo `src/app/api/v1/compose/route.ts` existe
- [ ] Sin `ethers` imports en ningún archivo nuevo
- [ ] Sin variables `NEXT_PUBLIC_` para secrets
- [ ] Sin valores hardcodeados (UUIDs, addresses, precios)
- [ ] `createServiceClient()` — sin `createClient()` ni `createServerClient()`
- [ ] `validateUrl()` llamado antes de cada fetch externo
- [ ] `AbortController` con timeout en cada fetch de agente
- [ ] Headers de respuesta de agente externo NO propagados al caller
- [ ] Output de paso validado contra `COMPOSE_MAX_STEP_OUTPUT_BYTES`
- [ ] Descuento atómico via `UPDATE ... WHERE balance >= price_per_call` con verificación de rows updated

### Migration
- [ ] `supabase/migrations/017_pipeline_executions.sql` existe y es idempotente (`IF NOT EXISTS`)
- [ ] Tabla `pipeline_executions` tiene RLS activo
- [ ] `agent_calls` tiene columna `pipeline_id` nullable con FK
- [ ] Índices creados en `key_id`, `created_at`, `pipeline_id`

### Tests (manual con curl o Postman)
- [ ] `POST /api/v1/compose` sin key → 401
- [ ] Key inactiva → 403
- [ ] Steps < 2 o > 10 → 400
- [ ] `agent_id` inexistente → 422 con `invalid_agents`
- [ ] Saldo insuficiente → 402 con `required/available/currency`
- [ ] Pipeline de 2 steps exitoso → 200 con `receipt_signature` no nulo
- [ ] `"$prev"` en step 2 resuelto correctamente
- [ ] Agente externo retorna 500 → 502 con `steps_completed: 1` y cobro parcial
- [ ] Timeout de step → 504 con resultado parcial
- [ ] 11+ requests/min desde misma key → 429

### Observabilidad
- [ ] Cada pipeline tiene `pipeline_id` UUID v4 en logs y en DB
- [ ] Logs estructurados JSON (no `console.log` con strings)
- [ ] `pipeline_executions` registra `status`, `steps_completed`, `total_cost_usdc`

### Seguridad
- [ ] URL con IP privada (10.x.x.x, 192.168.x.x, 127.0.0.1) → SSRF bloqueada, 400/502
- [ ] URL con protocolo `file://` o `http://` → bloqueada
- [ ] Rate limit testeado: 10 req/min por key, sliding window

---

## 15. Preguntas abiertas resueltas (por el PO)

| Pregunta | Decisión |
|----------|----------|
| ¿Sync o async? | **SÍNCRONO** — timeout 25s. Requiere Vercel Pro. |
| ¿`$prev` solo string o path notation? | Solo string literal `"$prev"` en esta HU. Path notation es E5.2. |
| ¿Pipeline visible en dashboard creator? | Fuera de scope HU-5.1. Revenue de pipelines vs directos: E5.5. |
| ¿Límite 10 steps? | Confirmado. Vinculado al timeout de 25s (avg 2.5s/step). |
| ¿`pipeline_id` en `agent_calls`? | **SÍ** — columna nullable en migration 017. |

---

## 16. Riesgos residuales y mitigaciones

| Riesgo | Mitigación en esta HU |
|--------|----------------------|
| R1 — Agente lento | `AbortController` con `COMPOSE_STEP_TIMEOUT_MS` (default 8s) |
| R2 — Output grande | `COMPOSE_MAX_STEP_OUTPUT_BYTES` (default 100KB) → 413 |
| R3 — Race condition en balance | UPDATE atómico con `WHERE balance >= price` + verificar rowCount |
| R6 — SSRF | `validateUrl()` con deny list de IPs privadas + solo HTTPS |
| R8 — Vercel timeout 30s | Pipeline timeout = 25s < 30s. Verifica con Vercel plan Pro. |

---

## 17. Dependencias bloqueantes

| Depende de | Estado requerido |
|------------|-----------------|
| `api_keys` tabla con columna `balance` | ✅ Existe (Sprint 1 HU-1.1) |
| `agents` tabla con `endpoint_url`, `price_per_call`, `status` | ✅ Existe (Sprint 1 HU-1.2) |
| `agent_calls` tabla con `pipeline_id` (nullable) | ⚠️ Requiere migration 017 |
| `pipeline_executions` tabla | ⚠️ Requiere migration 017 |
| `@/lib/viem` con `getOperatorClient()` | ✅ Existe |
| `@/lib/ssrf` con `validateUrl()` | ✅ Existe (mencionado en project-context) |
| `@/lib/supabase/service` con `createServiceClient()` | ✅ Existe |
| Vercel Pro (timeout 60s) | ⚠️ Verificar plan antes de activar en prod |

---

*SDD generado por PM Agent (BMAD v6) — 2026-02-26*  
*Siguiente paso: Implementation Readiness Check → SPEC_APPROVED de Fer → SM crea story-HU-5.1.md*
