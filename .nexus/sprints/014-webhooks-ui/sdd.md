# SDD 014 — WAS-74: Webhooks y eventos para agentes
**Fecha:** 2026-03-02  
**NNN:** 014  
**Modo:** QUALITY  
**Branch:** `feat/014-webhooks-ui`  
**Status:** DRAFT → SPEC_APPROVED pending

---

## 1. Context Map — Codebase Grounding

### Archivos leídos

| Archivo | Propósito | Hallazgos clave |
|---------|-----------|-----------------|
| `src/lib/webhooks/deliverWebhook.ts` | Core delivery | HMAC-SHA256 con `X-WasiAI-Signature: sha256=<hex>`, timeout 10s, AbortSignal |
| `src/lib/webhooks/triggerCreditsLow.ts` | Trigger existente | Patrón: `createServiceClient()` → query `webhooks` por `user_id+is_active+events` → `Promise.allSettled` → insert en `webhook_deliveries` |
| `src/app/api/v1/models/[slug]/invoke/route.ts` | Invoke route | `createServiceClient()` para bypass RLS, `logger.error/warn`, `callUpstream()` ya retorna `{ status: 'success' | 'error', data, latencyMs }` |
| `supabase/migrations/027_webhooks.sql` | Schema | Tablas `webhooks` + `webhook_deliveries` ya existen. Columna `attempt INTEGER NOT NULL DEFAULT 1` en deliveries. RLS activo. |
| `src/app/api/v1/webhooks/route.ts` | API CRUD existente | GET+POST ya implementados. Límite 5/usuario. Genera secret con `crypto.randomBytes(32)` |
| `src/app/api/v1/webhooks/[id]/route.ts` | API CRUD existente | PUT+DELETE ya implementados (ownership via `.eq('user_id', user.id)`). **Nota: usa PUT no PATCH** |
| `src/app/[locale]/creator/dashboard/page.tsx` | Dashboard | Server Component, pattern: `import { ComponentName } from './_components/ComponentName'`, usa `createClient()` autenticado, Suspense para async. Tailwind: `rounded-2xl border border-gray-100 bg-white shadow-sm` |

### Patrones extraídos

```typescript
// Auth en Server Component (dashboard)
const supabase = await createClient()
const { data: { user } } = await supabase.auth.getUser()
if (!user) redirect(`/${locale}/login`)

// Auth en API route
const supabase = await createClient()
const { data: { user } } = await supabase.auth.getUser()
if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

// Service client para operaciones privilegiadas (sin RLS)
const supabase = createServiceClient()

// Trigger pattern (triggerCreditsLow.ts)
const { data: webhooks } = await supabase
  .from('webhooks')
  .select('id, url, secret')
  .eq('user_id', userId)
  .eq('is_active', true)
  .contains('events', ['event.name'])

await Promise.allSettled(webhooks.map(async (wh) => {
  const result = await deliverWebhook(wh.url, wh.secret, payload)
  await supabase.from('webhook_deliveries').insert({
    webhook_id: wh.id, event, payload, status_code, success
  })
}))

// Logging
import { logger } from '@/lib/logger'
logger.error('[invoke] mensaje', { err })
```

### Exemplars UI (dashboard/_components/)

- `EarningsSection.tsx` → async Server Component con Suspense
- `FreeTrialToggle.tsx` → Client Component con estado local + fetch a API route
- `AgentActions.tsx` → Client Component con dropdown de acciones

### Estado actual del scope

| Componente | Estado | Notas |
|-----------|--------|-------|
| DB schema (`webhooks` + `webhook_deliveries`) | ✅ EXISTE (migration 027) | No tocar |
| `deliverWebhook.ts` | ✅ EXISTE | Reutilizar as-is |
| API GET/POST `/api/v1/webhooks` | ✅ EXISTE | Funcional |
| API PUT+DELETE `/api/v1/webhooks/[id]` | ✅ EXISTE | PUT (no PATCH) |
| Trigger `agent.invoked` en invoke route | ❌ FALTA | Crear |
| Trigger `agent.error` en invoke route | ❌ FALTA | Crear |
| Cron retry de deliveries fallidas | ❌ FALTA | Crear |
| UI `WebhooksPanel` en creator dashboard | ❌ FALTA | Crear |

