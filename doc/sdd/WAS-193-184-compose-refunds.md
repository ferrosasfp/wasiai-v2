# SDD — WAS-193 + WAS-184: Compose API Refunds

**Sprint:** 1 | **Clasificación:** QUALITY | **Fecha:** 2026-03-13

---

## Context Map

| Archivo | Rol |
|---|---|
| `src/app/api/v1/compose/route.ts` | Handler principal — MODIFICAR |
| `supabase/migrations/017_pipeline_executions.sql` | `deduct_key_balance` existente |
| `supabase/migrations/045_refund_key_balance.sql` | Nueva función refund — CREAR |

**Exemplar de refund existente:** `migrations/032_sandbox_credits.sql` → `refund_sandbox_balance()`

---

## Acceptance Criteria (EARS)

- AC-1: WHEN POST /api/v1/compose con steps[], THEN ejecutar pipeline max 5 steps
- AC-2: WHEN steps[] > 5, THEN HTTP 422 `max_steps_exceeded`
- AC-3: WHEN balance insuficiente para costo total estimado, THEN HTTP 402 antes de ejecutar ningún step
- AC-4: WHEN step falla por AbortError (timeout), THEN NO cobrar → refund_key_balance() sync
- AC-5: WHEN step falla por ECONNREFUSED/ENOTFOUND, THEN NO cobrar → refund sync
- AC-6: WHEN step falla por HTTP 503/504/429, THEN NO cobrar → refund sync
- AC-7: WHEN step falla por HTTP 500 sin body o body no-JSON, THEN NO cobrar → refund sync
- AC-8: WHEN step falla por HTTP 500 con body JSON, THEN SÍ cobrar (agente ejecutó)
- AC-9: WHEN step retorna HTTP 200, THEN SÍ cobrar
- AC-10: WHEN step falla por HTTP 402 (agente rechaza pago), THEN NO cobrar → refund sync, registrar reason='payment_rejected'
- AC-11: WHEN refund falla por DB error, THEN loguear severity=ERROR, incluir `refund_failures[]` en response
- AC-12: WHEN todos los steps fallan, THEN HTTP 200 con status='all_failed', refunds aplicados
- AC-13: WHEN pipeline completa, THEN response incluye pipeline_id, receipts[], total_cost_usdc, steps_executed

---

## Wave 0 — Pre-flight (Builder ejecuta antes de tocar código)

- [ ] Leer `compose/route.ts` completo — confirmar que `deduct_key_balance` se llama en `executeStep()` antes del fetch
- [ ] Confirmar que NO existe `refund_key_balance` en ninguna migration
- [ ] Confirmar que `refund_sandbox_balance` en migration 032 es el patrón a seguir
- [ ] Confirmar estructura de `agent_calls`: campos `status`, `pipeline_id`, `step_index`

---

## Wave 1 — Migration: `refund_key_balance` RPC

**Archivo:** `supabase/migrations/045_refund_key_balance.sql`

```sql
-- Migration 045: refund_key_balance RPC
-- Revierte un deduct_key_balance decrementando spent_usdc
-- Patrón: simétrico a deduct_key_balance en migration 017

CREATE OR REPLACE FUNCTION refund_key_balance(p_key_id UUID, p_amount NUMERIC)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rows_updated INT;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'p_amount must be positive, got %', p_amount;
  END IF;

  UPDATE agent_keys
    SET spent_usdc = GREATEST(0, spent_usdc - p_amount)
  WHERE id = p_key_id
    AND is_active = true;

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION refund_key_balance(UUID, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refund_key_balance(UUID, NUMERIC) TO service_role;
```

**Build gate:** `cd /home/ferdev/.openclaw/workspace/wasiai-v2 && npx supabase db lint 2>&1 | tail -5 || echo "lint-skipped"`

---

## Wave 2 — Clasificador de errores en `compose/route.ts`

**Archivo:** `src/app/api/v1/compose/route.ts`

Agregar helper después de las constantes (línea ~22):

```ts
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
```

**Build gate:** `npx tsc --noEmit 2>&1 | grep -v ".next" | tail -5`

---

## Wave 3 — Refund en `executeStep()` en `compose/route.ts`

### 3a — Actualizar tipo de retorno de `executeStep`

```ts
// Reemplazar la interface de retorno existente (buscar: status: 'success' | 'error')
interface StepResult {
  receipt:        StepReceipt | null
  output:         string | null
  status:         'success' | 'error'
  reason:         string
  chargeDecision: 'charge' | 'refund'
  refundFailure:  string | null   // "step_N" si el refund falló, null si OK
}
```

### 3b — Refactorizar try/catch en `executeStep` (hoist de variables)

El try/catch actual declara `res` dentro del try. Para que `getChargeDecision` pueda acceder a ambos casos (error de red Y respuesta HTTP errónea), se debe hoist:

