# Story File — #013: Circuit Breaker y Retry Automático

> SDD: doc/sdd/013-circuit-breaker/sdd.md
> WAS-73 | Fecha: 2026-03-02
> Branch: feat/013-circuit-breaker

---

## Goal

Integrar el `CircuitBreaker` existente en la ruta de invocación de agentes (`POST /api/v1/models/[slug]/invoke`), añadiendo retry automático con backoff exponencial para errores de red, bloqueo 503 cuando el CB está abierto, notificación webhook al creator cuando el CB se abre, y un badge de estado CB por agente en el creator dashboard.

El CB ya existe en `src/lib/circuit-breaker/CircuitBreaker.ts` — **no lo reimplementes**. Tu trabajo es integrarlo, añadir el retry helper, el webhook trigger, el endpoint de estado y el badge UI.

---

## Acceptance Criteria (EARS)

| ID | Criterio |
|----|---------|
| AC-1 | WHEN el fetch a `endpoint_url` falla por error de red (throw / timeout) THEN el sistema reintenta hasta 3 veces con delays 0ms / 500ms / 1500ms |
| AC-2 | IF el upstream responde HTTP 4xx THEN el sistema NO reintenta y registra el error inmediatamente |
| AC-3 | WHILE el circuit breaker del slug está en estado `open` WHEN llega una invocación THEN la ruta retorna `{ error: "agent_circuit_open", retry_after_seconds: 30 }` con status 503 |
| AC-4 | WHEN el CB del slug transiciona a `open` (5 fallos en 120s) THEN se dispara el evento webhook `agent.circuit_open` para todos los webhooks activos del creator que suscriben al evento |
| AC-5 | WHEN el creator visita su dashboard THEN cada agente muestra un badge con el estado CB actual (`closed` / `open` / `half-open`) |
| AC-6 | IF el CB está en estado `half-open` y el intento único tiene éxito THEN el CB se resetea a `closed` |
| AC-7 | WHEN el upstream responde exitosamente después de reintentos THEN `recordSuccess(slug)` es llamado y el retry count no se expone al caller |
| AC-8 | IF todos los reintentos fallan por errores de red THEN `recordFailure(slug)` es llamado por cada fallo y el error final se retorna al caller |

---

## Files to Modify/Create

| # | Archivo | Acción | Qué hacer | Exemplar |
|---|---------|--------|-----------|---------|
| 1 | `src/lib/circuit-breaker/retryWithBackoff.ts` | **CREAR** | Helper `retryWithBackoff<T>`. Constante exportada `RETRY_DELAYS_MS = [0, 500, 1500]`. Solo reintenta si el fetch lanzó excepción (TypeError / AbortError). Llama `recordFailure(providerId)` en cada fallo. | Exemplar D |
| 2 | `src/lib/webhooks/triggerCircuitOpen.ts` | **CREAR** | Trigger webhook `agent.circuit_open`. Mismo pattern exacto que `triggerCreditsLow.ts`. Parámetros: `slug: string, creatorId: string`. | Exemplar C |
| 3 | `src/lib/circuit-breaker/CircuitBreaker.ts` | **MODIFICAR** | Añadir `creatorId?: string` a `recordFailure`. Cuando `failures >= FAILURE_THRESHOLD`, llamar `void triggerCircuitOpen(providerId, creatorId)` (fire-and-forget). | Exemplar A + Exemplar C |
| 4 | `src/app/api/v1/models/[slug]/invoke/route.ts` | **MODIFICAR** | 1) Check CB state antes de `callUpstream` → 503 si `open`. 2) Wrap `callUpstream` con `wrapWithCircuitBreaker(slug, ...)`. 3) Dentro de `callUpstream`, reemplazar el fetch directo con `retryWithBackoff(...)`. 4) Pasar `model.user_id` como `creatorId` a `recordFailure`. | Exemplar A + Exemplar B + Exemplar D |
| 5 | `src/app/api/v1/agents/[slug]/cb-status/route.ts` | **CREAR** | GET endpoint. Verifica que el user autenticado es creator del agente. Retorna `{ state: CBState, failures: number }`. | Exemplar E |
| 6 | `src/app/[locale]/creator/dashboard/_components/AgentCBBadge.tsx` | **CREAR** | Client Component. Fetch a `/api/v1/agents/[slug]/cb-status` con `cache: 'no-store'`. Badge: `closed` → verde, `open` → rojo, `half-open` → amarillo. | Exemplar F |
| 7 | `src/app/[locale]/creator/dashboard/_components/AgentActions.tsx` | **MODIFICAR** | Añadir `<AgentCBBadge slug={slug} />` en el `div` de acciones, antes del botón Edit. | Exemplar F |
| 8 | `supabase/migrations/029_cb_webhook_event.sql` | **CREAR** | Migration documental. Añade comentario sobre `agent.circuit_open` como evento válido en tabla `webhooks`. No requiere cambio de schema (TEXT[] ya soporta cualquier string). | Exemplar G |