---

## 2. Objetivo

Completar el sistema de webhooks para creadores con:

1. **UI WebhooksPanel** — componente Client en creator dashboard. CRUD completo: crear (URL + eventos, secret generado automáticamente), toggle active/inactive, eliminar, ver últimas 10 deliveries por webhook.
2. **Triggers en invoke route** — `agent.invoked` (siempre al invocar exitosamente) y `agent.error` (cuando `result.status === 'error'`). Async, fire-and-forget, no bloquea response al caller.
3. **Cron de retry** — `/api/cron/retry-webhook-deliveries` ejecutado cada 5 min por Supabase cron. Reintenta deliveries con `success=false` y `attempt < 3`.
4. **Función `triggerAgentEvent`** — lib reutilizable para triggers, siguiendo el patrón de `triggerCreditsLow.ts`.

### Qué NO construir
- NO trigger `agent.circuit_open` (depende de WAS-73)
- NO webhooks para consumers (solo creators que poseen el agente)
- NO UI de replay manual
- NO modificar `deliverWebhook.ts` ni `027_webhooks.sql`

---

## 3. Acceptance Criteria (EARS)

### AC-1: Ver webhooks
**WHEN** el creator navega al dashboard  
**THEN** el sistema muestra el `WebhooksPanel` con la lista de sus webhooks (url, eventos suscritos, estado active/inactive, fecha creación)

### AC-2: Crear webhook
**WHEN** el creator llena el formulario (URL válida + al menos 1 evento) y hace click en "Crear"  
**THEN** el sistema llama `POST /api/v1/webhooks`, muestra el secret generado UNA SOLA VEZ en un modal/banner de confirmación, y agrega el webhook a la lista

### AC-3: Toggle active
**WHEN** el creator hace toggle en el switch de un webhook  
**THEN** el sistema llama `PUT /api/v1/webhooks/[id]` con `{ is_active: !current }` y actualiza la UI sin reload

### AC-4: Eliminar webhook
**WHEN** el creator confirma la eliminación de un webhook  
**THEN** el sistema llama `DELETE /api/v1/webhooks/[id]` y remueve el item de la lista

### AC-5: Ver últimas deliveries
**WHEN** el creator expande un webhook  
**THEN** el sistema fetcha `GET /api/v1/webhooks/[id]/deliveries` y muestra las últimas 10 deliveries con (evento, success/fail, status_code, timestamp)

### AC-6: Trigger agent.invoked
**WHEN** `/api/v1/models/[slug]/invoke` retorna `result.status === 'success'`  
**THEN** el sistema lanza `triggerAgentEvent('agent.invoked', agentId, payload)` de forma async sin await bloqueante

### AC-7: Trigger agent.error  
**WHEN** `/api/v1/models/[slug]/invoke` retorna `result.status === 'error'`  
**THEN** el sistema lanza `triggerAgentEvent('agent.error', agentId, payload)` de forma async sin await bloqueante

### AC-8: Retry cron
**WHILE** el cron de Supabase ejecuta `/api/cron/retry-webhook-deliveries` cada 5 min  
**THEN** el sistema encuentra deliveries con `success=false AND attempt < 3`, reintenta vía `deliverWebhook`, incrementa `attempt`, actualiza `success` y `status_code`

### AC-9: Límite de reintentos
**IF** una delivery tiene `attempt >= 3` y sigue fallando  
**THEN** el sistema NO reintenta más (queda en estado final `success=false, attempt=3`)

### AC-10: Ownership
**IF** un creator intenta acceder a webhooks/deliveries de otro usuario  
**THEN** la API retorna 404 (sin revelar existencia)

---

## 4. Tabla de Archivos