```ts
// Antes del try — declarar variables en scope superior:
let res: Response | undefined
let caughtErr: unknown = null
let hasJsonBody = false
let stepOutput: unknown
let stepStatus: 'success' | 'error' = 'success'
let stepErrorReason = ''

try {
  res = await fetch(agent.endpoint_url, {
    method:   'POST',
    headers:  { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Pipeline-Id': pipelineId, 'X-Pipeline-Step': String(stepIndex) },
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

// --- Ahora res, caughtErr y hasJsonBody están en scope ---

const chargeDecision = getChargeDecision(caughtErr, res?.status ?? null, hasJsonBody)
```

### 3c — Agregar refund después del try/catch

```ts
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

if (stepStatus === 'error') {
  return { receipt: null, output: null, status: 'error', reason: stepErrorReason, chargeDecision, refundFailure }
}
```

### 3d — Propagar `refund_failures` al pipeline response

En el loop principal, acumular los refund failures y agregarlos al response:

```ts
// Declarar antes del loop:
const refundFailures: string[] = []

// En cada lugar donde se procesa un result de error:
if (result.refundFailure) refundFailures.push(result.refundFailure)

// En ComposeResponse (agregar campo opcional):
interface ComposeResponse {
  pipeline_id:      string
  steps_executed:   number
  groups_executed:  number
  total_cost_usdc:  string
  result:           unknown
  receipts:         StepReceipt[]
  refund_failures?: string[]   // presente solo si hay fallos de refund (AC-11)
}

// En el return final:
return NextResponse.json({
  ...existingFields,
  ...(refundFailures.length > 0 && { refund_failures: refundFailures }),
} satisfies ComposeResponse, { status: 200 })
```

**Build gate:** `npx tsc --noEmit 2>&1 | grep -v ".next" | tail -5`

---

## Wave 4 — AC-12: todos los steps fallan → status='all_failed'

Cuando todos los steps de un pipeline fallan, el código actual retorna HTTP 422. AC-12 requiere HTTP 200 con `status='all_failed'` y todos los refunds aplicados.

Agregar campo `status` a `PipelineFailedResponse`:

```ts
interface PipelineFailedResponse {
  error:            string
  code:             'step_failed' | 'all_failed'
  failed_step:      number
  reason:           string
  steps_executed:   number
  partial_receipts: StepReceipt[]
  refund_failures?: string[]
  status?:          'all_failed'  // campo nuevo para AC-12
}
```

En el loop secuencial, detectar si es el primer step (steps_executed === 0) y todos han fallado:

```ts
// Al detectar fallo de step secuencial:
const allFailed = globalStepIndex === 0  // primer step falló → ninguno ejecutó

if (allFailed) {
  // AC-12: todos los steps fallan → HTTP 200 con status all_failed
  return NextResponse.json({
    error: 'All pipeline steps failed',
    code:  'all_failed' as const,
    status: 'all_failed',
    failed_step:      globalStepIndex,
    reason:           result.reason,
    steps_executed:   0,
    partial_receipts: receipts,
    ...(refundFailures.length > 0 && { refund_failures: refundFailures }),
  } satisfies PipelineFailedResponse, { status: 200 })  // ← HTTP 200 per AC-12
} else {
  // Pipeline parcial → HTTP 422 como antes
  return NextResponse.json({ ... } satisfies PipelineFailedResponse, { status: 422 })
}
```

**Build gate:** `npx tsc --noEmit 2>&1 | grep -v ".next" | tail -5`

---

## Wave 5 — Preflight de balance total y HTTP 402 handling

En el bloque `[4] PREFLIGHT DE SALDO` (ya existe), agregar handling de HTTP 402 en `executeStep`:

```ts
// En executeStep(), dentro del try/catch del fetch:
if (res.status === 402) {
  stepStatus      = 'error'
  stepErrorReason = 'payment_rejected'
  // chargeDecision = 'refund' → getChargeDecision() ya maneja esto
}
```

El preflight de balance total ya existe en el código (sección `[4]`). Verificar que la comparación usa `totalRequired` correcto. No modificar si ya funciona.

**Build gate:** `npx tsc --noEmit 2>&1 | grep -v ".next" | tail -5`

---

## Wave 6 — Commit

```bash
git add supabase/migrations/045_refund_key_balance.sql src/app/api/v1/compose/route.ts
git commit -m "feat(WAS-193/184): compose refund logic — charge/refund classifier + refund_key_balance RPC"
git push origin main
```

---

## Rollback

```bash
git revert HEAD
# Eliminar migration si ya fue aplicada:
# supabase migration repair --status reverted 045
```

---

## Critical Constraints

- ❌ NO modificar `deduct_key_balance` — solo agregar `refund_key_balance`
- ❌ NO cambiar el orden deduct-antes-del-fetch (el timing actual es intencional)
- ❌ NO tocar lógica de steps paralelos más allá del chargeDecision
- ✅ `refund_key_balance` usa `GREATEST(0, spent_usdc - p_amount)` para evitar negativos
- ✅ Refund es siempre sync (mismo request) — no async
- ✅ Si refund falla → loguear + incluir en `refund_failures[]`, NO abortar el pipeline response
