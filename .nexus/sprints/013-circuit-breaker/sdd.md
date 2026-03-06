# SDD 013 — Circuit Breaker y Retry Automático en Invocaciones
**WAS-73 | Mode: QUALITY | NNN: 013 | Fecha: 2026-03-02**

---

## 1. Context Map

### Archivos leídos y patrones extraídos

| Archivo | Patrones extraídos |
|---------|-------------------|
| `src/lib/circuit-breaker/CircuitBreaker.ts` | Usa `@upstash/redis`. Keys: `cb:provider:{id}:state/failures/last_failure`. Estados: `closed / open / half-open`. FAILURE_THRESHOLD=5, RECOVERY_TIMEOUT=30s, WINDOW_SECONDS=120. Exports: `getState`, `recordSuccess`, `recordFailure`, `resetCircuit`, `wrapWithCircuitBreaker`. |
| `src/app/api/v1/models/[slug]/invoke/route.ts` | `callUpstream()` hace `fetch` directo sin CB ni retry. Usa `createServiceClient()` (service role). Imports desde `@/lib/*`. Pattern de error: `{ error, detail, status }`. Logger: `import { logger } from '@/lib/logger'`. |
| `src/lib/supabase/server.ts` | `createServiceClient()` — sincrono, bypass RLS. `createClient()` — async, cookie-based. Pattern: no throw en Server Components. |
| `src/lib/webhooks/triggerCreditsLow.ts` | Pattern de webhook trigger: `createServiceClient()` → query `webhooks` table by `user_id + is_active + events contains`. `deliverWebhook(url, secret, payload)`. `webhook_deliveries.insert(...)`. Evento formato: `{ event, timestamp, data }`. |
| `supabase/migrations/027_webhooks.sql` | Tabla `webhooks(id, user_id, url, secret, events TEXT[], is_active)`. Tabla `webhook_deliveries(webhook_id, event, payload, status_code, success, attempt)`. Último número: **028**. |
| `project-context.md` | Stack: Next.js 14 App Router. Sin `any` en TS. Migrations numeradas `0XX`. Próxima: 029 (las 017 del doc project-context está desactualizada — el filesystem dice 028 es el último). RLS en todas las tablas. |

### Exemplars clave