| # | Archivo | Acción | Exemplar / Base |
|---|---------|--------|-----------------|
| 1 | `src/lib/webhooks/triggerAgentEvent.ts` | **CREAR** | `triggerCreditsLow.ts` — mismo patrón query+allSettled+insert |
| 2 | `src/app/api/v1/models/[slug]/invoke/route.ts` | **MODIFICAR** | Añadir 2 void calls a `triggerAgentEvent` después de `buildResponse` |
| 3 | `src/app/api/v1/webhooks/[id]/deliveries/route.ts` | **CREAR** | `webhooks/route.ts` — auth pattern + query deliveries con `.eq('webhook_id', id)` |
| 4 | `src/app/api/cron/retry-webhook-deliveries/route.ts` | **CREAR** | `src/app/api/cron/retry-recordings/` — cron auth header + loop |
| 5 | `src/app/[locale]/creator/dashboard/_components/WebhooksPanel.tsx` | **CREAR** | `FreeTrialToggle.tsx` — 'use client', useState, fetch a API routes |
| 6 | `src/app/[locale]/creator/dashboard/page.tsx` | **MODIFICAR** | Añadir `import { WebhooksPanel }` y `<WebhooksPanel userId={user.id} />` |

### Detalle por archivo

#### Archivo 1: `triggerAgentEvent.ts`
```typescript
// src/lib/webhooks/triggerAgentEvent.ts
import { createServiceClient } from '@/lib/supabase/server'
import { deliverWebhook } from './deliverWebhook'
import { logger } from '@/lib/logger'

export type AgentEvent = 'agent.invoked' | 'agent.error'

export async function triggerAgentEvent(
  event: AgentEvent,
  agentId: string,       // el model.id del agente invocado
  creatorId: string,     // el creator_id del agente (para query de webhooks)
  data: Record<string, unknown>
): Promise<void> {
  try {
    const supabase = createServiceClient()
    const { data: webhooks, error } = await supabase
      .from('webhooks')
      .select('id, url, secret')
      .eq('user_id', creatorId)
      .eq('is_active', true)
      .contains('events', [event])
    if (error || !webhooks?.length) return
    const payload = { event, timestamp: new Date().toISOString(), data }
    await Promise.allSettled(webhooks.map(async (wh) => {
      const result = await deliverWebhook(wh.url, wh.secret, payload)
      await supabase.from('webhook_deliveries').insert({
        webhook_id: wh.id, event, payload,
        status_code: result.statusCode ?? null,
        success: result.success,
        attempt: 1,
      })
    }))
  } catch (err) {
    logger.error('[triggerAgentEvent] non-fatal error', { event, agentId, err })
  }
}
```

#### Archivo 2: Modificación invoke route
```typescript
// AFTER: return buildResponse(model, result, ...)
// Add at end of POST handler (Route A y Route B), before final return:

// Async fire-and-forget — no bloquea response
void triggerAgentEvent(
  result.status === 'success' ? 'agent.invoked' : 'agent.error',
  model.id as string,
  model.creator_id as string,
  { slug, status: result.status, latency_ms: result.latencyMs }
).catch(() => {/* non-fatal */})
```

**NOTA CRÍTICA:** La función `triggerAgentEvent` se llama con `void` + `.catch()` para ser completamente fire-and-forget. Ni `await` ni `await` dentro de `return`. El `return buildResponse(...)` ya habrá ejecutado.

En la práctica, el patrón correcto en el invoke route es:
```typescript
const response = buildResponse(model, result, ...)
// fire-and-forget después de construir la response
void triggerAgentEvent(...)
return response
```

#### Archivo 3: Deliveries endpoint
```typescript
// GET /api/v1/webhooks/[id]/deliveries
// Auth: createClient() → user check → ownership via webhook.user_id
// Query: .from('webhook_deliveries').select(...).eq('webhook_id', id).order('delivered_at', {ascending:false}).limit(10)
```

#### Archivo 4: Cron retry
```typescript
// POST /api/cron/retry-webhook-deliveries
// Header auth: x-cron-secret === process.env.CRON_SECRET
// Query: deliveries WHERE success=false AND attempt < 3
// Per delivery: deliverWebhook → update attempt+1, success, status_code
// Max batch: 50 deliveries por ejecución (evita timeout Vercel)
```

#### Archivo 5: WebhooksPanel
```typescript
'use client'
// Estado: webhooks[], loading, showForm, newWebhookSecret(mostrar 1 vez), expandedId
// Formulario: url (text input) + eventos checkboxes (agent.invoked, agent.error, credits.low)
// Lista: por cada webhook → url, badges de eventos, toggle switch, botón eliminar, expandible con deliveries
// Secret display: solo al crear, banner amarillo con copy button, desaparece al cerrar
```

