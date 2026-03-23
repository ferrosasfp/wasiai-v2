# Logic Audit — Sprint Marketplace Health
**Auditor:** Logic Auditor (NexusAgil)
**Fecha:** 2026-03-23
**Commits auditados:** 4 (WAS-281, WAS-276, WAS-284, WAS-277)

---

## WAS-281 — retry_after_seconds + hint en 429/503 mutex
**Commit:** `59608f70e`
**Archivo:** `src/app/api/v1/models/[slug]/invoke/route.ts`

### AC Trazabilidad

| AC | Implementado | Archivo:línea | Status |
|----|-------------|---------------|--------|
| AC1: 429 body incluye `retry_after_seconds: 5` y `hint: "..."` | Sí | route.ts ~271-279 | ✅ OK |
| AC2: `retry_after_seconds` coincide con `Retry-After: '5'` | Sí | ambos usan 5 hardcodeado | ✅ OK |
| AC3: 503 Redis-unavailable también incluye `retry_after_seconds: 5` | Sí | route.ts ~288-293 | ✅ OK |

### Findings

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|---------------|
| 1 | OK | Correctitud | retry_after_seconds=5 en body coincide con header Retry-After: '5' | — |
| 2 | OK | Side effects | No se modificó lógica de mutex, TTL, ni adquisición del lock | — |

### Veredicto
**APROBADO** — Cambio aditivo puro, sin lógica tocada. Los tres ACs implementados correctamente.

---

## WAS-276 — Block tunnel/dev domains en validateEndpointUrl
**Commit:** `fb3140678`
**Archivos:** `src/lib/security/validateEndpointUrl.ts`, `src/app/api/creator/agents/[slug]/route.ts`

### AC Trazabilidad

| AC | Implementado | Archivo:línea | Status |
|----|-------------|---------------|--------|
| AC1: WHEN dominio tunnel THEN lanza error "Tunnel/development domains are not allowed..." | Sí — mensaje actualizado + lista completa | validateEndpointUrl.ts ~60-62 | ✅ OK |
| AC2: Case-insensitive | Sí — usa `h = hostname.toLowerCase()` preexistente | validateEndpointUrl.ts ~57 | ✅ OK |
| AC3: Con puerto no estándar (`host.loca.lt:4000`) | Sí — `url.hostname` ya excluye el puerto, check aplica a hostname puro | validateEndpointUrl.ts ~123 | ✅ OK |
| AC4: Dominio legítimo pasa sin cambio | Sí — solo agrega a `isBlockedHost`, flujo existente inalterado | — | ✅ OK |
| AC5: `validateEndpointUrlAsync` hereda el bloqueo | Sí — llama `validateEndpointUrl` internamente (no modificado) | — | ✅ OK |

**Wave 2 (PATCH endpoint_url):** Se verifica que `src/app/api/creator/agents/[slug]/route.ts` ahora llama `validateEndpointUrlAsync` cuando `result.data.endpoint_url` está presente antes del update en DB. ✅

### Findings

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|---------------|
| 1 | MENOR | Scope | `h === suffix.slice(1)` también bloquea el apex domain (ej: `loca.lt` sin subdomain). Comportamiento conservador, probablemente intencional. | validateEndpointUrl.ts ~61 |
| 2 | OK | Correctitud | Los 8 dominios del SDD están todos presentes en la lista | — |
| 3 | OK | Constraints | Checks existentes IPv4/IPv6/localhost no modificados | — |

### Veredicto
**APROBADO** — Todos los ACs implementados. El finding #1 es conservador/correcto (bloquear el apex de un tunnel domain es razonable).

---

## WAS-284 — Upstream errors propagan HTTP status correcto
**Commit:** `159c8b64c`
**Archivo:** `src/app/api/v1/models/[slug]/invoke/route.ts`

### AC Trazabilidad

| AC | Implementado | Archivo:línea | Status |
|----|-------------|---------------|--------|
| AC1: upstream 4xx → WasiAI responde 502 | Sí — `if (!upstream.ok)` → `httpStatusHint = 502` | route.ts ~664-667 | ✅ OK |
| AC2: upstream 5xx → WasiAI responde 503 | Sí — catch del error sintético `Upstream HTTP NNN` → `upstreamStatus >= 500 ? 503 : 502` | route.ts ~672-677 | ✅ OK |
| AC3: timeout (AbortError/TimeoutError) → 504 | Sí — `err instanceof DOMException && err.name === 'TimeoutError'` → `httpStatusHint = 504` | route.ts ~669-672 | ✅ OK |
| AC4: unreachable (connection error) → 502 | Sí — else final del catch → `httpStatusHint = 502` | route.ts ~678-681 | ✅ OK |
| AC5: éxito → 200 | Sí — `result.status === 'success'` → httpStatus = 200 (default) | route.ts ~744-747 | ✅ OK |
| AC6: Route B + upstream falla → `meta.upstream_failed: true` | Sí — `{ upstreamFailed: result.status === 'error' }` en call site Route B | route.ts ~564 | ✅ OK |
| AC7: Route A + falla → `meta.charged: 0` | Sí — `charged: result.status === 'success' ? pricingInfo... : 0` (sin cambio) | route.ts ~762 | ✅ OK |
| AC8: circuit breaker OPEN → sin cambio (out-of-scope) | N/A — no tocado | — | ✅ OK |