**Exemplar A — wrapWithCircuitBreaker (CircuitBreaker.ts:57)**
```ts
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

**Exemplar B — callUpstream actual (route.ts:~340)**
```ts
async function callUpstream(model: Record<string, unknown>, request: NextRequest) {
  const upstream = await fetch(model.endpoint_url as string, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  data = upstream.ok ? await upstream.json() : { error: `Upstream ${upstream.status}` }
  if (!upstream.ok) status = 'error'
}
```

**Exemplar C — webhook trigger (triggerCreditsLow.ts)**
```ts
const { data: webhooks } = await supabase
  .from('webhooks')
  .select('id, url, secret')
  .eq('user_id', userId)
  .eq('is_active', true)
  .contains('events', ['credits.low'])

await Promise.allSettled(
  webhooks.map(async (wh) => {
    const result = await deliverWebhook(wh.url, wh.secret, payload)
    await supabase.from('webhook_deliveries').insert({ ... })
  })
)
```

---

## 2. Objetivo

Integrar el `CircuitBreaker` existente en la ruta `POST /api/v1/models/[slug]/invoke`, añadiendo:

1. **Retry con backoff exponencial** — 3 intentos (0ms / 500ms / 1500ms) **solo** en errores de red (fetch throw / timeout). NO reintentar en HTTP 4xx del upstream.
2. **Circuit breaker por agent slug** — usar `slug` como `providerId`. Si CB está `open`, retornar 503 inmediatamente sin llamar upstream.
3. **Badge de estado CB** en el creator dashboard — mostrar `closed` / `open` / `half-open` por agente.
4. **Notificación webhook** `agent.circuit_open` cuando el CB de un agente entra en estado `open` — usar infraestructura de webhooks existente (`webhooks` + `webhook_deliveries` + `deliverWebhook`).

**Scope OUT:**
- No modificar FAILURE_THRESHOLD ni RECOVERY_TIMEOUT (son constantes de infra, no de negocio).
- No añadir UI para configurar CB por creator.
- No cambiar la lógica de retry para errores de pago/auth (Route A/B permanecen iguales fuera de callUpstream).

---

## 3. Acceptance Criteria (EARS)

| ID | Formato EARS | Criterio |
|----|-------------|---------|
| AC-1 | WHEN el fetch a `endpoint_url` falla por error de red (throw / timeout) THEN el sistema reintenta hasta 3 veces con delays 0ms / 500ms / 1500ms | Retry solo en network errors |
| AC-2 | IF el upstream responde HTTP 4xx THEN el sistema NO reintenta y registra el error inmediatamente | No retry en 4xx |
| AC-3 | WHILE el circuit breaker del slug está en estado `open` WHEN llega una invocación THEN la ruta retorna `{ error: "agent_circuit_open", retry_after_seconds: 30 }` con status 503 | CB bloqueante |
| AC-4 | WHEN el CB del slug transiciona a `open` (5 fallos en 120s) THEN se dispara el evento webhook `agent.circuit_open` para todos los webhooks activos del creator que suscriben al evento | Notificación creator |
| AC-5 | WHEN el creator visita su dashboard THEN cada agente muestra un badge con el estado CB actual (`closed` / `open` / `half-open`) | Badge en dashboard |
| AC-6 | IF el CB está en estado `half-open` y el intento único tiene éxito THEN el CB se resetea a `closed` | Recovery path |
| AC-7 | WHEN el upstream responde exitosamente después de reintentos THEN `recordSuccess(slug)` es llamado y el retry count no se expone al caller | Success logging |
| AC-8 | IF todos los reintentos fallan por errores de red THEN `recordFailure(slug)` es llamado por cada fallo y el error final se retorna al caller | Failure accounting |

---

## 4. Tabla de Archivos

| # | Archivo | Acción | Propósito | Exemplar |
|---|---------|--------|-----------|---------|
| 1 | `src/lib/circuit-breaker/CircuitBreaker.ts` | MODIFICAR | Añadir `notifyCircuitOpen(slug, creatorId)` — disparar webhook cuando CB pasa a `open` | Exemplar C (triggerCreditsLow pattern) |
| 2 | `src/lib/circuit-breaker/retryWithBackoff.ts` | CREAR | Helper `retryWithBackoff<T>(fn, providerId)` — 3 intentos con delays [0, 500, 1500]ms, solo en network errors | Exemplar B (callUpstream catch block) |
| 3 | `src/app/api/v1/models/[slug]/invoke/route.ts` | MODIFICAR | Integrar CB + retry en `callUpstream()`. Leer `creatorId` del model para notificación. Retornar 503 si CB `open`. | Exemplar A (wrapWithCircuitBreaker) |
| 4 | `src/app/api/v1/agents/[slug]/cb-status/route.ts` | CREAR | `GET` endpoint — retorna `{ state: CBState, failures: number }` para el slug. Auth: solo el creator del agente. | createServiceClient pattern (server.ts) |
| 5 | `src/app/[locale]/creator/dashboard/_components/AgentCBBadge.tsx` | CREAR | Badge React `"closed" → verde / "open" → rojo / "half-open" → amarillo`. Fetches `/api/v1/agents/[slug]/cb-status`. | AgentActions.tsx pattern (dashboard _components) |
| 6 | `src/app/[locale]/creator/dashboard/_components/AgentActions.tsx` | MODIFICAR | Añadir `<AgentCBBadge slug={agent.slug} />` junto a las acciones de cada agente. | Archivo existente en dashboard |
| 7 | `supabase/migrations/029_cb_webhook_event.sql` | CREAR | Añadir `'agent.circuit_open'` como valor válido en documentación (no enum — TEXT[] ya soporta cualquier string). Migration vacía con comentario. | 027_webhooks.sql pattern |
| 8 | `src/lib/webhooks/triggerCircuitOpen.ts` | CREAR | Trigger webhook `agent.circuit_open` para el creator del agente. Mismo pattern que `triggerCreditsLow.ts`. | Exemplar C |

---

## 5. Constraint Directives

### OBLIGATORIO

1. **Usar `slug` como `providerId`** en `wrapWithCircuitBreaker` — las keys Redis son `cb:provider:{slug}:*`, que es el identificador de invocación correcto (el CB está diseñado para providers, un agente IS el provider).
2. **Solo reintentar si `err instanceof Error && !err.message.includes('Upstream')` o si el fetch lanza (network error / timeout)** — nunca reintentar si el upstream respondió con un HTTP status code.
3. **`recordFailure` llamado por CADA intento fallido** — no solo al agotar todos los reintentos. El CB debe contar fallos individuales.
4. **Webhook `agent.circuit_open` con `Promise.allSettled`** — no bloquear la invocación en el caso de que el webhook falle.
5. **El badge CB usa `fetch` client-side con `cache: 'no-store'`** — el estado CB cambia frecuentemente, no debe cachearse.
6. **Imports desde `@/lib/circuit-breaker/CircuitBreaker`** — usar el módulo existente, no reimplementar.

### PROHIBIDO

1. **PROHIBIDO reintentar en errores HTTP 4xx** — validar explícitamente que el fetch lanzó una excepción (no que respondió con status ≥ 400).
2. **PROHIBIDO exponer Redis directamente desde la API route** — todo acceso a CB debe pasar por `src/lib/circuit-breaker/CircuitBreaker.ts`.
3. **PROHIBIDO usar `any` explícito en TypeScript** — usar tipos reales o `unknown` con type guard.
4. **PROHIBIDO bloquear la respuesta de invocación esperando el webhook** — la notificación es fire-and-forget (`void triggerCircuitOpen(...)`).
5. **PROHIBIDO hardcodear delays de retry** — definirlos como constante exportada `RETRY_DELAYS_MS = [0, 500, 1500]` en `retryWithBackoff.ts`.

---

## 6. Plan de Waves

### W0 — Serial (bloqueante, sin paralelismo)

**W0.1** — Crear `src/lib/circuit-breaker/retryWithBackoff.ts`
- Implementar `retryWithBackoff<T>`. Debe estar listo antes de modificar el invoke route.
- Test mental: si `fn` lanza `TypeError: fetch failed`, reintenta. Si retorna `{ error: 'Upstream 422' }` con status 422, NO reintenta.

**W0.2** — Crear `src/lib/webhooks/triggerCircuitOpen.ts`
- Depende de infraestructura existente (`deliverWebhook`, `webhooks` table). No tiene dependencias nuevas.

**W0.3** — Modificar `src/lib/circuit-breaker/CircuitBreaker.ts`
- Añadir `notifyCircuitOpen(slug, creatorId)` — llamar `triggerCircuitOpen` dentro de `recordFailure` cuando `failures >= FAILURE_THRESHOLD`.
- IMPORTANTE: necesita `creatorId` — `recordFailure` debe aceptarlo como parámetro opcional.

### W1 — Paralelo (pueden ejecutarse en paralelo entre sí)

**W1.A** — Modificar `src/app/api/v1/models/[slug]/invoke/route.ts`
- Integrar `retryWithBackoff` en `callUpstream()`.
- Integrar `wrapWithCircuitBreaker(slug, ...)` alrededor de `callUpstream()`.
- Pasar `model.user_id` (creatorId) a `recordFailure`.
- Retornar 503 si CB open (ya hay pattern en route para 503 con `retry_after_seconds`).

**W1.B** — Crear `src/app/api/v1/agents/[slug]/cb-status/route.ts`
- GET endpoint que llama `getState(slug)` y lee failures de Redis.
- Auth: verificar que el user autenticado es el creator del agente.

**W1.C** — Crear migration `supabase/migrations/029_cb_webhook_event.sql`
- Migration documental. Puede incluir un `INSERT` en una tabla de configuración si existe, o simplemente el comentario.

### W2 — Frontend (depende de W1.B)

**W2.A** — Crear `src/app/[locale]/creator/dashboard/_components/AgentCBBadge.tsx`
- Fetch a `/api/v1/agents/[slug]/cb-status`.
- Renderizar badge con color según estado.

**W2.B** — Modificar `AgentActions.tsx` para incluir `<AgentCBBadge />`.

---

## 7. Implementation Readiness Check

- [x] **Cada AC tiene al menos 1 archivo asociado**
  - AC-1,2,7,8 → archivo #2 (retryWithBackoff) + archivo #3 (invoke route)
  - AC-3,6 → archivo #3 (invoke route) + archivo #1 (CircuitBreaker)
  - AC-4 → archivo #8 (triggerCircuitOpen) + archivo #1 (CircuitBreaker)
  - AC-5 → archivo #5 (AgentCBBadge) + archivo #4 (cb-status API) + archivo #6 (AgentActions)

- [x] **Cada archivo tiene Exemplar válido (verificado con lectura real)**
  - Archivo #1, #8: Exemplar C (triggerCreditsLow.ts — leído y confirmado)
  - Archivo #2, #3: Exemplar B (callUpstream — leído en route.ts líneas ~340+)
  - Archivo #3: Exemplar A (wrapWithCircuitBreaker — leído en CircuitBreaker.ts:57)
  - Archivo #4: createServiceClient pattern (server.ts — leído)
  - Archivo #5, #6: dashboard _components pattern (page.tsx + AgentActions.tsx — leído)

- [x] **No hay NEEDS_CLARIFICATION pendientes**
  - `user_id` existe en la tabla `agents` (model row tiene `*` select — confirmado por query en route.ts)
  - Infraestructura webhook confirmada: tabla `webhooks`, `webhook_deliveries`, `deliverWebhook` helper

- [x] **Constraint Directives incluyen al menos 3 PROHIBIDO** — 5 PROHIBIDO listados

- [x] **Context Map tiene al menos 2 archivos leídos** — 6 archivos leídos con patrones documentados

- [x] **Último número de migración verificado** — `028_async_jobs.sql` es el último. Próxima: `029_cb_webhook_event.sql`

---

## 8. Diseño Técnico Detallado

### retryWithBackoff.ts — Pseudocódigo

```ts
export const RETRY_DELAYS_MS = [0, 500, 1500] as const

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  isNetworkError: (err: unknown) => boolean = defaultIsNetworkError
): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
    if (i > 0) await sleep(RETRY_DELAYS_MS[i])
    try {
      return await fn()
    } catch (err) {
      if (!isNetworkError(err)) throw err  // no reintentar si no es network error
      lastErr = err
    }
  }
  throw lastErr
}