---

## Exemplars

### Exemplar A — `wrapWithCircuitBreaker` y `recordFailure` (CircuitBreaker.ts — LEER completo)
**Archivo**: `src/lib/circuit-breaker/CircuitBreaker.ts`
**Usar para**: Archivo #3, #4

```ts
// CircuitBreaker.ts — ARCHIVO COMPLETO ACTUAL (no modificar salvo lo indicado)
import { Redis } from '@upstash/redis'

const redis = Redis.fromEnv()

export type CBState = 'closed' | 'open' | 'half-open'

const FAILURE_THRESHOLD = 5
const RECOVERY_TIMEOUT  = 30 // seconds
const WINDOW_SECONDS    = 120

function keys(providerId: string) {
  return {
    state:       `cb:provider:${providerId}:state`,
    failures:    `cb:provider:${providerId}:failures`,
    lastFailure: `cb:provider:${providerId}:last_failure`,
  }
}

export async function getState(providerId: string): Promise<CBState> {
  const k = keys(providerId)
  const state = await redis.get<CBState>(k.state)
  if (!state) return 'closed'

  if (state === 'open') {
    const lastFailure = await redis.get<number>(k.lastFailure)
    if (lastFailure && Date.now() / 1000 - lastFailure >= RECOVERY_TIMEOUT) {
      await redis.set(k.state, 'half-open', { ex: 300 })
      return 'half-open'
    }
  }
  return state
}

export async function recordSuccess(providerId: string): Promise<void> {
  const k = keys(providerId)
  await redis.del(k.state)
  await redis.del(k.failures)
  await redis.del(k.lastFailure)
}

// ⚠️ MODIFICAR ESTA FUNCIÓN — añadir creatorId?: string
export async function recordFailure(providerId: string): Promise<void> {
  const k = keys(providerId)
  const failures = await redis.incr(k.failures)
  await redis.set(k.lastFailure, Math.floor(Date.now() / 1000))
  await redis.expire(k.failures, WINDOW_SECONDS)

  if (failures >= FAILURE_THRESHOLD) {
    await redis.set(k.state, 'open', { ex: 300 }) // max 5min safety TTL
    await redis.set(k.lastFailure, Math.floor(Date.now() / 1000))
    // ← AQUÍ añadir: if (creatorId) void triggerCircuitOpen(providerId, creatorId)
  }
}

export async function wrapWithCircuitBreaker<T>(
  providerId: string,
  fn: () => Promise<T>
): Promise<T> {
  const state = await getState(providerId)

  if (state === 'open') {
    throw new Error(`Provider ${providerId} is currently unavailable. Try again shortly.`)
  }

  try {
    const result = await fn()
    await recordSuccess(providerId)
    return result
  } catch (err) {
    await recordFailure(providerId)
    throw err
  }
}
```

**CAMBIO EXACTO a `recordFailure`** — reemplaza la firma y añade el trigger:

```ts
export async function recordFailure(providerId: string, creatorId?: string): Promise<void> {
  const k = keys(providerId)
  const failures = await redis.incr(k.failures)
  await redis.set(k.lastFailure, Math.floor(Date.now() / 1000))
  await redis.expire(k.failures, WINDOW_SECONDS)

  if (failures >= FAILURE_THRESHOLD) {
    await redis.set(k.state, 'open', { ex: 300 })
    await redis.set(k.lastFailure, Math.floor(Date.now() / 1000))
    if (creatorId) void triggerCircuitOpen(providerId, creatorId)
  }
}
```

