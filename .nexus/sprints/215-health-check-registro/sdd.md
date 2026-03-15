# SDD #215: Health check automático al registrar agente

> SPEC_APPROVED: yes — 2026-03-14
> Fecha: 2026-03-14
> Tipo: feature
> SDD_MODE: full
> Branch: feature/215-health-check-registro
> Artefactos: .nexus/sprints/215-health-check-registro/

---

## 1. Resumen

Al registrar un agente, WasiAI lanza un health check **async (fire-and-forget)** al `endpoint_url` y responde 201 inmediatamente con `status: reviewing` + `status_url`. El probe corre en background (5s timeout), actualiza la DB con el resultado y cambia el status a `active` si pasa. El agente consulta `GET /api/v1/agents/:slug/status` para saber el resultado.

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | WAS-215 |
| **Tipo** | feature |
| **SDD_MODE** | full |
| **Objetivo** | Activación automática de agentes sin intervención humana |
| **Reglas de negocio** | El probe es async — el 201 siempre responde en ~300ms. El agente usa GET /status para saber si quedó activo. |
| **Scope IN** | Async probe en register, GET /api/v1/agents/:slug/status, re-check en PATCH endpoint_url (creator route), migración DB |
| **Scope OUT** | Cron periódico, email, Verified badge, PATCH en API v1, rate limit de re-verificaciones |

### Acceptance Criteria (EARS)

- **AC1:** WHEN `POST /api/v1/agents/register` es exitoso, THE system SHALL lanzar un health check async al `endpoint_url` y retornar 201 inmediatamente con `status: "reviewing"`, `health_check: { pending: true }`, y `status_url`.
- **AC2:** WHEN el probe async recibe HTTP 2xx en <5s, THE system SHALL actualizar `agents.status = "active"`, `agents.health_check = { passed: true, latency_ms: N }`, `agents.last_checked_at = now()`.
- **AC3:** WHEN el probe async falla (timeout/non-2xx/connection error), THE system SHALL actualizar `agents.status = "reviewing"`, `agents.health_check = { passed: false, reason, message, fix }`, `agents.last_checked_at = now()`.
- **AC4:** WHEN `GET /api/v1/agents/:slug/status` es llamado con `x-agent-key` válida del owner, THE endpoint SHALL retornar `{ status, health_check, last_checked_at, slug }`.
- **AC5:** WHEN `GET /api/v1/agents/:slug/status` es llamado con key inválida o de otro owner, THE endpoint SHALL retornar 401.
- **AC6:** WHEN el agente nunca ha sido verificado, `health_check` SHALL ser `null` y `last_checked_at` SHALL ser `null`.
- **AC7:** WHEN `PATCH /api/creator/agents/:slug` recibe un nuevo `endpoint_url`, THE system SHALL lanzar un nuevo probe async. Si pasa → `status = active`. Si falla → `status = reviewing` con razón.
- **AC8:** WHEN `endpoint_url` es null/vacío/ausente en el registro, THE system SHALL registrar con `status = "draft"` y NO lanzar probe.
- **AC9:** WHEN el probe detecta SSRF (IP privada/localhost/dominio interno), THE system SHALL abortar el probe y registrar `health_check: { passed: false, reason: "ssrf_blocked" }` sin hacer fetch.
- **AC10:** WHEN el probe falla por timeout, `reason` SHALL ser `"timeout"`. Por non-2xx → `"http_error"` con `status_code`. Por conexión → `"connection_error"`.

### Esquema health_check (campo JSONB)
```typescript
// Pending (inmediato tras registro)
{ pending: true }

// Passed
{ passed: true, latency_ms: number }

// Failed
{
  passed: false,
  reason: "timeout" | "http_error" | "connection_error" | "ssrf_blocked",
  status_code?: number,  // solo para http_error
  message: string,
  fix: string            // "PATCH /api/v1/agents/:slug con nuevo endpoint_url"
}
```

---

## 3. Context Map

### Archivos leídos

