# Story WAS-70: Jobs Asíncronos — POST /api/v1/jobs + Processor

**Status:** ready-for-dev  
**Sprint:** 15 | **Épica:** Epic 15 — Async Execution  
**Prioridad:** P1 | **Estimación:** M (~3–4 horas)  
**Dependencias:** WAS-74 (triggerAgentEvent — ya merged)

---

## Historia de usuario

Como desarrollador que integra WasiAI, quiero poder encolar un job asíncrono y procesarlo en background, para que las invocaciones de agentes de larga duración no bloqueen mi request HTTP.

---

## Contexto — qué existe hoy

| Archivo | Estado |
|---------|--------|
| `supabase/migrations/028_async_jobs.sql` | ✅ Existe — tabla `jobs` con cols: `id, user_id, agent_slug, status, input, result, error, created_at, updated_at, completed_at` |
| `src/app/api/v1/jobs/[id]/route.ts` | ✅ Existe — `GET` retorna estado del job. **NO TOCAR** |
| `src/lib/webhooks/triggerAgentEvent.ts` | ✅ Existe — signatura: `triggerAgentEvent(event, agentId, creatorId, data)` |
| `src/lib/webhooks/events.ts` | ✅ Existe — `WebhookEvent` tipo unión. Le **falta** `job.completed` y `job.failed` |
| `src/app/api/v1/compose/route.ts` | ✅ Existe — patrón `createServiceClient()` y `AbortSignal.timeout()` a reutilizar |

**RLS activo:** `users_own_jobs` — solo el owner puede consultar.  
**No se requiere nueva migración.**

---

## Archivos a crear/modificar

| Acción | Path |
|--------|------|
| CREAR | `src/app/api/v1/jobs/route.ts` |
| CREAR | `src/app/api/v1/jobs/process/[id]/route.ts` |
| MODIFICAR | `src/lib/webhooks/events.ts` |
| **NO TOCAR** | `src/app/api/v1/jobs/[id]/route.ts` |
| **NO TOCAR** | `supabase/migrations/028_async_jobs.sql` |

---

## Interfaces TypeScript

> Basadas en código existente — no inventar tipos nuevos.

```typescript
// POST /api/v1/jobs — Request body
interface CreateJobRequest {
  agent_slug: string
  input: Record<string, unknown>
}

// POST /api/v1/jobs — Response 201
interface CreateJobResponse {
  jobId: string
  status: 'pending'
  createdAt: string
}

// POST /api/v1/jobs/process/[id] — Response 200
interface ProcessJobResponse {
  jobId: string
  status: 'completed' | 'failed'
  completedAt: string
}

// Extensión de WebhookEvent en src/lib/webhooks/events.ts
// AGREGAR los dos nuevos valores al array WEBHOOK_EVENTS existente:
// 'job.completed'
// 'job.failed'

// Payload job.completed
interface JobCompletedPayload {
  job_id: string
  agent_slug: string
  user_id: string
  result: Record<string, unknown>
  completed_at: string
}

// Payload job.failed
interface JobFailedPayload {
  job_id: string
  agent_slug: string
  user_id: string
  error: string
  failed_at: string
}
```

---

## Diseño de endpoints

### `POST /api/v1/jobs`
**Auth:** `createClient()` — usuario autenticado via sesión (mismo patrón que `GET /api/v1/jobs/[id]`)

**Flujo paso a paso:**
1. `supabase.auth.getUser()` → si no auth → 401
2. Parsear body: `{ agent_slug, input }` — si falta alguno → 400
3. `agents.select('id, status').eq('slug', agent_slug).single()` → si no existe o `status !== 'active'` → 404 `{ error: 'Agent not found' }`
4. `jobs.insert({ user_id, agent_slug, input, status: 'pending' }).select('id, created_at').single()`
5. Retornar `201 { jobId: row.id, status: 'pending', createdAt: row.created_at }`

**Este endpoint NO dispara el procesamiento** — el cliente llama a `process/[id]` por separado.

---

### `POST /api/v1/jobs/process/[id]`
**Auth:** Service key (bypass RLS) via `createServiceClient()`  
**Proteger con:** header `Authorization: Bearer ${process.env.JOB_PROCESSOR_SECRET}`

**Flujo paso a paso:**
1. Verificar `request.headers.get('authorization') === Bearer ${process.env.JOB_PROCESSOR_SECRET}` → si inválido → 401
2. `serviceClient.from('jobs').select('*').eq('id', id).single()` → si no existe → 404
3. Si `job.status !== 'pending'` → 409 `{ error: 'Job already processed' }`
4. Update `status = 'processing'`, `updated_at = now()`
5. `agents.select('id, endpoint_url, user_id').eq('slug', job.agent_slug).single()`
6. `fetch(agent.endpoint_url, { method: 'POST', body: JSON.stringify({ input: job.input }), signal: AbortSignal.timeout(parseInt(process.env.COMPOSE_STEP_TIMEOUT_MS ?? '8000')) })`
7. **Si OK:**
   - Update `jobs`: `status = 'completed'`, `result = responseJson`, `completed_at = now()`
   - `triggerAgentEvent('job.completed', agent.id, agent.user_id, { job_id: id, agent_slug: job.agent_slug, user_id: job.user_id, result: responseJson, completed_at })`  ← best-effort, no await
   - Retornar `200 { jobId: id, status: 'completed', completedAt }`