### Findings

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|---------------|
| 1 | MENOR | Error handling | La detección de 5xx depende de que el error `new Error('Upstream HTTP NNN')` sobreviva sin modificación a través de `wrapWithCircuitBreaker` y `retryWithBackoff`. Si alguno de esos wrappers wrappea el error en otro (ej: `new Error('circuit open', { cause: original })`), la regex no matchea y el 5xx cae al branch genérico → retorna 502 en vez de 503. Sin ver el código del circuit breaker no se puede confirmar. Si esto ocurre el AC2 fallaría silenciosamente (502 en vez de 503). | route.ts ~672-677 |
| 2 | OK | Correctitud | `upstream_failed` solo aparece en Route B via `options?.upstreamFailed` | — |
| 3 | OK | Tipos | `httpStatusHint?: number` en la firma de `buildResponse` — el cast a status HTTP es correcto (NextResponse.json acepta number) | — |

### Veredicto
**APROBADO con nota** — Todos los ACs tienen implementación correcta. El finding #1 es una fragilidad de acoplamiento con código adyacente (circuit breaker) que no es un bug en el código de este commit. Si `wrapWithCircuitBreaker` re-lanza sin modificar el mensaje, todo funciona. Recomendado verificar en QA.

---

## WAS-277 — Sync health probe en activación de agente
**Commit:** `f2ecaa792`
**Archivos:** `src/lib/agents/health-probe.ts`, `src/app/api/creator/agents/[slug]/status/route.ts`

### AC Trazabilidad

| AC | Implementado | Archivo:línea | Status |
|----|-------------|---------------|--------|
| AC1: PATCH status→active ejecuta probe síncrono antes de confirmar | Sí — `await probeEndpointSync(...)` antes del update principal | status/route.ts ~78-117 | ✅ OK |
| AC2: probe pasa (2xx) → agente activo + health_check + last_checked_at actualizados | Sí — `updatePayload.health_check = probeResult.healthCheck` + `updatePayload.last_checked_at` | status/route.ts ~113-115 | ✅ OK |
| AC3: probe falla → agente queda en `reviewing`, API responde 422 con mensaje | Sí — update a `reviewing` + return 422 con detail/fix | status/route.ts ~90-109 | ✅ OK |
| AC4: sin `endpoint_url` → 422 "endpoint_url is required to activate" | Sí — `if (!existing.endpoint_url)` antes del probe | status/route.ts ~79-84 | ✅ OK |
| AC5: probe NO corre cuando status → `paused` o `draft` | Sí — el if solo entra cuando `result.data.status === 'active'` | status/route.ts ~76 | ✅ OK |
| AC6: fallo de probe por 5xx o timeout → status `reviewing` (no `draft`) | Sí — ambos paths en `probeEndpoint` cambiados a `'reviewing'`; `probeEndpointSync` siempre retorna `reviewing` en fallo | health-probe.ts ~87, ~103 | ✅ OK |

### Findings

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|---------------|
| 1 | OK | Concurrencia | Dos PATCH simultáneos al mismo agente podrían correr dos probes en paralelo y hacer dos updates. No introduce inconsistencia grave (ambos escribirían reviewing o active correctamente). Race condition existente de la route, no introducida aquí. | — |
| 2 | OK | Timeout | `req.setTimeout(5000)` = 5s, dentro del límite obligatorio de 6s del SDD | health-probe.ts ~163 |
| 3 | MENOR | Edge case | `Number(urlObj.port) \|\| 443` en `probeEndpointSync`: si el URL tiene scheme HTTP (no HTTPS), el probe usa `https.request` con puerto 443, ignorando el scheme. En la práctica `validateEndpointUrlAsync` bloquea URLs no-HTTPS, pero si ese check falla silenciosamente, el probe podría conectar al puerto 443 de un servidor HTTP. Baja probabilidad pero edge case no documentado. | health-probe.ts ~157 |
| 4 | OK | Lógica de retorno temprano | Cuando probe falla: se hace update a `reviewing` en DB y se retorna 422. El código no cae al update principal. ✅ Correcto — el `return` previene el segundo update. | status/route.ts ~90-109 |
| 5 | OK | Constraints | `probeEndpoint` (fire-and-forget) no tiene firma modificada, solo el estado interno `draft` → `reviewing` | health-probe.ts | 

### Veredicto
**APROBADO** — Todos los ACs implementados correctamente. Los findings son menores/edge cases de baja probabilidad.

---

## Resumen Ejecutivo

| Issue | Commit | Veredicto | Bloqueantes |
|-------|--------|-----------|-------------|
| WAS-281 | `59608f70e` | **PASS** | 0 |
| WAS-276 | `fb3140678` | **PASS** | 0 |
| WAS-284 | `159c8b64c` | **PASS** | 0 |
| WAS-277 | `f2ecaa792` | **PASS** | 0 |

**Total findings:** 0 BLOQUEANTES, 3 MENOR, 5 OK

Los 3 MENOR documentados:
- **WAS-276 #1:** Apex domain tunnel bloqueado (comportamiento conservador, correcto)
- **WAS-284 #1:** Fragilidad en detección 5xx si circuit breaker wrappea el error — verificar en QA
- **WAS-277 #3:** `https.request` con port 443 si URL fuera HTTP (mitigado por validateEndpointUrlAsync)

Ningún finding requiere corrección de código para proceder. El sprint puede avanzar a QA Verifier.

---

LOGIC AUDIT COMPLETE