| Archivo | Por qué | Patrón extraído |
|---------|---------|-----------------|
| `src/app/api/v1/agents/register/route.ts` | Archivo principal a modificar | Async on-chain ya usa fire-and-forget: `registerAgentOnChain().then().catch()` |
| `src/app/api/v1/agents/[slug]/health/route.ts` | Lógica de probe existente | `fetch(endpoint_url, { method: 'POST', body: '{"ping":true}', signal: AbortSignal.timeout(5000) })` |
| `src/lib/security/validateEndpointUrl.ts` | SSRF protection | `validateEndpointUrlAsync(url)` — async con DNS probe |
| `src/app/api/creator/agents/[slug]/route.ts` | PATCH de agentes | `serviceClient.from('agents').update({...}).eq('id', existing.id)` |
| `src/lib/supabase/server.ts` | Service client | `createServiceClient()` — bypasea RLS |

### Exemplar para probe function
| Para crear | Seguir patrón de | Razón |
|-----------|-----------------|-------|
| `probeEndpoint()` | `src/app/api/v1/agents/[slug]/health/route.ts` | Mismo fetch + AbortSignal.timeout(5000) |

### Estado de BD

| Tabla | Columna | Estado | Acción |
|-------|---------|--------|--------|
| `agents` | `status` | ✅ existe | No tocar |
| `agents` | `health_check` | ❌ no existe | **CREAR — JSONB nullable** |
| `agents` | `last_checked_at` | ❌ no existe | **CREAR — TIMESTAMPTZ nullable** |

### Componentes reutilizables
- `validateEndpointUrlAsync` en `validateEndpointUrl.ts` — SSRF check antes del probe
- `createServiceClient()` — para UPDATE de status después del probe (no hay sesión activa en async)
- Patrón fire-and-forget de `register/route.ts` línea ~289: `registerAgentOnChain({...}).then(async () => {...}).catch(err => ...)`

---

## 4. Diseño Técnico

### 4.1 Archivos a crear/modificar

| Operación | Archivo | Detalle |
|-----------|---------|---------|
| **CREAR** | `src/lib/agents/health-probe.ts` | Función `probeEndpoint(url, agentId)` — async, fire-and-forget |
| **CREAR** | `src/app/api/v1/agents/[slug]/status/route.ts` | GET endpoint — owner auth con x-agent-key |
| **MODIFICAR** | `src/app/api/v1/agents/register/route.ts` | Llamar `probeEndpoint()` async tras insert |
| **MODIFICAR** | `src/app/api/creator/agents/[slug]/route.ts` | Llamar `probeEndpoint()` async cuando endpoint_url cambia |
| **CREAR** | `supabase/migrations/057_agents_health_check.sql` | Migración DB — DROP legacy + ADD JSONB |

### 4.2 Migración DB (057_agents_health_check.sql)

Migration 047 creó `last_health_check_ok` (BOOLEAN) y `last_health_check_at` (TIMESTAMPTZ).
Esta migración las reemplaza con columnas JSONB más expresivas.

```sql
-- 057_agents_health_check.sql
-- Replace legacy boolean health check columns with JSONB

-- Drop legacy index first
DROP INDEX IF EXISTS idx_agents_health_check;

-- Drop legacy columns
ALTER TABLE agents
  DROP COLUMN IF EXISTS last_health_check_ok,
  DROP COLUMN IF EXISTS last_health_check_at;

-- Add new columns
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS health_check JSONB,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;

-- New index
CREATE INDEX IF NOT EXISTS idx_agents_last_checked
  ON agents(last_checked_at)
  WHERE last_checked_at IS NOT NULL;
```

### 4.3 Función probeEndpoint (src/lib/agents/health-probe.ts)

