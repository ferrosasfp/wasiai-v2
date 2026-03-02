# SDD NNN-019 — WAS-70: Jobs Asíncronos
**Sprint:** 15 | **Fase:** F2 — Software Design Document  
**Autor:** Architect (NexusAgil) | **Fecha:** 2026-03-02  
**Estado:** DRAFT

---

## 1. Contexto

### Qué existe
- Tabla `jobs` definida en `028_async_jobs.sql`: `id, user_id, agent_slug, status (pending|processing|completed|failed), input, result, error, created_at, updated_at, completed_at`
- RLS activo: `users_own_jobs` — solo el owner puede consultar
- `GET /api/v1/jobs/[id]` en `src/app/api/v1/jobs/[id]/route.ts` — retorna estado del job con campos: `jobId, status, result?, error?, createdAt, updatedAt, completedAt?`
- Sistema de webhooks: `triggerAgentEvent(event, agentId, creatorId, data)` en `src/lib/webhooks/triggerAgentEvent.ts`
- `WebhookEvent` solo incluye: `'agent.invoked' | 'agent.error' | 'credits.low'` — **falta** `job.completed` y `job.failed`

### Qué falta
- `POST /api/v1/jobs` — encolar un job nuevo
- `POST /api/v1/jobs/process/[id]` — ejecutar el job en background (llamar al agente, actualizar tabla, disparar webhook)
- Extensión de `WebhookEvent` con `job.completed` y `job.failed`
- No se requiere nueva migración — tabla ya existe

---

## 2. Archivos a crear/modificar

| Acción | Path |
|--------|------|
| CREAR | `src/app/api/v1/jobs/route.ts` |
| CREAR | `src/app/api/v1/jobs/process/[id]/route.ts` |
| MODIFICAR | `src/lib/webhooks/events.ts` |
| NO TOCAR | `src/app/api/v1/jobs/[id]/route.ts` |
| NO TOCAR | `supabase/migrations/028_async_jobs.sql` |

---

## 3. Interfaces TypeScript

Basadas en código existente (`jobs/[id]/route.ts`, `triggerAgentEvent.ts`):

```typescript
// POST /api/v1/jobs — Request body
interface CreateJobRequest {
  agent_slug: string
  input: Record<string, unknown>
}

// POST /api/v1/jobs — Response (201)
interface CreateJobResponse {
  jobId: string
  status: 'pending'
  createdAt: string
}

// POST /api/v1/jobs/process/[id] — Response (200)
interface ProcessJobResponse {
  jobId: string
  status: 'completed' | 'failed'
  completedAt: string
}

// Extensión de WebhookEvent (src/lib/webhooks/events.ts)
export const WEBHOOK_EVENTS = [
  'agent.invoked',
  'agent.error',
  'credits.low',
  'job.completed',   // NUEVO
  'job.failed',      // NUEVO
] as const
export type WebhookEvent = typeof WEBHOOK_EVENTS[number]

// Payload del webhook job.completed
interface JobCompletedPayload {
  job_id: string
  agent_slug: string
  user_id: string
  result: Record<string, unknown>
  completed_at: string
}

// Payload del webhook job.failed
interface JobFailedPayload {
  job_id: string
  agent_slug: string
  user_id: string
  error: string
  failed_at: string
}
```

---

## 4. Diseño de endpoints

### `POST /api/v1/jobs`
**Auth:** `createClient()` — usuario autenticado via sesión (mismo patrón que `GET /api/v1/jobs/[id]`)

**Flujo:**
1. Verificar auth (`supabase.auth.getUser()`)
2. Parsear body: `{ agent_slug, input }`
3. Validar que `agent_slug` existe en tabla `agents` y `status = 'active'`
4. Insertar row en `jobs` con `status = 'pending'`, `user_id`, `agent_slug`, `input`
5. Retornar `201 { jobId, status: 'pending', createdAt }`

**No dispara el procesamiento** — el cliente llama a `process/[id]` por separado (o se usa desde `NNN-021` como toggle async).

---

### `POST /api/v1/jobs/process/[id]`
**Auth:** Service key (solo llamado desde el mismo servidor o cron) — usar `createServiceClient()`  
**Proteger con:** `Authorization: Bearer ${process.env.JOB_PROCESSOR_SECRET}` header check

