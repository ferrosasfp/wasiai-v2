# Insert Audit — agent_calls
> Generado por Spec Reviewer — WAS-220 — 2026-03-16

## Paths identificados con insert a agent_calls

| # | Archivo | payment_type | agent_slug | Notas |
|---|---------|-------------|-----------|-------|
| 1 | `src/app/api/v1/models/[slug]/invoke/route.ts` — `logCall()` | ❌ FALTA | ✅ Presente (`agentSlug ?? null`) | `payment_type` NO está en el insert. slug se pasa como parámetro opcional `agentSlug` |
| 2 | `src/app/api/v1/sandbox/invoke/[slug]/route.ts` — insert schema_violation (línea ~9c) | ✅ `'sandbox'` | ❌ FALTA | El insert de schema_violation no incluye `agent_slug` |
| 3 | `src/app/api/v1/sandbox/invoke/[slug]/route.ts` — insert principal (paso 10) | ✅ `'sandbox'` | ❌ FALTA | El insert normal tampoco incluye `agent_slug` |
| 4 | `src/app/api/v1/compose/route.ts` — schema_violation insert | ❌ FALTA | ❌ FALTA | Insert minimal sin payment_type ni agent_slug |
| 5 | `src/app/api/v1/compose/route.ts` — insert normal en `executeStep()` | ❌ FALTA | ❌ FALTA | Ninguno de los dos campos presentes |
| 6 | `src/app/api/v1/agents/[slug]/trial/route.ts` | ❌ FALTA | ❌ FALTA | **FUERA DE SCOPE SDD** — insert solo tiene agent_id, status, latency_ms, is_trial |
| 7 | `src/app/api/v1/mcp/route.ts` | ❌ FALTA | ❌ FALTA | **FUERA DE SCOPE SDD** — insert sin payment_type ni agent_slug |
| 8 | `src/app/api/v1/agents/[slug]/introspect/route.ts` | Desconocido | Desconocido | **FUERA DE SCOPE SDD** — no auditado en detalle, requiere revisión |

## Detalle por path en scope del SDD

### Path 1: models/[slug]/invoke/route.ts — logCall()

```typescript
// Actual (sin payment_type):
supabase.from('agent_calls').insert({
  agent_id:        model.id,
  caller_type:     callerType,
  caller_agent_id: agentId,
  amount_paid:     model.price_per_call,
  tx_hash:         txHash,
  status:          result.status,
  latency_ms:      result.latencyMs,
  key_id:          keyId ?? null,
  agent_slug:      agentSlug ?? null,  // ✅ presente
  nonce:           nonce ?? null,
  // ❌ payment_type: AUSENTE
})
```

**Contexto de llamada:**
- Route A (api_key): `logCall(supabase, model, 'agent', null, null, result, keyRow.id, slug)` — slug ✅
- Route B (x402): `logCall(supabase, model, 'human', null, settlement.transactionHash, result, null, slug, x402Nonce)` — slug ✅

**El slug SIEMPRE está disponible** desde `params` de la ruta. Solo falta `payment_type`.

**Lógica requerida:** `payment_type = keyId ? 'api_key' : 'x402'`

### Path 2 & 3: sandbox/invoke/[slug]/route.ts

```typescript
// Schema violation insert (falta agent_slug):
await supabase.from('agent_calls').insert({
  id:           randomUUID(),
  agent_id:     agent.id,
  caller_id:    user?.id ?? null,
  caller_type:  'human',
  amount_paid:  0,
  is_trial:     true,
  payment_type: 'sandbox',  // ✅
  status:       'error',
  result_type:  'schema_violation',
  called_at:    new Date().toISOString(),
  // ❌ agent_slug: AUSENTE (slug disponible desde params)
})

// Insert principal (falta agent_slug):
await supabase.from('agent_calls').insert({
  id:           callId,
  agent_id:     agent.id,
  caller_id:    user?.id ?? null,
  caller_type:  'human',
  amount_paid:  agent.price_per_call,
  is_trial:     true,
  payment_type: 'sandbox',  // ✅
  status:       'completed',
  result_type:  'success',
  called_at:    new Date().toISOString(),
  // ❌ agent_slug: AUSENTE (slug disponible desde params)
})
```

**El slug está disponible** desde `const { slug } = await params` al inicio del handler.

### Path 4 & 5: compose/route.ts — executeStep()

```typescript
// Schema violation (faltan ambos campos):
await supabase.from('agent_calls').insert({
  agent_id: agent.id, caller_type: 'agent', amount_paid: 0,
  tx_hash: null, status: 'error', result_type: 'schema_violation',
  latency_ms: latencyMs, key_id: safeKeyRow.id, is_trial: false,
  pipeline_id: pipelineId, step_index: stepIndex,
  called_at: new Date().toISOString()
  // ❌ payment_type: AUSENTE
  // ❌ agent_slug: AUSENTE (agent.slug disponible en scope)
})

// Insert normal (faltan ambos campos):
await supabase.from('agent_calls').insert({
  agent_id: agent.id, caller_type: 'agent', amount_paid: agent.price_per_call,
  tx_hash: null, status: stepStatus, result_type: agentCallResultType,
  latency_ms: latencyMs, key_id: safeKeyRow.id, is_trial: false,
  pipeline_id: pipelineId, step_index: stepIndex,
  called_at: new Date().toISOString()
  // ❌ payment_type: AUSENTE
  // ❌ agent_slug: AUSENTE (agent.slug disponible en scope)
})
```

**agent.slug está disponible** dentro de `executeStep()`. payment_type sería siempre `'api_key'` (compone usa api_key).

## Paths adicionales FUERA DE SCOPE (requieren WAS-220 expanded o ticket separado)

| Archivo | Estado |
|---------|--------|
| `trial/route.ts` | Insert sin payment_type, sin agent_slug, sin caller_type |
| `mcp/route.ts` | Insert sin payment_type, sin agent_slug |
| `introspect/route.ts` | No auditado |

## Problema crítico: CHECK constraint en DB

La migración `032_sandbox_credits.sql` tiene:
```sql
ALTER TABLE agent_calls
  ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'x402'
  CHECK (payment_type IN ('x402', 'sandbox'));
```

El SDD propone agregar `'api_key'` y `'free_trial'` como valores válidos. **Estos valores violarán el CHECK constraint actual**. Se requiere una migración para expandir el constraint ANTES de que el builder agregue estos valores.

WAS-219 (el SDD que agrega el constraint NOT NULL) debe también actualizar el CHECK para incluir `'api_key'` y `'free_trial'`.