```typescript
import { createServiceClient } from '@/lib/supabase/server'
import { validateEndpointUrlAsync } from '@/lib/security/validateEndpointUrl'

interface ProbeResult {
  passed: boolean
  latency_ms?: number
  reason?: 'timeout' | 'http_error' | 'connection_error' | 'ssrf_blocked'
  status_code?: number
  message?: string
}

export async function probeEndpoint(endpointUrl: string, agentId: string): Promise<void> {
  const serviceClient = createServiceClient()
  let result: ProbeResult

  // AC9: SSRF check primero
  try {
    await validateEndpointUrlAsync(endpointUrl)
  } catch {
    result = {
      passed: false,
      reason: 'ssrf_blocked',
      message: 'Endpoint URL is not publicly reachable.',
      fix: 'Use a publicly accessible HTTPS URL.',
    }
    await updateAgentHealth(serviceClient, agentId, 'reviewing', result)
    return
  }

  // AC10: Probe con timeout 5s
  const start = Date.now()
  try {
    // Use {"ping":true} — same format as GET /api/v1/agents/:slug/health (compatibility)
    const res = await fetch(endpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ping: true }),
      signal: AbortSignal.timeout(5_000),
    })
    const latency_ms = Date.now() - start

    if (res.ok || res.status < 500) {
      // AC2: passed
      result = { passed: true, latency_ms }
      await updateAgentHealth(serviceClient, agentId, 'active', result)
    } else {
      // AC10: http_error
      result = {
        passed: false,
        reason: 'http_error',
        status_code: res.status,
        message: `Endpoint returned HTTP ${res.status}.`,
        fix: 'Ensure your endpoint returns HTTP 2xx for POST requests.',
      }
      await updateAgentHealth(serviceClient, agentId, 'reviewing', result)
    }
  } catch (err) {
    const latency_ms = Date.now() - start
    // AC10: timeout vs connection_error
    const isTimeout = latency_ms >= 4_900
    result = {
      passed: false,
      reason: isTimeout ? 'timeout' : 'connection_error',
      message: isTimeout
        ? 'Endpoint did not respond within 5 seconds.'
        : 'Could not connect to the endpoint.',
      fix: 'Verify your endpoint is publicly accessible and responds within 5s.',
    }
    await updateAgentHealth(serviceClient, agentId, 'reviewing', result)
  }
}

async function updateAgentHealth(
  serviceClient: ReturnType<typeof createServiceClient>,
  agentId: string,
  status: 'active' | 'reviewing',
  healthCheck: ProbeResult,
) {
  await serviceClient
    .from('agents')
    .update({
      status,
      health_check: healthCheck,
      last_checked_at: new Date().toISOString(),
    })
    .eq('id', agentId)
}
```

### 4.4 Cambios en register/route.ts

Después del insert exitoso del agente, antes del response:

```typescript
// AC1: Probe solo para auth no-JWT (agent_key / open)
// JWT-auth creators son confiables → status ya es 'active' (sin cambio)
if (authMethod !== 'jwt') {
  if (agent.endpoint_url) {
    // Fire-and-forget — no await
    await serviceClient.from('agents')
      .update({ health_check: { pending: true } })
      .eq('id', agent.id)
    probeEndpoint(agent.endpoint_url, agent.id).catch(err =>
      console.error('[register] probe failed silently', { agentId: agent.id, err })
    )
  } else {
    // AC8: sin endpoint_url → draft
    await serviceClient.from('agents')
      .update({ status: 'draft' })
      .eq('id', agent.id)
  }
}
// JWT path: status ya es 'active' desde el agentPayload — no modificar

// En la respuesta 201, añadir:
{
  ...agentPayload,
  health_check: agent.endpoint_url ? { pending: true } : null,
  status_url: `GET /api/v1/agents/${agent.slug}/status`,
  message: agent.endpoint_url
    ? 'Agent registered. Verifying your endpoint... Check status_url in a few seconds.'
    : 'Agent registered as draft. Add an endpoint_url to activate.',
}
```

### 4.5 GET /api/v1/agents/:slug/status

```typescript
// Auth: x-agent-key del owner (mismo patrón que register con agentKey auth)
// Query: SELECT id, status, health_check, last_checked_at FROM agents WHERE slug = :slug
// Ownership: agent_keys.owner_id = agents.creator_id
// Response:
{
  slug,
  status,                  // active | reviewing | draft | paused
  health_check,            // null si nunca verificado
  last_checked_at,         // null si nunca verificado
  // Si reviewing:
  next_step: "Your endpoint is being verified. If still reviewing, update via PATCH /api/creator/agents/:slug"
}
```