function defaultIsNetworkError(err: unknown): boolean {
  // fetch lanza TypeError para errores de red y AbortError para timeout
  return err instanceof TypeError || (err instanceof DOMException && err.name === 'AbortError') || (err instanceof Error && err.name === 'AbortError')
}
```

### Integración en callUpstream — cambio mínimo

```ts
// ANTES:
const upstream = await fetch(model.endpoint_url as string, { ... })

// DESPUÉS — wrapping con CB + retry:
const result = await wrapWithCircuitBreaker(slug, () =>
  retryWithBackoff(async () => {
    const upstream = await fetch(model.endpoint_url as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    // HTTP 4xx: NO lanzar — retornar resultado de error (no se reintenta)
    return upstream
  })
)
```

### Respuesta 503 cuando CB open

```ts
// En POST handler, antes de callUpstream:
const cbState = await getState(slug)
if (cbState === 'open') {
  return NextResponse.json(
    { error: 'agent_circuit_open', message: 'Agent temporarily unavailable', retry_after_seconds: 30 },
    { status: 503, headers: { 'Retry-After': '30' } }
  )
}
```

### triggerCircuitOpen.ts — estructura

```ts
// Mismo pattern que triggerCreditsLow.ts
export async function triggerCircuitOpen(slug: string, creatorId: string): Promise<void> {
  const supabase = createServiceClient()
  const { data: webhooks } = await supabase
    .from('webhooks')
    .select('id, url, secret')
    .eq('user_id', creatorId)
    .eq('is_active', true)
    .contains('events', ['agent.circuit_open'])
  
  if (!webhooks?.length) return

  const payload = {
    event: 'agent.circuit_open',
    timestamp: new Date().toISOString(),
    data: { agent_slug: slug, creator_id: creatorId },
  }

  await Promise.allSettled(
    webhooks.map(async (wh) => {
      const result = await deliverWebhook(wh.url, wh.secret, payload)
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

## Notas para el Dev

1. `recordFailure` en `CircuitBreaker.ts` necesita aceptar `creatorId?: string` opcional para llamar `triggerCircuitOpen` cuando `failures >= FAILURE_THRESHOLD`. Esto es un cambio backward-compatible (parámetro opcional).
2. El badge CB en el dashboard puede usar `useEffect` + `fetch` o ser un Server Component con `revalidate: 0`. Preferir Client Component con SWR o `useEffect` para no bloquear el SSR del dashboard.
3. El endpoint `/api/v1/agents/[slug]/cb-status` debe verificar ownership del agente antes de retornar el estado. Usar `createClient()` (auth-aware) para validar la sesión y luego `createServiceClient()` para leer Redis.
