# Adversarial Review — WAS-73: Circuit Breaker y Retry

**Fecha:** 2026-03-02  
**Revisor:** Adversary (NexusAgil)  
**Sprint:** WAS-73  
**Archivos revisados:** 8 archivos (retryWithBackoff.ts, CircuitBreaker.ts, triggerCircuitOpen.ts, invoke/route.ts, cb-status/route.ts, AgentCBBadge.tsx, AgentActions.tsx, 029_cb_webhook_event.sql)

---

## Tabla de Hallazgos

| # | Categoría | Clasificación | Hallazgo |
|---|-----------|---------------|----------|
| B-01 | Lógica de negocio | **BLOQUEANTE** | HTTP 5xx del upstream no activa `recordFailure` — CB nunca se abre por errores HTTP |
| B-02 | Error handling | **BLOQUEANTE** | Redis down = outage total del endpoint invoke — falla CLOSED en vez de OPEN |
| M-01 | Race conditions | **MENOR** | Half-open sin lock: múltiples requests simultáneas pasan en parallel probe |
| M-02 | Lógica de negocio | **MENOR** | `triggerCircuitOpen` se dispara repetidamente por cada fallo después de que el CB ya está abierto (webhook spam) |
| M-03 | Performance | **MENOR** | Doble llamada a `getState` / Redis por cada request (outer check + inside wrapWithCircuitBreaker) |
| M-04 | Performance | **MENOR** | Badge sin auto-refresh: muestra estado stale si el creator deja la página abierta |
| M-05 | Performance | **MENOR** | Worst-case latency con retry: 3 × 10s + (0+500+1500)ms = ~32s |
| OK-01 | Seguridad | **OK** | cb-status verifica sesión y ownership correctamente |
| OK-02 | Pagos | **OK** | Retry no causa doble cobro (payment se settle una vez, antes de callUpstream) |
| OK-03 | Lógica de negocio | **OK** | Retry NO reintenta en HTTP 4xx/5xx (solo TypeError/AbortError/TimeoutError) |
| OK-04 | Auth | **OK** | cb-status requiere auth, forbidden si user_id != agent.user_id |
| OK-05 | Seguridad | **OK** | No leaks de datos sensibles en payload del webhook |
| OK-06 | Lógica de negocio | **OK** | CB check precede al cobro en Route A (agent key) y en Route B (x402) — 503 sin charge |
| OK-07 | Calidad | **OK** | No `any` explícito, imports correctos, patrones consistentes con codebase |
| OK-08 | Pagos | **OK** | Route A: `increment_agent_key_spend` solo se llama si result.status === 'success' |

---

## Detalle de Hallazgos BLOQUEANTES

### B-01 — HTTP 5xx del upstream no activa `recordFailure`

**Severidad:** BLOQUEANTE  
**Archivo:** `src/lib/circuit-breaker/CircuitBreaker.ts` + `src/app/api/v1/models/[slug]/invoke/route.ts`

**Descripción:**  
`wrapWithCircuitBreaker` llama `recordFailure` solo cuando `fn()` lanza una excepción. `retryWithBackoff` a su vez solo lanza si hay un network error (TypeError/AbortError/TimeoutError). Cuando el upstream responde con HTTP 500, 503, 502, etc., `fetch()` **no lanza** — retorna un `Response` con `ok = false`.

Flujo actual con upstream devolviendo HTTP 500:
```
retryWithBackoff → fetch() → Response(status=500)  ← no exception
wrapWithCircuitBreaker recibe Response ← sin excepción
wrapWithCircuitBreaker llama recordSuccess() ← ❌ INCORRECTO
callUpstream detecta !upstream.ok → status = 'error'
```

El resultado: el circuit breaker **nunca se abre** por errores HTTP del upstream. Solo se abre por network-level failures (timeout, unreachable). Esto invalida el propósito principal del CB para upstreams que devuelven 5xx en vez de caerse.

**Acción requerida:**  
En `callUpstream`, lanzar una excepción cuando `!upstream.ok` con status 5xx, DENTRO del closure pasado a `wrapWithCircuitBreaker`. O alternativamente, refactorizar `wrapWithCircuitBreaker` para que reciba el `Response` y evalúe `ok`.

**Fix sugerido en `callUpstream`:**
```typescript
const upstream = await wrapWithCircuitBreaker(
  slug,
  () => retryWithBackoff(async () => {
    const res = await fetch(model.endpoint_url as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    // Lanzar para que wrapWithCircuitBreaker registre el fallo
    if (res.status >= 500) throw new Error(`Upstream HTTP ${res.status}`)
    return res
  }),
  model.user_id as string
)
```
Nota: solo lanzar para 5xx — los 4xx son errores del caller, no del provider.

---

### B-02 — Redis down = outage total del invoke endpoint

**Severidad:** BLOQUEANTE  
**Archivo:** `src/lib/circuit-breaker/CircuitBreaker.ts`, `src/app/api/v1/models/[slug]/invoke/route.ts`

**Descripción:**  
Si Upstash Redis está caído o inaccesible:

1. La llamada `await getState(slug)` en invoke/route.ts lanza excepción.
2. El outer try-catch del handler devuelve `500 Internal Server Error`.
3. **Todo el endpoint invoke queda inoperativo** mientras Redis esté down.

Esto convierte Redis en un SPOF para el endpoint de pagos. El principio correcto para un circuit breaker es **fail open** cuando no se puede determinar el estado: si no sé si el CB está abierto, asumo que está cerrado y dejo pasar el tráfico.

**Acción requerida:**  
Envolver los calls a Redis en `getState` con try-catch que retorne `'closed'` como fallback. Lo mismo para `recordFailure` y `recordSuccess` (fail silently).

**Fix sugerido en `CircuitBreaker.ts`:**
```typescript
export async function getState(providerId: string): Promise<CBState> {
  try {
    const k = keys(providerId)
    const state = await redis.get<CBState>(k.state)
    // ... lógica existente ...
    return state ?? 'closed'
  } catch {
    // Redis unavailable → fail open (assume closed, let traffic through)
    return 'closed'
  }
}

export async function recordFailure(providerId: string, creatorId?: string): Promise<void> {
  try {
    // ... lógica existente ...
  } catch {
    // Redis unavailable → non-fatal, skip failure recording
  }
}

export async function recordSuccess(providerId: string): Promise<void> {
  try {
    // ... lógica existente ...
  } catch {
    // Redis unavailable → non-fatal
  }
}
```

---

## Detalle de Hallazgos MENORES

### M-01 — Half-open sin lock: múltiples probes simultáneas

**Archivo:** `src/lib/circuit-breaker/CircuitBreaker.ts`

En estado `half-open`, múltiples requests concurrentes pasan el check `if (state === 'open')` y todas proceden al upstream. El patrón correcto usa un lock atómico (Redis SETNX/SET NX) para permitir solo UNA probe request. 

Impacto: tráfico no limitado en recovery. Si el upstream está parcialmente recuperado, puede recibir N requests simultáneas en vez de 1 probe controlada. En práctica el daño es limitado porque si falla, el CB vuelve a `open` rápidamente.

**Acción sugerida:** `SET cb:provider:${id}:probe 1 NX EX 30` antes de pasar — solo el que obtiene el lock hace la probe.

---

### M-02 — Webhook spam: `triggerCircuitOpen` dispara múltiples veces

**Archivo:** `src/lib/circuit-breaker/CircuitBreaker.ts`

En `recordFailure`, la condición `if (failures >= FAILURE_THRESHOLD)` es true para TODOS los fallos posteriores a la apertura (failure 5, 6, 7, 8...). El CB ya está `open` con TTL de 5min, pero `triggerCircuitOpen` se llama en cada nuevo fallo que llegue.

Dado que el CB abierto devuelve 503 antes de llamar al upstream, en práctica los fallos nuevos solo llegan si hay una race condition (half-open) o si la red rechaza antes de que el CB check ocurra. Igualmente, el webhook se dispara más de una vez por apertura.

**Acción sugerida:** Verificar `if (failures === FAILURE_THRESHOLD)` (igualdad exacta) en vez de `>=`.

---

### M-03 — Doble Redis call por request (`getState` llamado dos veces)

**Archivo:** `src/app/api/v1/models/[slug]/invoke/route.ts`

Por cada request:
1. `const cbState = await getState(slug)` — outer check en route.ts (línea ~185)
2. `await wrapWithCircuitBreaker(slug, ...)` → llama `getState(providerId)` de nuevo

Dos round-trips a Redis innecesarios. `wrapWithCircuitBreaker` podría recibir el estado ya calculado, o el outer check debería eliminarse y dejarse solo el wrapper.

---

### M-04 — Badge sin auto-refresh

**Archivo:** `src/app/[locale]/creator/dashboard/_components/AgentCBBadge.tsx`

El badge hace un único fetch en `useEffect` (on-mount). Si el creator deja el dashboard abierto, el badge puede mostrar `● Online` aunque el CB esté abierto hace minutos.

**Acción sugerida:** Polling cada 30s (con `setInterval` + cleanup en return), o usar SWR/react-query con `refreshInterval: 30000`.

---

### M-05 — Worst-case latency excesiva con retry

**Archivo:** `src/lib/circuit-breaker/retryWithBackoff.ts`

`RETRY_DELAYS_MS = [0, 500, 1500]` + `AbortSignal.timeout(10_000)` por attempt:
- Attempt 1: 0ms delay + hasta 10s = 10s
- Attempt 2: 500ms delay + hasta 10s = 10.5s
- Attempt 3: 1500ms delay + hasta 10s = 11.5s
- **Total worst case: ~32s**

Para un endpoint de pagos en tiempo real, esto es excesivo. Considerar reducir el timeout por attempt a 5s para retries (attempts 2+), o reducir a 2 retries con delays más cortos.

---

## Resumen

| Clasificación | Cantidad |
|---------------|----------|
| BLOQUEANTE | **2** |
| MENOR | **5** |
| OK | **8** |

**Veredicto:** NO puede avanzar a Code Review sin corregir B-01 y B-02. Son los dos fallos más críticos: uno invalida la lógica core del CB, el otro convierte Redis en un SPOF del endpoint de pagos.