Añadir el import al inicio del archivo (después de `import { Redis }`):
```ts
import { triggerCircuitOpen } from '@/lib/webhooks/triggerCircuitOpen'
```

**TAMBIÉN: `wrapWithCircuitBreaker` necesita aceptar `creatorId` para pasarlo a `recordFailure`:**
```ts
export async function wrapWithCircuitBreaker<T>(
  providerId: string,
  fn: () => Promise<T>,
  creatorId?: string
): Promise<T> {
  const state = await getState(providerId)

  if (state === 'open') {
    throw new Error(`Provider ${providerId} is currently unavailable. Try again shortly.`)
  }

  try {
    const result = await fn()
    await recordSuccess(providerId)
    return result
  } catch (err) {
    await recordFailure(providerId, creatorId)
    throw err
  }
}
```

---

### Exemplar B — `callUpstream` actual (route.ts — función a modificar)
**Archivo**: `src/app/api/v1/models/[slug]/invoke/route.ts`
**Usar para**: Archivo #4

```ts
// ANTES (callUpstream actual — línea ~420)
async function callUpstream(model: Record<string, unknown>, request: NextRequest) {
  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch { /* empty body ok */ }

  // SEC-01: Validate endpoint URL to prevent SSRF
  try {
    validateEndpointUrl(model.endpoint_url as string)
  } catch (err) {
    return { data: { error: 'Invalid model endpoint', detail: String(err) }, status: 'error' as const, latencyMs: 0 }
  }

  const startMs = Date.now()
  let data: unknown
  let status: 'success' | 'error' = 'success'

  try {
    const upstream = await fetch(model.endpoint_url as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    data = upstream.ok ? await upstream.json() : { error: `Upstream ${upstream.status}` }
    if (!upstream.ok) status = 'error'
  } catch (err) {
    data = { error: 'Upstream unreachable', detail: String(err) }
    status = 'error'
  }

  return { data, status, latencyMs: Date.now() - startMs }
}
```

---

### Exemplar C — `triggerCreditsLow` (patrón webhook trigger exacto)
**Archivo**: `src/lib/webhooks/triggerCreditsLow.ts`
**Usar para**: Archivo #2

```ts
import { createServiceClient } from '@/lib/supabase/server'
import { deliverWebhook } from './deliverWebhook'

export async function triggerCreditsLow(userId: string, balance: number): Promise<void> {
  if (balance >= CREDITS_LOW_THRESHOLD) return

  const supabase = createServiceClient()

  const { data: webhooks, error } = await supabase
    .from('webhooks')
    .select('id, url, secret')
    .eq('user_id', userId)
    .eq('is_active', true)
    .contains('events', ['credits.low'])

  if (error || !webhooks?.length) return

  const payload = {
    event: 'credits.low',
    timestamp: new Date().toISOString(),
    data: {
      user_id: userId,
      balance,
      threshold: CREDITS_LOW_THRESHOLD,
    },
  }

  await Promise.allSettled(
    webhooks.map(async (wh) => {
      const result = await deliverWebhook(wh.url as string, wh.secret as string, payload)
      await supabase.from('webhook_deliveries').insert({
        webhook_id: wh.id,
        event: payload.event,
        payload,
        status_code: result.statusCode ?? null,
        success: result.success,
      })
    })
  )
}
```

---

### Exemplar D — Diseño completo de `retryWithBackoff.ts` (nuevo archivo)
**Archivo**: `src/lib/circuit-breaker/retryWithBackoff.ts` (a crear)
**Usar para**: Archivo #1