8. **Si error/timeout:**
   - Update `jobs`: `status = 'failed'`, `error = errorMessage`, `completed_at = now()`
   - `triggerAgentEvent('job.failed', agent.id, agent.user_id, { job_id: id, agent_slug: job.agent_slug, user_id: job.user_id, error: errorMessage, failed_at: completedAt })`  ← best-effort
   - Retornar `200 { jobId: id, status: 'failed', completedAt }`

---

## Cambio en `src/lib/webhooks/events.ts`

Agregar `'job.completed'` y `'job.failed'` al array `WEBHOOK_EVENTS` existente.  
**No cambiar** el resto del archivo.

```typescript
// ANTES (ejemplo de lo que existe):
export const WEBHOOK_EVENTS = [
  'agent.invoked',
  'agent.error',
  'credits.low',
] as const

// DESPUÉS:
export const WEBHOOK_EVENTS = [
  'agent.invoked',
  'agent.error',
  'credits.low',
  'job.completed',  // NUEVO
  'job.failed',     // NUEVO
] as const

export type WebhookEvent = typeof WEBHOOK_EVENTS[number]
```

---

## Acceptance Criteria (EARS)

| # | Tipo | Criterio |
|---|------|---------|
| AC-01 | WHEN | WHEN un usuario autenticado envía `POST /api/v1/jobs` con `agent_slug` válido e `input`, SHALL crear un job con `status = 'pending'` y retornar `201` con `{ jobId, status, createdAt }`. |
| AC-02 | IF | IF el `agent_slug` no existe o su `status !== 'active'`, SHALL retornar `404 { error: 'Agent not found' }`. |
| AC-03 | IF | IF el body de `POST /api/v1/jobs` omite `agent_slug` o `input`, SHALL retornar `400`. |
| AC-04 | IF | IF el usuario no está autenticado en `POST /api/v1/jobs`, SHALL retornar `401`. |
| AC-05 | WHEN | WHEN se llama `POST /api/v1/jobs/process/[id]` con el secret correcto y el job está en `status = 'pending'`, SHALL actualizar a `processing`, luego a `completed` o `failed` según resultado del agente externo. |
| AC-06 | WHEN | WHEN el job completa exitosamente, SHALL disparar webhook `job.completed` via `triggerAgentEvent` (best-effort, no bloquea response). |
| AC-07 | WHEN | WHEN el job falla (timeout o error del agente externo), SHALL disparar webhook `job.failed` y registrar el mensaje en la columna `error`. |
| AC-08 | IF | IF `POST /api/v1/jobs/process/[id]` se llama sobre un job con `status !== 'pending'`, SHALL retornar `409 { error: 'Job already processed' }`. |
| AC-09 | IF | IF el header `Authorization` es inválido o ausente en `process/[id]`, SHALL retornar `401`. |

---

## Restricciones

### OBLIGATORIO
- `createClient()` en `POST /api/v1/jobs` (auth de usuario)
- `createServiceClient()` en `process/[id]` (bypass RLS)
- `JOB_PROCESSOR_SECRET` como env var — verificar header, nunca hardcodear
- Timeout al agente: `AbortSignal.timeout(parseInt(process.env.COMPOSE_STEP_TIMEOUT_MS ?? '8000'))` — mismo patrón que `compose/route.ts`
- `triggerAgentEvent` es best-effort — no usar `await` en el disparo del webhook
- Sin `any` — todos los tipos explícitos
- Imports via `@/lib/*` o `@/app/*`

### PROHIBIDO
- No crear nueva migración de base de datos
- No modificar `src/app/api/v1/jobs/[id]/route.ts`
- No usar `ethers` — si se necesita firma usar `viem`
- No hardcodear URLs, timeouts ni secrets
- No dependencias npm nuevas

---

## Definition of Done

- [ ] `POST /api/v1/jobs` con agent_slug válido retorna `201 { jobId, status: 'pending', createdAt }` ✓
- [ ] `POST /api/v1/jobs` con agent inexistente retorna `404 { error: 'Agent not found' }` ✓
- [ ] `POST /api/v1/jobs/process/[id]` con secret correcto + job pending → job se procesa y queda `completed` o `failed` ✓
- [ ] `POST /api/v1/jobs/process/[id]` sin secret → `401` ✓
- [ ] `POST /api/v1/jobs/process/[id]` sobre job ya procesado → `409` ✓
- [ ] Webhook `job.completed` disparado cuando job termina bien ✓
- [ ] Webhook `job.failed` disparado cuando job falla ✓
- [ ] `src/lib/webhooks/events.ts` incluye `job.completed` y `job.failed` ✓
- [ ] `npm run build` sin errores TypeScript ni ESLint ✓
- [ ] Sin `any` en el código nuevo ✓
- [ ] `git push origin master && git push origin master:main` ✓

---

## Dev Agent Record

### Agent Model Used
_(completar al implementar)_

### Completion Notes
_(completar al implementar)_

### File List
- `src/app/api/v1/jobs/route.ts` — CREAR
- `src/app/api/v1/jobs/process/[id]/route.ts` — CREAR
- `src/lib/webhooks/events.ts` — MODIFICAR