### 4.6 Cambios en PATCH creator/agents/[slug]/route.ts

Al final del PATCH, si `result.data.endpoint_url` existe:

```typescript
if (result.data.endpoint_url) {
  // AC7: re-check async
  await serviceClient.from('agents')
    .update({ health_check: { pending: true }, status: 'reviewing' })
    .eq('id', existing.id)
  probeEndpoint(result.data.endpoint_url, existing.id).catch(err =>
    console.error('[patch] re-probe failed silently', err)
  )
}
```

---

## 5. Wave Plan

### Wave 0 — Pre-flight (Spec Reviewer)
- 0.1 Verificar que `validateEndpointUrlAsync` existe y es exportado en `validateEndpointUrl.ts`
- 0.2 Verificar patrón fire-and-forget en `register/route.ts` (~línea 289)
- 0.3 Verificar que `agents` table NO tiene `health_check` ni `last_checked_at` (migración necesaria)
- 0.4 Verificar que `src/app/api/v1/agents/[slug]/status/route.ts` NO existe
- 0.5 Verificar imports de `createServiceClient` en health-probe.ts son válidos

### Wave 1 — Migración DB
**Archivo:** `supabase/migrations/057_agents_health_check.sql`
**Tarea:** DROP columnas legacy (`last_health_check_ok`, `last_health_check_at`, índice asociado) y ADD nuevas (`health_check JSONB`, `last_checked_at TIMESTAMPTZ`)
**Build gate:** `npx tsc --noEmit`

### Wave 2 — probeEndpoint function
**Archivo:** `src/lib/agents/health-probe.ts` (CREAR)
**Tarea:** Implementar según sección 4.3
**Build gate:** `npx tsc --noEmit`

### Wave 3 — GET /api/v1/agents/:slug/status
**Archivo:** `src/app/api/v1/agents/[slug]/status/route.ts` (CREAR)
**Tarea:** Implementar según sección 4.5
**Build gate:** `npx tsc --noEmit`

### Wave 4 — Modificar register/route.ts
**Archivo:** `src/app/api/v1/agents/register/route.ts`
**Tarea:** Añadir llamada async a probeEndpoint + response con health_check + status_url
**Build gate:** `npx tsc --noEmit`

### Wave 5 — Modificar PATCH creator/agents
**Archivo:** `src/app/api/creator/agents/[slug]/route.ts`
**Tarea:** Añadir re-check async cuando endpoint_url cambia
**Build gate:** `npx tsc --noEmit`

### Wave 6 — Commit
```
git add [archivos] && git commit -m "feat(WAS-215): health check async al registrar agente — activación automática sin cron"
```

---

## 6. Rollback

1. El endpoint `/status` es nuevo — no afecta nada existente.
2. Las columnas DB son nullable — no rompen nada.
3. Si el probe falla silenciosamente, el agente queda en `reviewing` (comportamiento actual).
4. Rollback: `git revert <commit>` + revertir migración: `ALTER TABLE agents DROP COLUMN health_check, DROP COLUMN last_checked_at`.

---

## 7. Critical Constraints

- **OBLIGATORIO:** `probeEndpoint` es fire-and-forget — NUNCA await en el handler del register
- **OBLIGATORIO:** `validateEndpointUrlAsync` ANTES de cualquier fetch en el probe
- **OBLIGATORIO:** `createServiceClient()` en el probe (no hay sesión activa en async)
- **OBLIGATORIO:** El probe usa `AbortSignal.timeout(5_000)` — no más de 5s
- **PROHIBIDO:** Await del probe en el handler de register o PATCH
- **PROHIBIDO:** Loggear el endpoint_url completo en errores (puede contener tokens en query params)
- **PROHIBIDO:** Modificar `GET /api/v1/agents/:slug/health` existente