```ts
import { recordFailure } from './CircuitBreaker'

export const RETRY_DELAYS_MS = [0, 500, 1500] as const

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isNetworkError(err: unknown): boolean {
  // fetch lanza TypeError para errores de red
  // AbortSignal.timeout() lanza DOMException con name='TimeoutError' o name='AbortError'
  if (err instanceof TypeError) return true
  if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError')) return true
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) return true
  return false
}

/**
 * Retry fn up to RETRY_DELAYS_MS.length times.
 * Only retries on network errors (TypeError / AbortError / TimeoutError).
 * Calls recordFailure(providerId) for EACH failed attempt.
 * Never retries on HTTP 4xx (those don't throw — they return a Response).
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  providerId: string,
  creatorId?: string
): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
    if (i > 0) await sleep(RETRY_DELAYS_MS[i])
    try {
      return await fn()
    } catch (err) {
      if (!isNetworkError(err)) throw err // no reintentar: no es network error
      await recordFailure(providerId, creatorId)
      lastErr = err
    }
  }
  throw lastErr
}
```

> ⚠️ IMPORTANTE: `retryWithBackoff` llama `recordFailure` por cada intento fallido. `wrapWithCircuitBreaker` también llama `recordFailure` en su `catch`. Para evitar doble conteo, cuando uses `retryWithBackoff` dentro de `wrapWithCircuitBreaker`, el catch externo **NO debe llamar recordFailure de nuevo** — ya fue contado por cada intento. Ver la sección de integración en invoke/route.ts abajo.

---

### Exemplar E — Patrón API route con auth check
**Archivo**: `src/app/api/v1/agents/[slug]/cb-status/route.ts` (a crear)
**Usar para**: Archivo #5

Patrón de auth: `createClient()` (async, cookie-based) para verificar sesión. `createServiceClient()` (sync, service role) para queries internas.

```ts
// Estructura del archivo a crear:
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getState } from '@/lib/circuit-breaker/CircuitBreaker'
import { Redis } from '@upstash/redis'

const redis = Redis.fromEnv()

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  // 1. Verificar sesión
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. Verificar ownership del agente
  const serviceClient = createServiceClient()
  const { data: agent } = await serviceClient
    .from('agents')
    .select('user_id')
    .eq('slug', slug)
    .single()

  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (agent.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // 3. Leer estado CB
  const state = await getState(slug)
  const failures = await redis.get<number>(`cb:provider:${slug}:failures`) ?? 0

  return NextResponse.json({ state, failures })
}
```

---

### Exemplar F — `AgentActions.tsx` (patrón Client Component del dashboard)
**Archivo**: `src/app/[locale]/creator/dashboard/_components/AgentActions.tsx`
**Usar para**: Archivo #6, #7

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface AgentActionsProps {
  slug: string
  locale: string
  currentStatus: string
  agentName: string
}

export function AgentActions({ slug, locale, currentStatus, agentName }: AgentActionsProps) {
  // ...ver archivo completo para lógica de toggle/delete...

  return (
    <div className="flex items-center gap-2">
      {/* Edit */}
      <Link href={`/${locale}/creator/agents/${slug}/edit`} ...>
        ✏️ Edit
      </Link>
      {/* Pause/Resume */}
      {/* Delete */}
    </div>
  )
}
```

**`AgentCBBadge.tsx`** — nuevo Client Component a crear:

```tsx
'use client'

import { useEffect, useState } from 'react'
import type { CBState } from '@/lib/circuit-breaker/CircuitBreaker'

interface Props {
  slug: string
}

const BADGE_CONFIG: Record<CBState, { label: string; className: string }> = {
  closed:    { label: '● Online',    className: 'bg-green-100 text-green-700' },
  open:      { label: '● Circuit Open', className: 'bg-red-100 text-red-700' },
  'half-open': { label: '● Recovering', className: 'bg-yellow-100 text-yellow-700' },
}