---

## 5. Constraint Directives

### OBLIGATORIO

1. **`triggerAgentEvent` siempre fire-and-forget** — usar `void fn().catch(() => {})` en invoke route. NUNCA `await`. La latencia del webhook NO debe sumarse al TTFB del caller.

2. **Ownership check en TODAS las queries** — `.eq('user_id', user.id)` en webhooks, verificar que el webhook pertenece al user antes de retornar deliveries. RLS está activo pero las queries deben ser explícitas como segunda línea de defensa.

3. **Secret mostrado UNA SOLA VEZ** — el secret nunca se almacena en texto plano accesible via GET (la columna `secret` no se selecciona en GET list). Al crear, el API retorna `{ webhook, secret }` — el frontend lo muestra en un banner y advierte que no se puede recuperar.

4. **Cron autenticado con `CRON_SECRET`** — el endpoint `/api/cron/retry-webhook-deliveries` valida `x-cron-secret` header. Sin header válido → 401.

5. **Límite de batch en cron** — máximo 50 deliveries por ejecución para no exceder el timeout de Vercel (10s en hobby, 60s en pro). Ordenar por `delivered_at ASC` para procesar los más antiguos primero.

6. **`model.creator_id` disponible** — la query de agente en invoke ya usa `supabase.from('agents').select('*')` que incluye `creator_id`. Usar ese campo para `triggerAgentEvent`.

### PROHIBIDO

1. **PROHIBIDO `await triggerAgentEvent()`** — en el invoke route. Cualquier `await` bloquea la respuesta al caller. El trigger es completamente asíncrono.

2. **PROHIBIDO exponer `secret` en GET `/api/v1/webhooks`** — el SELECT explícito excluye `secret`. El secret solo viaja en el response del POST de creación.

3. **PROHIBIDO modificar `deliverWebhook.ts` ni `027_webhooks.sql`** — son contratos estables. Si se necesita cambio, documentar como bloqueante y escalar.

4. **PROHIBIDO hardcodear la lista de eventos** — debe vivir en una constante exportada:
   ```typescript
   // src/lib/webhooks/events.ts
   export const WEBHOOK_EVENTS = ['agent.invoked', 'agent.error', 'credits.low'] as const
   export type WebhookEvent = typeof WEBHOOK_EVENTS[number]
   ```

5. **PROHIBIDO usar `PUT` en el client-side del toggle** renombrándolo a PATCH — la API existente usa `PUT`. Mantener consistencia con la implementación actual.

---

## 6. Plan de Waves

### W0 — Serial (bloqueante, sin dependencias previas)

```
W0.1: Crear src/lib/webhooks/events.ts (constante WEBHOOK_EVENTS)
W0.2: Crear src/lib/webhooks/triggerAgentEvent.ts
```

### W1 — Paralelo (todos dependen de W0)

```
W1.A: Modificar invoke route → añadir void triggerAgentEvent(...)
W1.B: Crear GET /api/v1/webhooks/[id]/deliveries/route.ts
W1.C: Crear /api/cron/retry-webhook-deliveries/route.ts
W1.D: Crear WebhooksPanel.tsx (Client Component)
```

### W2 — Serial (depende de W1.D)

```
W2.1: Modificar dashboard/page.tsx → import + render <WebhooksPanel userId={user.id} />
```

### W3 — Validación

```
W3.1: npm run build — 0 errores TypeScript
W3.2: Test manual: crear webhook → invocar agente → verificar delivery en UI
W3.3: Test cron: insertar delivery con success=false → llamar endpoint → verificar attempt=2
```

---

## 7. Schema Adicional (Migration 028)

La tabla `webhook_deliveries` ya tiene `attempt` pero necesita un índice para el cron:

```sql
-- supabase/migrations/028_webhook_retry_index.sql
CREATE INDEX IF NOT EXISTS idx_deliveries_retry
  ON webhook_deliveries(success, attempt, delivered_at)
  WHERE success = false AND attempt < 3;
```

También agregar `error_message TEXT` para capturar el error de `deliverWebhook`:

```sql
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS error_message TEXT;
```