**Flujo:**
1. Verificar header secret
2. Leer job por `id` con `createServiceClient()` (bypass RLS)
3. Si `status !== 'pending'` → retornar 409 `{ error: 'Job already processed' }`
4. Update `status = 'processing'`, `updated_at = now()`
5. Obtener agente: `agents.select('endpoint_url, id').eq('slug', job.agent_slug)`
6. Llamar al agente externo via `fetch(endpoint_url, { method: 'POST', body: JSON.stringify({ input: job.input }) })`
7. Si respuesta OK:
   - Update `jobs` → `status = 'completed'`, `result = response_json`, `completed_at = now()`
   - `triggerAgentEvent('job.completed', agent.id, agent.user_id, { job_id, agent_slug, user_id: job.user_id, result, completed_at })`
8. Si error:
   - Update `jobs` → `status = 'failed'`, `error = message`, `completed_at = now()`
   - `triggerAgentEvent('job.failed', agent.id, agent.user_id, { job_id, agent_slug, user_id: job.user_id, error, failed_at })`
9. Retornar `200 { jobId, status, completedAt }`

---

## 5. Migraciones

**Ninguna** — tabla `jobs` ya existe en `028_async_jobs.sql`.

Solo modificación de código en `src/lib/webhooks/events.ts` para agregar los dos nuevos eventos.

---

## 6. Acceptance Criteria (EARS)

| # | Formato | AC |
|---|---------|-----|
| AC-01 | WHEN | WHEN un usuario autenticado envía `POST /api/v1/jobs` con `agent_slug` válido e `input`, SHALL crear un job con `status = 'pending'` y retornar `201` con `jobId`. |
| AC-02 | IF | IF el `agent_slug` no existe o no está activo, SHALL retornar `404 { error: 'Agent not found' }`. |
| AC-03 | WHEN | WHEN se llama `POST /api/v1/jobs/process/[id]` con el secret correcto y el job está en `pending`, SHALL actualizar el job a `processing`, luego a `completed` o `failed`. |
| AC-04 | WHEN | WHEN el job completa exitosamente, SHALL disparar webhook `job.completed` via `triggerAgentEvent`. |
| AC-05 | WHEN | WHEN el job falla (timeout o error upstream), SHALL disparar webhook `job.failed` y registrar el mensaje de error en la columna `error`. |
| AC-06 | IF | IF `POST /api/v1/jobs/process/[id]` se llama sobre un job con `status !== 'pending'`, SHALL retornar `409 { error: 'Job already processed' }`. |
| AC-07 | IF | IF el header de autorización es inválido o ausente en `process/[id]`, SHALL retornar `401`. |

---

## 7. Dependencias

| Dirección | HU | Detalle |
|-----------|-----|---------|
| Depende de | WAS-74 (ya merged) | `triggerAgentEvent` ya existe — solo extender `WebhookEvent` |
| Requerido por | NNN-021 WAS-38 | El toggle sync/async en UI usa `POST /api/v1/jobs` |

---

## 8. Constraint Directives

### OBLIGATORIO
- Usar `createClient()` (user auth) en `POST /api/v1/jobs`
- Usar `createServiceClient()` (bypass RLS) en `POST /api/v1/jobs/process/[id]`
- Proteger `process/[id]` con secret env var (`JOB_PROCESSOR_SECRET`)
- Timeout al agente externo: `AbortSignal.timeout(parseInt(process.env.COMPOSE_STEP_TIMEOUT_MS ?? '8000'))` — reusar constante del compose
- `triggerAgentEvent` es best-effort (no bloquea response)

### PROHIBIDO
- No crear nueva migración de base de datos
- No modificar `GET /api/v1/jobs/[id]/route.ts`
- No usar `ethers` — si se necesita firma, usar `viem` o patrón de `signReceipt`
- No hardcodear URLs, timeouts ni secrets

---

## 9. Implementation Readiness Check

- [x] Tabla `jobs` verificada en `028_async_jobs.sql`
- [x] `GET /api/v1/jobs/[id]` leído — patrón de auth conocido
- [x] `triggerAgentEvent` signatura verificada: `(event, agentId, creatorId, data)`
- [x] `WebhookEvent` ubicada en `src/lib/webhooks/events.ts` — extensión clara
- [x] Patrón de `createServiceClient` presente en `compose/route.ts`
- [x] Timeout y fetch pattern tomados de `compose/route.ts` líneas 180-200
