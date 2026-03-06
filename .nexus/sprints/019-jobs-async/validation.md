# Validation Report — WAS-70: Jobs Asíncronos

**Fecha:** 2026-03-02  
**Reviewer:** Adversary + QA (San / NexusAgil)  
**Story File:** `story-WAS-70.md`  
**Quality Gate:** `npx tsc --noEmit` → ✅ 0 errores

---

## Code Review

### 1. Patrones consistentes con el codebase

| Check | Resultado |
|-------|-----------|
| `createClient()` en POST /api/v1/jobs (auth usuario) | ✅ `route.ts:8` |
| `createServiceClient()` en process/[id] (bypass RLS) | ✅ `process/[id]/route.ts:8` |
| `AbortSignal.timeout(parseInt(env ?? 'default'))` | ✅ `process/[id]/route.ts:88` — mismo patrón que `compose/route.ts` |
| Imports via `@/lib/*` | ✅ Todos los imports usan `@/lib/` |
| `void triggerAgentEvent(...)` (best-effort, sin await) | ✅ `process/[id]/route.ts:106, 131` |
| Rate limiting con `checkRateLimit` + `Ratelimit` de Upstash | ✅ `route.ts:6,7,11-19` — patrón compartido |

### 2. Sin `any` explícito

- `route.ts` → ✅ Sin `any`. Tipos: `CreateJobRequest`, `CreateJobResponse` (satisfies)
- `process/[id]/route.ts` → ✅ Sin `any`. Tipos: `JobRow`, `AgentRow`, `ProcessJobResponse` (satisfies), `Record<string, unknown>`, `err instanceof Error`
- `events.ts` → ✅ Sin `any`

### 3. Funciones cortas, responsabilidad única

- `POST /api/v1/jobs` (~65 líneas): Auth → RateLimit → Parse → Validate → Verify Agent → Insert → Return 201. ✅ Secuencial, sin lógica mezclada.
- `getJobsLimit()` → función de fábrica aislada. ✅
- `POST /api/v1/jobs/process/[id]` (~110 líneas): Flujo complejo por naturaleza (claim atómico + fetch externo + bifurcación OK/error). Aceptable para un processor. ✅
- `events.ts` → solo exporta constante y tipo. ✅

### 4. Sin código duplicado

- La actualización a `'failed'` se repite en 2 ramas (agent not found + error de fetch) — **MENOR**: podría extraerse a helper `markFailed()`, pero no es bloqueante dado que el contexto difiere ligeramente entre ambas.
- No hay duplicación de lógica de auth ni de parsing.

### Veredicto CR: **APPROVED** (1 sugerencia menor, no bloqueante)

**SUGERENCIA (no bloqueante):** En `process/[id]/route.ts` extraer la actualización a `'failed'` en una función interna para reducir repetición (~10 líneas duplicadas en líneas ~68–73 y ~127–130).

---

## F4 QA — Acceptance Criteria

| AC | Criterio | Evidencia | Estado |
|----|----------|-----------|--------|
| AC-01 | WHEN usuario autenticado → POST /api/v1/jobs con agent válido → 201 + `{jobId, status:'pending', createdAt}` | `route.ts:62-73` — insert + return 201 satisfies CreateJobResponse | ✅ CUMPLE |
| AC-02 | IF agent_slug no existe o status !== 'active' → 404 `{error:'Agent not found'}` | `route.ts:52-55` — `if (agentError \|\| !agent \|\| agent.status !== 'active')` | ✅ CUMPLE |
| AC-03 | IF body omite agent_slug o input → 400 | `route.ts:42-44` — validación `!body.agent_slug \|\| body.input === undefined \|\| null` | ✅ CUMPLE |
| AC-04 | IF usuario no autenticado → 401 | `route.ts:34-36` — `if (!user) return 401` | ✅ CUMPLE |
| AC-05 | WHEN secret correcto + job pending → processing → completed/failed | `process/[id]/route.ts:39-48` (claim atómico) + líneas 85-135 (fetch + update) | ✅ CUMPLE |
| AC-06 | WHEN job completa → webhook `job.completed` (best-effort) | `process/[id]/route.ts:104-112` — `void triggerAgentEvent('job.completed', ...)` | ✅ CUMPLE |
| AC-07 | WHEN job falla → webhook `job.failed` + error en columna `error` | `process/[id]/route.ts:127-135` — `void triggerAgentEvent('job.failed', ...)` + update con `error: errorMessage` | ✅ CUMPLE |
| AC-08 | IF process/[id] sobre job status !== 'pending' → 409 | `process/[id]/route.ts:50-53` — UPDATE WHERE eq('status','pending'), si updated.length===0 → 409 (claim atómico previene doble ejecución) | ✅ CUMPLE |
| AC-09 | IF Authorization inválido/ausente en process/[id] → 401 | `process/[id]/route.ts:30-33` — `authHeader !== 'Bearer ${expectedSecret}'` → 401 | ✅ CUMPLE |

**QA Score: 9/9 PASS**

---

## events.ts

- `'job.completed'` agregado: ✅ `events.ts:5`
- `'job.failed'` agregado: ✅ `events.ts:6`
- Resto del archivo sin modificar: ✅

---

## Quality Gate

```
npx tsc --noEmit → 0 errores ✅
```

---

## Resumen Final

| | Resultado |
|-|-----------|
| Code Review | **APPROVED** (1 sugerencia menor) |
| QA ACs | **9/9 PASS** |
| TypeScript | **0 errores** |
| events.ts | **Correcto** |
| Archivos prohibidos modificados | **Ninguno** |