**Nota:** Si la migration 028 ya fue usada para otra cosa (ver project-context: "Próxima: 026"), usar el siguiente número disponible. Verificar con `ls supabase/migrations/`.

---

## 8. Contrato de Integración

### invoke route → triggerAgentEvent
```typescript
// Input
triggerAgentEvent(
  event: 'agent.invoked' | 'agent.error',
  agentId: string,     // model.id
  creatorId: string,   // model.creator_id
  data: {
    slug: string,
    status: 'success' | 'error',
    latency_ms: number,
    // agent.invoked extra:
    caller_type?: 'human' | 'agent',
    // agent.error extra:
    error?: string,
  }
): Promise<void>  // fire-and-forget, nunca throws externamente

// Payload que llega al webhook del creator:
{
  event: "agent.invoked",
  timestamp: "2026-03-02T17:00:00.000Z",
  data: {
    slug: "my-agent",
    status: "success",
    latency_ms: 342,
    caller_type: "human"
  }
}
```

### WebhooksPanel → API routes
```typescript
// GET /api/v1/webhooks → { webhooks: Webhook[] }
// POST /api/v1/webhooks → { webhook: Webhook, secret: string }
// PUT /api/v1/webhooks/[id] → { webhook: Webhook }
// DELETE /api/v1/webhooks/[id] → { ok: true }
// GET /api/v1/webhooks/[id]/deliveries → { deliveries: Delivery[] }

interface Webhook {
  id: string
  url: string
  events: string[]
  is_active: boolean
  created_at: string
  updated_at: string
}

interface Delivery {
  id: string
  event: string
  success: boolean
  status_code: number | null
  attempt: number
  delivered_at: string
  error_message?: string | null
}
```

---

## 9. Implementation Readiness Check

| Check | Estado | Notas |
|-------|--------|-------|
| Schema DB existe | ✅ | `027_webhooks.sql` aplicado |
| `deliverWebhook.ts` existe y funciona | ✅ | Reutilizar sin cambios |
| API CRUD base existe | ✅ | GET/POST/PUT/DELETE en `/api/v1/webhooks` |
| `triggerCreditsLow.ts` como exemplar | ✅ | Patrón claro para `triggerAgentEvent` |
| `model.creator_id` en invoke route | ✅ | Query `select('*')` incluye `creator_id` |
| Cron infrastructure existe | ✅ | `/api/cron/retry-recordings/` como referencia |
| `CRON_SECRET` env var | ⚠️ VERIFICAR | Confirmar que existe en Vercel env vars |
| `WEBHOOK_EVENTS` constante | ❌ CREAR | W0.1 del plan de waves |
| Migration 028 número disponible | ⚠️ VERIFICAR | `ls supabase/migrations/` para confirmar |
| i18n strings nuevos | ⚠️ OPCIONAL | UI puede usar strings en español/inglés hardcodeados en el componente para MVP |

### Riesgos identificados

| Riesgo | Mitigación |
|--------|-----------|
| invoke route larga (700+ líneas) — merge conflict | Edits quirúrgicos solo en los puntos de inserción de `triggerAgentEvent` |
| `model.creator_id` puede ser null si draft | Añadir `if (!model.creator_id) return` antes de trigger |
| Cron timeout Vercel hobby (10s) | Batch de 50 deliveries máximo, `AbortSignal.timeout(8_000)` en el cron loop |
| Secret expuesto en logs del browser | Asegurarse que el banner lo muestra solo en UI, nunca en console.log |

---

## 10. DoD (Definition of Done)

- [ ] `npm run build` → 0 errores TypeScript
- [ ] `WebhooksPanel` visible en `/creator/dashboard` con CRUD funcional
- [ ] Delivery `agent.invoked` registrada en DB al invocar un agente
- [ ] Delivery `agent.error` registrada en DB cuando upstream falla
- [ ] Cron endpoint retorna 200 y actualiza `attempt` en deliveries fallidas
- [ ] Secret mostrado UNA VEZ al crear, no aparece en GET list
- [ ] Ownership enforced: usuario B no puede ver webhooks de usuario A
- [ ] Migration 028 (índice retry) aplicada en Supabase
- [ ] Branch: `feat/014-webhooks-ui`
- [ ] `doc/sdd/_INDEX.md` actualizado con fila 014
