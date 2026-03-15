# Logic Audit — SDD #215 (commit 3dff698)

**Auditor:** NexusAgil Logic Auditor v1.3  
**Fecha:** 2026-03-14  
**Scope:** health-probe.ts (nuevo), status/route.ts (nuevo), register/route.ts (mod), creator/[slug]/route.ts (mod)

---

## AC Trazabilidad

| AC | Implementado | Archivo:línea | Status |
|----|-------------|---------------|--------|
| AC1: register non-JWT → probe async + 201 con `status:"reviewing"`, `health_check:{pending:true}`, `status_url` | Parcial — probe async ✓, `health_check:{pending:true}` ✓, `status_url` ✓, pero **`status:"reviewing"` ausente en response body** | `register/route.ts` — bloque Response 201 | ❌ FALLA |
| AC2: probe 2xx <5s → `status=active`, `health_check={passed:true,latency_ms}` | Parcial — **condición `res.ok \|\| res.status < 500` acepta 3xx/4xx como success** | `health-probe.ts` — rama `if (res.ok \|\| res.status < 500)` | ❌ FALLA |
| AC3: probe falla → `status=reviewing`, `health_check={passed:false,reason,message,fix}` | Implementado | `health-probe.ts` — bloques `else` y `catch` | ✅ OK |
| AC4: GET /status con x-agent-key válida del owner → `{status, health_check, last_checked_at, slug}` | Implementado | `status/route.ts` — bloque `response` | ✅ OK |
| AC5: GET con key inválida o de otro owner → 401 | Implementado | `status/route.ts` — guards `if (!keyRecord)` y `if (keyRecord.owner_id !== agent.creator_id)` | ✅ OK |
| AC6: nunca verificado → `health_check` y `last_checked_at` null | Implementado para draft; **edge case: agente registrado con endpoint_url tiene `health_check:{pending:true}` antes de que probe complete** — no es `null` | `register/route.ts` — update pre-probe; `status/route.ts` — `?? null` | ⚠️ EDGE CASE |
| AC7: PATCH recibe nuevo endpoint_url → re-probe async | Implementado | `creator/[slug]/route.ts` — bloque al final del PATCH | ✅ OK |
| AC8: endpoint_url ausente en registro → `status=draft` | Implementado | `register/route.ts` — rama `else` | ✅ OK |
| AC9: SSRF detectado → abortar, `reason: ssrf_blocked` | Implementado | `health-probe.ts` — try/catch de `validateEndpointUrlAsync` | ✅ OK |
| AC10: timeout→"timeout", non-2xx→"http_error"+status_code, conexión→"connection_error" | Parcial — **detección de timeout via `latency_ms >= 4_900` es heurística frágil**; non-2xx incorrecto (ver F1) | `health-probe.ts` — catch block + rama `else` | ❌ FALLA |

---

