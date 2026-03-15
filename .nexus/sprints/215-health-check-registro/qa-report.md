# QA Report — SDD #215
**Verifier:** NexusAgil QA v1.3  
**Commits:** `3dff698` (feat base) + `a443dd3` (6 fixes post-audit)  
**Date:** 2026-03-14  

---

## AC Verification

| AC | Status | Evidencia (archivo:línea) |
|----|--------|--------------------------|
| AC1 | ✅ PASS | `register/route.ts:262-267` — `health_check: { pending: true }` + fire-and-forget `probeEndpoint()`; `register/route.ts:288-295` — spread `status: 'reviewing'`, `health_check: { pending: true }`, `status_url`; HTTP 201 ✓ |
| AC2 | ✅ PASS | `health-probe.ts:43` — `if (res.ok)` → `updateAgentHealth(…, 'active', { passed: true, latency_ms })`; `health-probe.ts:76-81` — `last_checked_at: new Date().toISOString()` en `updateAgentHealth` |
| AC3 | ✅ PASS | `health-probe.ts:49-55` — rama `http_error`: `status=reviewing`, `passed:false`, `reason`, `message`, `fix`; `health-probe.ts:58-67` — rama `timeout`/`connection_error`: mismos campos; `last_checked_at` siempre actualizado vía `updateAgentHealth` |
| AC4 | ✅ PASS | `status/route.ts:47-55` — respuesta `{ slug, status, health_check, last_checked_at }` para key válida del owner |
| AC5 | ⚠️ DELTA | Key inválida/inactiva → `status/route.ts:22` retorna **401** ✓; key de otro owner → `status/route.ts:43-45` retorna **404** (IDOR fix F5, post-audit). El SDD dice 401 pero el fix deliberado usa 404. Ver nota abajo. |
| AC6 | ✅ PASS | `status/route.ts:49-50` — `health_check: agent.health_check ?? null`, `last_checked_at: agent.last_checked_at ?? null`; `057_agents_health_check.sql:14-15` — columnas sin DEFAULT → NULL por defecto |
| AC7 | ✅ PASS | `creator/agents/[slug]/route.ts:74` — `if (result.data.endpoint_url)` → cooldown check → `probeEndpoint()` fire-and-forget |
| AC8 | ❌ FAIL | `register/route.ts:270-272` — rama `else { status: 'draft' }` es **código muerto**: `RegisterAgentSchema` (línea ~44) tiene `endpoint_url: z.string().url()` **requerido** (sin `.optional()`). Un registro sin `endpoint_url` falla con 422 antes de llegar al else. La lógica de draft nunca se ejecuta. |
| AC9 | ✅ PASS | `health-probe.ts:24-32` — `validateEndpointUrlAsync(endpointUrl)` antes del fetch; catch → `updateAgentHealth(…, { passed: false, reason: 'ssrf_blocked' })` |
| AC10 | ✅ PASS | `health-probe.ts:57` — `isTimeout = err instanceof DOMException && err.name === 'TimeoutError'` → `reason: 'timeout'`; `health-probe.ts:50` — `reason: 'http_error', status_code: res.status`; `health-probe.ts:64` — `reason: 'connection_error'` |

---

## Fix Verification

| Fix | Status | Evidencia |
|-----|--------|-----------|
| F1: `if (res.ok)` solo 2xx | ✅ PASS | `health-probe.ts:43` — `if (res.ok) {` reemplaza lógica anterior de status check |
| F2: `err instanceof DOMException && err.name === 'TimeoutError'` | ✅ PASS | `health-probe.ts:57` — detección correcta de AbortSignal timeout |
| F3: `status: "reviewing"` en 201 response | ✅ PASS | `register/route.ts:288-290` — spread `...(authMethod !== 'jwt' && { status: agent.endpoint_url ? 'reviewing' : 'draft' })` |
| F4: cooldown 60s en re-probe PATCH | ✅ PASS | `creator/agents/[slug]/route.ts:76-78` — `cooldownMs = 60_000`; `if (Date.now() - lastChecked >= cooldownMs)` |
| F5: IDOR fix — 404 cuando no es owner | ✅ PASS | `status/route.ts:43-45` — `if (!agent \|\| keyRecord.owner_id !== agent.creator_id) → 404` |
| F6: Rate limit en GET /status | ✅ PASS | `status/route.ts:26-29` — `checkRateLimit(getStatusCheckLimit(), identifier)`; `ratelimit.ts` — `getStatusCheckLimit()` = 60 req/min sliding window |

---

## Regresiones

| Archivo | Descripción |
|---------|-------------|
| `register/route.ts` | AC8: `endpoint_url` es campo **requerido** en `RegisterAgentSchema` (sin `.optional()`). La rama `else { status: 'draft' }` nunca ejecuta. Esto no es regresión nueva sino un gap de implementación del feat base que el fix post-audit no corrigió. |

---

## Notas

**AC5 — DELTA spec/impl (no bloqueante):**  
El SDD especifica `401` para key de otro owner, pero F5 (post-audit) implementa `404` para prevenir IDOR/enumeración de agentes. La elección de `404` es más segura (no revela existencia del recurso). Se recomienda actualizar el SDD para alinear con la implementación. No se considera FAIL ya que el fix fue deliberado y aprobado en el audit.

---

## Veredicto

**QA_FAIL**

---

## Issues

### ISSUE-01 — AC8: Dead code, draft status inaccesible vía POST /register
- **Severidad:** Media  
- **Archivo:** `src/app/api/v1/agents/register/route.ts`  
- **Descripción:** `endpoint_url` está definido como requerido en `RegisterAgentSchema` (`z.string().url()`). Cualquier request sin `endpoint_url` (o con valor null/vacío) falla con HTTP 422 en validación Zod, nunca alcanzando el bloque de inserción. La rama `else { status: 'draft' }` en línea ~272 es código muerto.  
- **Fix sugerido:** Hacer `endpoint_url` opcional en el schema: `endpoint_url: z.string().url().optional()`, y ajustar la validación SSRF para que solo se ejecute cuando `endpoint_url` está presente.  
- **Impacto:** Agentes no pueden registrarse en modo draft sin endpoint. Funcionalidad del AC8 no disponible.

### ISSUE-02 — AC5: Spec/impl delta (recomendación de documentación)
- **Severidad:** Baja  
- **Descripción:** SDD dice 401 para key de otro owner; implementación retorna 404 (IDOR fix). Actualizar SDD o agregar nota de diseño.  
- **Fix sugerido:** Actualizar AC5 en SDD: "key inválida → 401; key válida de otro owner → 404 (IDOR prevention)".