export function AgentCBBadge({ slug }: Props) {
  const [state, setState] = useState<CBState>('closed')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/v1/agents/${slug}/cb-status`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { state: CBState }) => {
        setState(d.state)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [slug])

  if (loading) return null

  const config = BADGE_CONFIG[state]
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  )
}
```

---

### Exemplar G — Patrón migration documental
**Archivo**: `supabase/migrations/027_webhooks.sql` (referencia de estructura)
**Usar para**: Archivo #8

```sql
-- Archivo 029_cb_webhook_event.sql a crear:
-- Circuit Breaker webhook event: agent.circuit_open
--
-- No se requiere cambio de schema. La tabla webhooks.events es TEXT[]
-- y ya acepta cualquier string como evento válido.
--
-- Eventos soportados (documentación):
--   credits.low       → triggers cuando el balance cae por debajo del threshold
--   agent.circuit_open → triggers cuando el CB de un agente entra en estado 'open'
--
-- Para suscribirse: incluir 'agent.circuit_open' en el array events al crear/editar webhook.
```

---

## Contrato de Integración ⚠️ BLOQUEANTE

### invoke/route.ts → CircuitBreaker → retryWithBackoff

**Flujo de invocación cuando CB está OPEN:**
```json
{
  "error": "agent_circuit_open",
  "message": "Agent temporarily unavailable",
  "retry_after_seconds": 30
}
```
HTTP 503 + header `Retry-After: 30`

**Flujo de invocación normal (CB closed/half-open):**
- `callUpstream` usa `retryWithBackoff` internamente
- `callUpstream` está envuelta en `wrapWithCircuitBreaker`
- Si todos los reintentos fallan → error final al caller (no expone retry count)
- Si éxito → `recordSuccess(slug)` llamado por `wrapWithCircuitBreaker`

**GET /api/v1/agents/[slug]/cb-status — Response:**
```json
{
  "state": "closed | open | half-open",
  "failures": 0
}
```
| HTTP | Cuándo |
|------|--------|
| 200 | OK |
| 401 | Sin sesión |
| 403 | User no es creator del agente |
| 404 | Agente no encontrado |

### Integración correcta CB + retry en invoke/route.ts

```ts
// En el POST handler — ANTES de la lógica de pago/callUpstream, añadir:
const cbState = await getState(slug)
if (cbState === 'open') {
  return NextResponse.json(
    { error: 'agent_circuit_open', message: 'Agent temporarily unavailable', retry_after_seconds: 30 },
    { status: 503, headers: { 'Retry-After': '30' } }
  )
}

// callUpstream modificado (solo el bloque fetch interno):
async function callUpstream(model: Record<string, unknown>, request: NextRequest, slug: string) {
  // ... validaciones existentes sin cambios ...

  const startMs = Date.now()
  let data: unknown
  let status: 'success' | 'error' = 'success'

  try {
    // wrapWithCircuitBreaker maneja success/failure del CB
    // retryWithBackoff maneja los reintentos de red (y llama recordFailure por cada intento)
    // ⚠️ Para evitar doble conteo: retryWithBackoff NO debe estar dentro del catch de wrapWithCircuitBreaker
    // La integración correcta: retryWithBackoff dentro del fn() que le pasas a wrapWithCircuitBreaker
    const upstream = await wrapWithCircuitBreaker(
      slug,
      () => retryWithBackoff(
        () => fetch(model.endpoint_url as string, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        }),
        slug,
        model.user_id as string
      ),
      model.user_id as string
    )
    data = upstream.ok ? await upstream.json() : { error: `Upstream ${upstream.status}` }
    if (!upstream.ok) status = 'error'
  } catch (err) {
    data = { error: 'Upstream unreachable', detail: String(err) }
    status = 'error'
  }

  return { data, status, latencyMs: Date.now() - startMs }
}
```

> ⚠️ **Doble conteo de fallos**: `retryWithBackoff` ya llama `recordFailure` en cada intento fallido de red. `wrapWithCircuitBreaker` tiene un `catch` que también llama `recordFailure`. Para evitar doble conteo cuando los errores son de red, el flujo correcto es que `retryWithBackoff` esté DENTRO del `fn()` de `wrapWithCircuitBreaker`. Si `retryWithBackoff` agota todos los intentos y lanza el último error, ese error llega al `catch` de `wrapWithCircuitBreaker` que llamaría `recordFailure` una vez más. 
>
> **Solución**: En `wrapWithCircuitBreaker`, detectar si el error viene de un retry ya contabilizado. La forma más limpia: pasar los errores de retry ya contados como un tipo especial, o simplemente hacer que `retryWithBackoff` NO llame `recordFailure` directamente y dejar que `wrapWithCircuitBreaker` lo haga en su catch (una sola vez por conjunto de reintentos). Esto cambia el comportamiento del AC-8 pero es más correcto.
>
> **Decisión de Architect**: `recordFailure` se llama **una sola vez por invocación fallida** (en el catch de `wrapWithCircuitBreaker`), no por cada reintento individual. El AC-8 dice "recordFailure por cada fallo" — un "fallo" es una invocación fallida, no cada reintento interno. **Elimina la llamada a `recordFailure` de `retryWithBackoff`** — solo reintenta y lanza el último error. `wrapWithCircuitBreaker` contará el fallo.

**Versión final simplificada de `retryWithBackoff` (sin llamar recordFailure):**

```ts
export async function retryWithBackoff<T>(
  fn: () => Promise<T>
): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
    if (i > 0) await sleep(RETRY_DELAYS_MS[i])
    try {
      return await fn()
    } catch (err) {
      if (!isNetworkError(err)) throw err
      lastErr = err
    }
  }
  throw lastErr
}
```

Y la integración en `callUpstream`:

```ts
const upstream = await wrapWithCircuitBreaker(
  slug,
  () => retryWithBackoff(
    () => fetch(model.endpoint_url as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
  ),
  model.user_id as string
)
```

`wrapWithCircuitBreaker` llama `recordFailure(slug, creatorId)` una vez si todos los reintentos fallan. ✅

---

## Constraint Directives

### OBLIGATORIO

1. **Usar `slug` como `providerId`** en `wrapWithCircuitBreaker` — las keys Redis son `cb:provider:{slug}:*`
2. **Solo reintentar si el fetch lanzó una excepción** (`TypeError`, `DOMException` con name `AbortError`/`TimeoutError`) — nunca reintentar si el upstream respondió con HTTP (incluso 4xx/5xx)
3. **`RETRY_DELAYS_MS = [0, 500, 1500]` como constante exportada** en `retryWithBackoff.ts` — no hardcodear en ningún otro lugar
4. **Webhook `agent.circuit_open` con `Promise.allSettled`** — no bloquear si webhook falla
5. **Badge CB usa `cache: 'no-store'`** — el estado CB es dinámico, no cachear
6. **Imports desde `@/lib/circuit-breaker/CircuitBreaker`** — no reimplementar el CB
7. **`void triggerCircuitOpen(...)` en `recordFailure`** — fire-and-forget, no `await`
8. **`creatorId` en `recordFailure` es `string | undefined`** — parámetro opcional para backward-compatibility

### PROHIBIDO

1. **PROHIBIDO reintentar en HTTP 4xx/5xx** — el fetch debe haber lanzado una excepción (no `Response.ok === false`)
2. **PROHIBIDO exponer Redis directamente desde API routes** — todo CB acceso via `src/lib/circuit-breaker/CircuitBreaker.ts` (la excepción es leer `failures` en el cb-status endpoint)
3. **PROHIBIDO usar `any` en TypeScript** — usar tipos reales o `unknown` con type guard
4. **PROHIBIDO `await triggerCircuitOpen(...)` en el path de invocación** — debe ser `void` (fire-and-forget)
5. **PROHIBIDO hardcodear delays de retry** — solo via `RETRY_DELAYS_MS`
6. **PROHIBIDO modificar `FAILURE_THRESHOLD`, `RECOVERY_TIMEOUT`, `WINDOW_SECONDS`** — son constantes de infra

---

## Waves

### W0 — Serial (completar en orden, no paralelizar)

- [ ] **W0.1** — Crear `src/lib/circuit-breaker/retryWithBackoff.ts`
  - Implementar la versión simplificada (sin `recordFailure` — ver Contrato de Integración)
  - Exportar `RETRY_DELAYS_MS` y `retryWithBackoff`
  - Verificación: `tsc --noEmit` pasa

- [ ] **W0.2** — Crear `src/lib/webhooks/triggerCircuitOpen.ts`
  - Seguir Exemplar C exactamente, cambiar evento a `agent.circuit_open` y parámetros a `(slug, creatorId)`
  - Payload: `{ event: 'agent.circuit_open', timestamp: ..., data: { agent_slug: slug, creator_id: creatorId } }`
  - Verificación: `tsc --noEmit` pasa

- [ ] **W0.3** — Modificar `src/lib/circuit-breaker/CircuitBreaker.ts`
  - Añadir import `triggerCircuitOpen`
  - Modificar firma `recordFailure(providerId: string, creatorId?: string)`
  - Añadir `if (creatorId) void triggerCircuitOpen(providerId, creatorId)` cuando `failures >= FAILURE_THRESHOLD`
  - Modificar firma `wrapWithCircuitBreaker(..., creatorId?: string)` y pasar a `recordFailure`
  - Verificación: `tsc --noEmit` pasa, no rompe callers existentes (parámetros opcionales)

### W1 — Paralelo (pueden ejecutarse simultáneamente)

- [ ] **W1.A** — Modificar `src/app/api/v1/models/[slug]/invoke/route.ts`
  - Añadir imports: `getState`, `wrapWithCircuitBreaker` de `@/lib/circuit-breaker/CircuitBreaker`, `retryWithBackoff` de `@/lib/circuit-breaker/retryWithBackoff`
  - En el POST handler: añadir check 503 si CB `open` (antes de `callUpstream`)
  - Modificar `callUpstream` para aceptar `slug: string` y usar `wrapWithCircuitBreaker` + `retryWithBackoff` (ver Contrato de Integración)
  - Pasar `model.user_id as string` como `creatorId`
  - Verificación: invocación exitosa sigue funcionando, 503 cuando CB open

- [ ] **W1.B** — Crear `src/app/api/v1/agents/[slug]/cb-status/route.ts`
  - Seguir Exemplar E exactamente
  - Verificación: GET retorna `{ state, failures }`, 401/403/404 correctos

- [ ] **W1.C** — Crear `supabase/migrations/029_cb_webhook_event.sql`
  - Solo comentario documental (ver Exemplar G)
  - Verificación: archivo existe con el contenido correcto

### W2 — Frontend (depende de W1.B)

- [ ] **W2.A** — Crear `src/app/[locale]/creator/dashboard/_components/AgentCBBadge.tsx`
  - Seguir Exemplar F — Client Component, `useEffect` + fetch, badge con colores
  - Verificación: badge renderiza, 3 estados visualmente diferenciados

- [ ] **W2.B** — Modificar `src/app/[locale]/creator/dashboard/_components/AgentActions.tsx`
  - Añadir `import { AgentCBBadge } from './AgentCBBadge'`
  - Añadir `<AgentCBBadge slug={slug} />` dentro del `div` de acciones (antes de Edit link)
  - Verificación: badge aparece en el dashboard junto a cada agente

### W3 — Verificación final

- [ ] **W3.1** — `tsc --noEmit` sin errores
- [ ] **W3.2** — Build completo: `npm run build` sin errores
- [ ] **W3.3** — Verificar cada AC manualmente según tabla de ACs

---

## Out of Scope

- NO modificar `FAILURE_THRESHOLD`, `RECOVERY_TIMEOUT`, `WINDOW_SECONDS` en CircuitBreaker.ts
- NO añadir UI para que el creator configure el CB
- NO cambiar la lógica de Route A / Route B (free trial, x402) fuera de `callUpstream`
- NO modificar `logCall`, `recordOnChain`, `buildResponse` en invoke/route.ts
- NO refactorizar código adyacente aunque parezca mejorable
- NO añadir dependencias npm nuevas (todo con lo que ya existe)
- NO tocar archivos fuera de la tabla "Files to Modify/Create"
- NO añadir retry para errores de pago/auth

---

## Escalation Rule

> **Si algo no está en este Story File, Dev PARA y pregunta al Architect.**
> No inventar. No asumir. No improvisar.
> Architect actualiza el Story File antes de que Dev continúe.

Situaciones que requieren escalation:
- `model.user_id` no existe en el objeto `model` en `callUpstream` (verificar el SELECT en route.ts)
- `deliverWebhook` tiene una firma diferente a `(url, secret, payload)` en su archivo
- `AgentActions.tsx` recibe el agente de forma diferente y `slug` no es un prop directo
- El build falla por imports circulares entre `CircuitBreaker.ts` y `triggerCircuitOpen.ts`
- Hay ambigüedad sobre si el check 503 debe ir antes o después de la validación de pago

---

*Story File generado por NexusAgil — F2.5 | WAS-73 Circuit Breaker*