## Findings

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|---------------|
| F1 | 🔴 HIGH | Lógica — condición incorrecta | `if (res.ok \|\| res.status < 500)` acepta **3xx (redirecciones) y 4xx (401, 403, 404…)** como "alive" y actualiza `status=active, passed:true`. AC2 exige exclusivamente 2xx. AC10 exige que non-2xx resulte en `reason:"http_error"`. La condición correcta es únicamente `if (res.ok)` (equivale a `status >= 200 && status < 300`). | `health-probe.ts` — `if (res.ok \|\| res.status < 500)` |
| F2 | 🔴 HIGH | Lógica — detección de timeout frágil | `AbortSignal.timeout(5_000)` lanza un `DOMException` con `name === "TimeoutError"` casi inmediatamente al expirar, **independientemente del tiempo transcurrido**. Detectar timeout via `latency_ms >= 4_900` puede fallar en ambos sentidos: (a) timeout en máquina lenta con `latency_ms < 4900` queda clasificado como `connection_error`; (b) conexión rechazada instantáneamente en red lenta con `latency_ms` cercano a 5s queda mal clasificada como `timeout`. La comprobación correcta es `err instanceof DOMException && err.name === 'TimeoutError'` (o `err.name === 'AbortError'` en entornos que no distingan). | `health-probe.ts` — `const isTimeout = latency_ms >= 4_900` |
| F3 | 🔴 HIGH | AC Incumplido — campo ausente en response | La respuesta 201 del endpoint de registro incluye `message`, `health_check` y `status_url`, pero **omite el campo `status`**. AC1 requiere explícitamente retornar `status: "reviewing"`. El consumidor del API no puede conocer el estado inicial del agente sin hacer un GET adicional. | `register/route.ts` — bloque Response 201 |
| F4 | 🟡 MEDIUM | Concurrencia — race condition probe vs probe | Si el owner hace PATCH sobre `endpoint_url` mientras un probe previo aún está en vuelo, **dos probes corren en paralelo** sobre el mismo `agentId` sin coordinación. El `last_checked_at` y `health_check` finales dependen de cuál `updateAgentHealth` termina último (last-write-wins no determinista). No hay mecanismo de cancelación ni deduplicación. | `health-probe.ts` — `updateAgentHealth`; `creator/[slug]/route.ts` — bloque re-probe |
| F5 | 🟡 MEDIUM | Edge case — AC6 ventana entre register y probe | Un GET a `/status` emitido después del register pero **antes de que el probe complete** retornará `health_check: { pending: true }`, no `null`. AC6 dice que si nunca ha sido verificado, `health_check` SHALL ser `null`. El estado `{ pending: true }` es un estado intermedio documentado en AC1, pero técnicamente viola AC6 mientras el probe está en vuelo. Si AC6 se interpreta como "never successfully/unsuccessfully probed", el comportamiento es ambiguo y debería aclararse en el SDD. | `register/route.ts` — update pre-probe; `status/route.ts` — `agent.health_check ?? null` |
| F6 | 🟢 LOW | Side effect no documentado — `last_checked_at` se actualiza en SSRF blocked | Cuando el probe aborta por SSRF, `updateAgentHealth` persiste `last_checked_at: new Date().toISOString()`. Esto es técnicamente un intento de verificación, pero desde la perspectiva del owner el endpoint "nunca respondió" y `last_checked_at` refleja el momento del bloqueo SSRF, no una verificación real. Sin documentar este comportamiento puede generar confusión. | `health-probe.ts` — `updateAgentHealth` tras catch SSRF |

---

## Detalle técnico de hallazgos críticos

### F1 — Condición `res.ok || res.status < 500`

```typescript
// CÓDIGO ACTUAL (incorrecto)
if (res.ok || res.status < 500) {
  await updateAgentHealth(serviceClient, agentId, 'active', { passed: true, latency_ms })
}
// res.ok = true  → 200-299 ✓
// res.ok = false + res.status < 500 → 300-499 también pasan ← BUG

// CORRECCIÓN
if (res.ok) {   // solo 2xx
  await updateAgentHealth(serviceClient, agentId, 'active', { passed: true, latency_ms })
} else {
  await updateAgentHealth(serviceClient, agentId, 'reviewing', {
    passed: false, reason: 'http_error', status_code: res.status, ...
  })
}
```

### F2 — Detección de timeout

```typescript
// CÓDIGO ACTUAL (frágil)
const isTimeout = latency_ms >= 4_900

// CORRECCIÓN
const isTimeout = err instanceof DOMException && err.name === 'TimeoutError'
// Alternativa compatible con más entornos:
// const isTimeout = (err as any)?.name === 'TimeoutError' || (err as any)?.name === 'AbortError'
```

### F3 — Campo `status` ausente en 201

```typescript
// CÓDIGO ACTUAL (incompleto)
{
  message: 'Agent registered. Verifying...',
  health_check: { pending: true },
  status_url: `GET /api/v1/agents/${agent.slug}/status`,
}

// CORRECCIÓN
{
  message: 'Agent registered. Verifying...',
  status: 'reviewing',        // ← faltaba
  health_check: { pending: true },
  status_url: `GET /api/v1/agents/${agent.slug}/status`,
}
```

---

## Veredicto

### REQUIERE CORRECCIÓN

**3 hallazgos bloqueantes (HIGH):**
- **F1** — La condición de éxito del probe acepta respuestas 3xx/4xx como "alive", violando AC2 y AC10.
- **F2** — La detección de timeout por latencia es heurística e incorrecta; se debe inspeccionar el tipo de error.
- **F3** — La respuesta 201 omite `status: "reviewing"`, incumpliendo AC1 directamente.

**Correcciones menores recomendadas (MEDIUM/LOW):**
- F4: Considerar cancelación de probe previo antes de lanzar re-probe (o idempotency check).
- F5: Clarificar en SDD si `{ pending: true }` viola AC6 o es estado previo a "primera verificación".
- F6: Documentar que SSRF blocked actualiza `last_checked_at`.
