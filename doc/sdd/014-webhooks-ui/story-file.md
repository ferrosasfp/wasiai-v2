# Story File — WAS-74: Webhooks UI
**SDD:** 014 | **Branch:** `feat/014-webhooks-ui` | **Modo:** QUALITY  
**Fecha:** 2026-03-02

---

## 1. Goal

Completar el sistema de webhooks para creadores en WasiAI. Se necesita la UI `WebhooksPanel` en el creator dashboard (CRUD completo), dos triggers async en el invoke route (`agent.invoked` / `agent.error`), un endpoint cron de retry para deliveries fallidas, y la función lib reutilizable `triggerAgentEvent`. El backend (DB schema, `deliverWebhook`, API CRUD) ya existe — este story solo construye las piezas faltantes.

---

## 2. Acceptance Criteria (EARS)

**AC-1 — Ver webhooks**  
WHEN el creator navega al dashboard  
THEN el sistema muestra el `WebhooksPanel` con la lista de sus webhooks (url, eventos suscritos, estado active/inactive, fecha creación)

**AC-2 — Crear webhook**  
WHEN el creator llena el formulario (URL válida + al menos 1 evento) y hace click en "Crear"  
THEN el sistema llama `POST /api/v1/webhooks`, muestra el secret generado UNA SOLA VEZ en un banner de confirmación, y agrega el webhook a la lista

**AC-3 — Toggle active**  
WHEN el creator hace toggle en el switch de un webhook  
THEN el sistema llama `PUT /api/v1/webhooks/[id]` con `{ is_active: !current }` y actualiza la UI sin reload

**AC-4 — Eliminar webhook**  
WHEN el creator confirma la eliminación de un webhook  
THEN el sistema llama `DELETE /api/v1/webhooks/[id]` y remueve el item de la lista

**AC-5 — Ver últimas deliveries**  
WHEN el creator expande un webhook  
THEN el sistema fetcha `GET /api/v1/webhooks/[id]/deliveries` y muestra las últimas 10 deliveries con (evento, success/fail, status_code, timestamp)

**AC-6 — Trigger agent.invoked**  
WHEN `/api/v1/models/[slug]/invoke` retorna `result.status === 'success'`  
THEN el sistema lanza `triggerAgentEvent('agent.invoked', agentId, creatorId, data)` de forma async sin await bloqueante

**AC-7 — Trigger agent.error**  
WHEN `/api/v1/models/[slug]/invoke` retorna `result.status === 'error'`  
THEN el sistema lanza `triggerAgentEvent('agent.error', agentId, creatorId, data)` de forma async sin await bloqueante

**AC-8 — Retry cron**  
WHILE el cron ejecuta `POST /api/cron/retry-webhook-deliveries` cada 5 min  
THEN el sistema encuentra deliveries con `success=false AND attempt < 3`, reintenta vía `deliverWebhook`, incrementa `attempt`, actualiza `success` y `status_code`

**AC-9 — Límite de reintentos**  
IF una delivery tiene `attempt >= 3` y sigue fallando  
THEN el sistema NO reintenta más (queda en estado final `success=false, attempt=3`)

**AC-10 — Ownership**  
IF un creator intenta acceder a webhooks/deliveries de otro usuario  
THEN la API retorna 404 (sin revelar existencia)

---

## 3. Files to Modify/Create

| # | Path | Acción | Exemplar |
|---|------|--------|---------|
| 1 | `src/lib/webhooks/events.ts` | **CREAR** | Constante nueva — ver §4.1 |
| 2 | `src/lib/webhooks/triggerAgentEvent.ts` | **CREAR** | `triggerCreditsLow.ts` — ver §4.2 |
| 3 | `src/app/api/v1/models/[slug]/invoke/route.ts` | **MODIFICAR** | Añadir void calls — ver §4.3 |
| 4 | `src/app/api/v1/webhooks/[id]/deliveries/route.ts` | **CREAR** | `webhooks/route.ts` auth pattern — ver §4.4 |
| 5 | `src/app/api/cron/retry-webhook-deliveries/route.ts` | **CREAR** | `cron/retry-recordings/route.ts` — ver §4.5 |
| 6 | `src/app/[locale]/creator/dashboard/_components/WebhooksPanel.tsx` | **CREAR** | `FreeTrialToggle.tsx` — ver §4.6 |
| 7 | `src/app/[locale]/creator/dashboard/page.tsx` | **MODIFICAR** | Añadir import + `<WebhooksPanel>` — ver §4.7 |
| 8 | `supabase/migrations/028_webhook_retry_index.sql` | **CREAR** | SQL puro — ver §4.8 |

> **ANTES de empezar:** correr `ls supabase/migrations/` para confirmar que `028_` está disponible. Si no, usar el siguiente número libre.

---

## 4. Exemplars

### 4.1 — `src/lib/webhooks/events.ts` (CREAR — archivo nuevo completo)

```typescript
// src/lib/webhooks/events.ts
export const WEBHOOK_EVENTS = ['agent.invoked', 'agent.error', 'credits.low'] as const
export type WebhookEvent = typeof WEBHOOK_EVENTS[number]
```

### 4.2 — `src/lib/webhooks/triggerAgentEvent.ts` (CREAR — extraído de `triggerCreditsLow.ts`)

Exemplar base (`triggerCreditsLow.ts` — copiar patrón literalmente):

```typescript
import { createServiceClient } from '@/lib/supabase/server'
import { deliverWebhook } from './deliverWebhook'

export async function triggerCreditsLow(userId: string, balance: number): Promise<void> {
  if (balance >= CREDITS_LOW_THRESHOLD) return

  const supabase = createServiceClient()

  const { data: webhooks, error } = await supabase
    .from('webhooks')
    .select('id, url, secret')
    .eq('user_id', userId)
    .eq('is_active', true)
    .contains('events', ['credits.low'])

  if (error || !webhooks?.length) return

  const payload = {
    event: 'credits.low',
    timestamp: new Date().toISOString(),
    data: { user_id: userId, balance, threshold: CREDITS_LOW_THRESHOLD },
  }

  await Promise.allSettled(
    webhooks.map(async (wh) => {
      const result = await deliverWebhook(wh.url as string, wh.secret as string, payload)
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

Archivo a crear siguiendo ese patrón:

```typescript
// src/lib/webhooks/triggerAgentEvent.ts
import { createServiceClient } from '@/lib/supabase/server'
import { deliverWebhook } from './deliverWebhook'
import { logger } from '@/lib/logger'
import type { WebhookEvent } from './events'

export async function triggerAgentEvent(
  event: WebhookEvent,
  agentId: string,
  creatorId: string,
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

    const payload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    }

    await Promise.allSettled(
      webhooks.map(async (wh) => {
        const result = await deliverWebhook(wh.url as string, wh.secret as string, payload)
        await supabase.from('webhook_deliveries').insert({
          webhook_id: wh.id,
          event,
          payload,
          status_code: result.statusCode ?? null,
          success: result.success,
          attempt: 1,
        })
      })
    )
  } catch (err) {
    logger.error('[triggerAgentEvent] non-fatal error', { event, agentId, err })
  }
}
```

### 4.3 — Modificación invoke route (MODIFICAR — edits quirúrgicos)

**Paso 1:** Añadir import al bloque de imports existente:
```typescript
import { triggerAgentEvent } from '@/lib/webhooks/triggerAgentEvent'
```

**Paso 2:** Localizar los puntos de `return buildResponse(...)` dentro del handler POST.

La invoke route tiene múltiples puntos de retorno. En CADA lugar donde se construye y retorna la response final (después de que `result` está disponible y antes del `return`), insertar el bloque fire-and-forget. El patrón exacto es:

```typescript
// Construir response primero
const response = buildResponse(model, result, /* ...otros args... */)

// Fire-and-forget — NUNCA await aquí
if (model.creator_id) {
  void triggerAgentEvent(
    result.status === 'success' ? 'agent.invoked' : 'agent.error',
    model.id as string,
    model.creator_id as string,
    {
      slug: slug as string,
      status: result.status,
      latency_ms: result.latencyMs,
    }
  ).catch(() => { /* non-fatal */ })
}

return response
```

> **CRÍTICO:** `model.creator_id` puede ser null si el agente es draft. Verificar con `if (model.creator_id)` antes de llamar. El `void` + `.catch()` garantiza que ningún error del trigger llegue al caller.

### 4.4 — `src/app/api/v1/webhooks/[id]/deliveries/route.ts` (CREAR)

Exemplar base (patrón de auth de `webhooks/route.ts`):
```typescript
// De src/app/api/v1/webhooks/route.ts — patrón de auth:
const supabase = await createClient()
const { data: { user } } = await supabase.auth.getUser()
if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
```

Archivo a crear:

```typescript
// src/app/api/v1/webhooks/[id]/deliveries/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Ownership check: verificar que el webhook pertenece al user
  const { data: webhook } = await supabase
    .from('webhooks')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!webhook) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: deliveries, error } = await supabase
    .from('webhook_deliveries')
    .select('id, event, success, status_code, attempt, delivered_at, error_message')
    .eq('webhook_id', id)
    .order('delivered_at', { ascending: false })
    .limit(10)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deliveries })
}
```

### 4.5 — `src/app/api/cron/retry-webhook-deliveries/route.ts` (CREAR)

Exemplar base (`cron/retry-recordings/route.ts` — copiar patrón de auth):
```typescript
// De retry-recordings/route.ts — patrón de auth de cron:
const cronSecret = process.env.CRON_SECRET?.trim()
if (!cronSecret) {
  return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
}
const authorization = request.headers.get('authorization')
if (authorization !== `Bearer ${cronSecret}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```

Archivo a crear:

```typescript
// src/app/api/cron/retry-webhook-deliveries/route.ts
import { type NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { deliverWebhook } from '@/lib/webhooks/deliverWebhook'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const authorization = request.headers.get('authorization')
  if (authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createServiceClient()

    // Fetch hasta 50 deliveries fallidas con attempt < 3 (más antiguas primero)
    const { data: deliveries, error } = await supabase
      .from('webhook_deliveries')
      .select('id, webhook_id, event, payload')
      .eq('success', false)
      .lt('attempt', 3)
      .order('delivered_at', { ascending: true })
      .limit(50)

    if (error) {
      logger.error('[cron/retry-webhook-deliveries] query error', { error })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!deliveries?.length) {
      return NextResponse.json({ ok: true, retried: 0, timestamp: new Date().toISOString() })
    }

    // Obtener secrets de los webhooks involucrados
    const webhookIds = [...new Set(deliveries.map(d => d.webhook_id))]
    const { data: webhooks } = await supabase
      .from('webhooks')
      .select('id, url, secret')
      .in('id', webhookIds)

    const webhookMap = new Map((webhooks ?? []).map(w => [w.id, w]))

    let retried = 0
    let succeeded = 0

    await Promise.allSettled(
      deliveries.map(async (delivery) => {
        const wh = webhookMap.get(delivery.webhook_id)
        if (!wh) return

        const result = await deliverWebhook(
          wh.url as string,
          wh.secret as string,
          delivery.payload as Record<string, unknown>
        )

        await supabase
          .from('webhook_deliveries')
          .update({
            success: result.success,
            status_code: result.statusCode ?? null,
            attempt: supabase.rpc ? undefined : undefined, // incrementado abajo
          })
          // Incrementar attempt con RPC o raw update
          // Usamos update con attempt+1 via supabase-js:
          .eq('id', delivery.id)

        // supabase-js no soporta `attempt + 1` inline — hacemos query del attempt actual
        // y luego update con valor explícito
        const { data: current } = await supabase
          .from('webhook_deliveries')
          .select('attempt')
          .eq('id', delivery.id)
          .single()

        await supabase
          .from('webhook_deliveries')
          .update({
            success: result.success,
            status_code: result.statusCode ?? null,
            attempt: (current?.attempt ?? 1) + 1,
            delivered_at: new Date().toISOString(),
          })
          .eq('id', delivery.id)

        retried++
        if (result.success) succeeded++
      })
    )

    logger.info('[cron/retry-webhook-deliveries] completed', { retried, succeeded })
    return NextResponse.json({ ok: true, retried, succeeded, timestamp: new Date().toISOString() })
  } catch (err) {
    logger.error('[cron/retry-webhook-deliveries] unhandled error', { err })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
```

> **NOTA DEL CRON:** La doble query (select attempt + update) es necesaria porque supabase-js no soporta expresiones SQL como `attempt = attempt + 1` en `.update()`. Si el codebase tiene una función RPC para esto, úsala. De lo contrario, este patrón es correcto.

### 4.6 — `WebhooksPanel.tsx` (CREAR — Client Component)

Exemplar base (`FreeTrialToggle.tsx` — patrón 'use client' + fetch + estado):

```typescript
// De FreeTrialToggle.tsx — patrón de Client Component con fetch:
'use client'
import { useState, useTransition, useRef } from 'react'

// Optimistic update + revert:
const lastGood = useRef({ enabled: initialEnabled, limit: initialLimit })
async function patch(nextEnabled: boolean, nextLimit: number) {
  const res = await fetch(`/api/creator/agents/${slug}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ free_trial_enabled: nextEnabled }),
  })
  if (!res.ok) {
    setEnabled(lastGood.current.enabled)  // revert optimista
  }
}

// Toggle switch pattern (usar role="switch" + aria-checked):
<button
  type="button"
  role="switch"
  aria-checked={enabled}
  onClick={handleToggle}
  disabled={isPending}
  className={`relative inline-flex h-6 w-11 ... ${enabled ? 'bg-avax-500' : 'bg-gray-200'}`}
>
  <span className={`... ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
</button>
```

Archivo a crear:

```typescript
// src/app/[locale]/creator/dashboard/_components/WebhooksPanel.tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { WEBHOOK_EVENTS } from '@/lib/webhooks/events'

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

interface Props {
  userId: string
}

export function WebhooksPanel({ userId }: Props) {
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [newSecret, setNewSecret] = useState<string | null>(null)  // mostrar 1 sola vez
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deliveriesMap, setDeliveriesMap] = useState<Record<string, Delivery[]>>({})
  const [formUrl, setFormUrl] = useState('')
  const [formEvents, setFormEvents] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/webhooks')
      const json = await res.json()
      setWebhooks(json.webhooks ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleCreate() {
    if (!formUrl || formEvents.length === 0) {
      setError('URL y al menos un evento son requeridos')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: formUrl, events: formEvents }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Error al crear webhook')
        return
      }
      setNewSecret(json.secret)
      setWebhooks(prev => [json.webhook, ...prev])
      setShowForm(false)
      setFormUrl('')
      setFormEvents([])
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(webhook: Webhook) {
    // Optimistic update
    const next = !webhook.is_active
    setWebhooks(prev => prev.map(w => w.id === webhook.id ? { ...w, is_active: next } : w))
    const res = await fetch(`/api/v1/webhooks/${webhook.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: next }),
    })
    if (!res.ok) {
      // Revert
      setWebhooks(prev => prev.map(w => w.id === webhook.id ? { ...w, is_active: webhook.is_active } : w))
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar este webhook?')) return
    const res = await fetch(`/api/v1/webhooks/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setWebhooks(prev => prev.filter(w => w.id !== id))
    }
  }

  async function handleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    if (!deliveriesMap[id]) {
      const res = await fetch(`/api/v1/webhooks/${id}/deliveries`)
      const json = await res.json()
      setDeliveriesMap(prev => ({ ...prev, [id]: json.deliveries ?? [] }))
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-6">
        <p className="text-sm text-gray-400">Cargando webhooks...</p>
      </div>
    )
  }

  return (
    <section className="rounded-2xl border border-gray-100 bg-white shadow-sm p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">Webhooks</h2>
        <button
          onClick={() => { setShowForm(s => !s); setError(null) }}
          className="rounded-xl bg-avax-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-avax-600 transition"
        >
          {showForm ? 'Cancelar' : '+ Nuevo webhook'}
        </button>
      </div>

      {/* Secret one-time banner */}
      {newSecret && (
        <div className="rounded-xl border border-yellow-300 bg-yellow-50 p-4 space-y-2">
          <p className="text-sm font-semibold text-yellow-800">
            ⚠️ Guarda tu secret ahora — no se mostrará de nuevo
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-yellow-100 px-2 py-1 text-xs font-mono text-yellow-900 break-all">
              {newSecret}
            </code>
            <button
              onClick={() => { void navigator.clipboard.writeText(newSecret) }}
              className="shrink-0 rounded-lg border border-yellow-300 px-2 py-1 text-xs text-yellow-700 hover:bg-yellow-100"
            >
              Copiar
            </button>
          </div>
          <button
            onClick={() => setNewSecret(null)}
            className="text-xs text-yellow-700 underline"
          >
            Ya lo guardé, cerrar
          </button>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">URL del endpoint</label>
            <input
              type="url"
              placeholder="https://mi-servidor.com/webhook"
              value={formUrl}
              onChange={e => setFormUrl(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-avax-500 focus:outline-none focus:ring-1 focus:ring-avax-500"
            />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-700 mb-2">Eventos</p>
            <div className="space-y-1">
              {WEBHOOK_EVENTS.map(ev => (
                <label key={ev} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formEvents.includes(ev)}
                    onChange={e => {
                      setFormEvents(prev =>
                        e.target.checked ? [...prev, ev] : prev.filter(x => x !== ev)
                      )
                    }}
                    className="rounded border-gray-300 text-avax-500"
                  />
                  <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{ev}</code>
                </label>
              ))}
            </div>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            onClick={() => { void handleCreate() }}
            disabled={saving}
            className="rounded-xl bg-avax-500 px-4 py-2 text-sm font-semibold text-white hover:bg-avax-600 transition disabled:opacity-50"
          >
            {saving ? 'Creando...' : 'Crear webhook'}
          </button>
        </div>
      )}

      {/* Webhook list */}
      {webhooks.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">No tienes webhooks configurados aún.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {webhooks.map(wh => (
            <div key={wh.id} className="py-3 space-y-2">
              <div className="flex items-start gap-3">
                {/* Toggle switch — patrón de FreeTrialToggle.tsx */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={wh.is_active}
                  aria-label="Activar/desactivar webhook"
                  onClick={() => { void handleToggle(wh) }}
                  className={`mt-0.5 relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-avax-500 focus:ring-offset-2 ${
                    wh.is_active ? 'bg-avax-500' : 'bg-gray-200'
                  }`}
                >
                  <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                    wh.is_active ? 'translate-x-4' : 'translate-x-0'
                  }`} />
                </button>

                {/* URL + badges */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{wh.url}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {wh.events.map(ev => (
                      <span key={ev} className="rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-xs font-medium">
                        {ev}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    Creado {new Date(wh.created_at).toLocaleDateString('es')}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { void handleExpand(wh.id) }}
                    className="text-xs text-gray-500 hover:text-gray-700 underline"
                  >
                    {expandedId === wh.id ? 'Ocultar' : 'Deliveries'}
                  </button>
                  <button
                    onClick={() => { void handleDelete(wh.id) }}
                    className="text-xs text-red-500 hover:text-red-700"
                    aria-label="Eliminar webhook"
                  >
                    Eliminar
                  </button>
                </div>
              </div>

              {/* Deliveries expandibles */}
              {expandedId === wh.id && (
                <div className="ml-12 rounded-xl border border-gray-100 bg-gray-50 overflow-hidden">
                  {!deliveriesMap[wh.id] ? (
                    <p className="p-3 text-xs text-gray-400">Cargando...</p>
                  ) : deliveriesMap[wh.id].length === 0 ? (
                    <p className="p-3 text-xs text-gray-400">Sin deliveries registradas.</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="border-b border-gray-100 bg-gray-100 text-gray-500 uppercase tracking-wide">
                        <tr>
                          <th className="px-3 py-2 text-left">Evento</th>
                          <th className="px-3 py-2 text-center">Status</th>
                          <th className="px-3 py-2 text-center">HTTP</th>
                          <th className="px-3 py-2 text-center">Intento</th>
                          <th className="px-3 py-2 text-right">Fecha</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {deliveriesMap[wh.id].map(d => (
                          <tr key={d.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-mono">{d.event}</td>
                            <td className="px-3 py-2 text-center">
                              <span className={`rounded-full px-2 py-0.5 font-medium ${
                                d.success
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-red-100 text-red-600'
                              }`}>
                                {d.success ? '✓ OK' : '✗ Fail'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-center text-gray-600">{d.status_code ?? '—'}</td>
                            <td className="px-3 py-2 text-center text-gray-600">{d.attempt}</td>
                            <td className="px-3 py-2 text-right text-gray-400">
                              {new Date(d.delivered_at).toLocaleString('es')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
```

### 4.7 — Modificación `dashboard/page.tsx` (MODIFICAR — 2 edits quirúrgicos)

**Edit 1 — Añadir import** (después de los imports existentes de `_components`):
```typescript
import { WebhooksPanel } from './_components/WebhooksPanel'
```

**Edit 2 — Añadir `<WebhooksPanel>` en el JSX**, después de la sección "Recent calls" y antes de la sección "Agent API quick-start":
```tsx
{/* WAS-74: Webhooks */}
<WebhooksPanel userId={user.id} />
```

### 4.8 — `supabase/migrations/028_webhook_retry_index.sql` (CREAR)

> Antes de crear: correr `ls supabase/migrations/` para confirmar que `028_` no existe. Si existe, usar el siguiente número.

```sql
-- supabase/migrations/028_webhook_retry_index.sql
-- WAS-74: Index para cron de retry + columna error_message

-- Índice parcial para el cron query: success=false AND attempt < 3
CREATE INDEX IF NOT EXISTS idx_deliveries_retry
  ON webhook_deliveries(success, attempt, delivered_at)
  WHERE success = false AND attempt < 3;

-- Columna para capturar el error de deliverWebhook
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS error_message TEXT;
```

---

## 5. Constraint Directives

### OBLIGATORIO

1. **`triggerAgentEvent` SIEMPRE fire-and-forget** — en el invoke route usar `void fn().catch(() => {})`. NUNCA `await`. La latencia del webhook NO suma al TTFB del caller.

2. **Ownership check explícito en TODAS las queries** — `.eq('user_id', user.id)` en webhooks, y verificar que el webhook pertenece al user antes de retornar deliveries. RLS activo pero el check explícito es segunda línea de defensa.

3. **Secret mostrado UNA SOLA VEZ** — la columna `secret` NO se selecciona en GET list (`select('id, url, events, is_active, created_at, updated_at')`). El secret solo viaja en el response del POST de creación. El frontend lo muestra en un banner y advierte que no se puede recuperar.

4. **Cron autenticado con `CRON_SECRET`** — el endpoint valida `authorization: Bearer ${CRON_SECRET}`. Sin header válido → 401.

5. **Batch máximo 50 deliveries en cron** — para no exceder timeout de Vercel. Ordenar por `delivered_at ASC` (más antiguas primero).

6. **`model.creator_id` puede ser null** — antes de llamar `triggerAgentEvent` en invoke route, verificar `if (model.creator_id)`.

7. **`WEBHOOK_EVENTS` vive en `src/lib/webhooks/events.ts`** — importar siempre desde ahí. No hardcodear strings de eventos en otros archivos.

### PROHIBIDO

1. **PROHIBIDO `await triggerAgentEvent()`** en el invoke route. Cualquier await bloquea la respuesta al caller.

2. **PROHIBIDO exponer `secret` en GET `/api/v1/webhooks`** — verificar que el SELECT no incluye `secret`.

3. **PROHIBIDO modificar `deliverWebhook.ts`** ni `027_webhooks.sql` — son contratos estables.

4. **PROHIBIDO usar PATCH** en el toggle — la API existente usa `PUT`. Mantener consistencia.

5. **PROHIBIDO hardcodear la lista de eventos** fuera de `events.ts`.

---

## 6. Waves

### W0 — Serial (sin dependencias externas — hacer primero, en orden)

```
W0.1  CREAR  src/lib/webhooks/events.ts
W0.2  CREAR  src/lib/webhooks/triggerAgentEvent.ts  (depende de W0.1)
```

### W1 — Paralelo (todos dependen de W0, pueden hacerse en cualquier orden)

```
W1.A  MODIFICAR  src/app/api/v1/models/[slug]/invoke/route.ts
      → Import triggerAgentEvent + añadir void calls en puntos de return final
      → Depende de W0.2

W1.B  CREAR  src/app/api/v1/webhooks/[id]/deliveries/route.ts
      → GET con ownership check + query deliveries

W1.C  CREAR  src/app/api/cron/retry-webhook-deliveries/route.ts
      → Auth CRON_SECRET + loop de retry con batch 50

W1.D  CREAR  src/app/[locale]/creator/dashboard/_components/WebhooksPanel.tsx
      → Client Component completo (ver §4.6)
      → Depende de W0.1 (importa WEBHOOK_EVENTS)
```

### W2 — Serial (depende de W1.D)

```
W2.1  MODIFICAR  src/app/[locale]/creator/dashboard/page.tsx
      → Import WebhooksPanel + <WebhooksPanel userId={user.id} />
```

### W3 — Migration

```
W3.1  CREAR  supabase/migrations/028_webhook_retry_index.sql
      → Verificar número disponible antes de crear
      → Aplicar en Supabase: npx supabase db push
```

### W4 — Validación

```
W4.1  npm run build → 0 errores TypeScript
W4.2  Test manual: crear webhook → invocar agente → UI muestra delivery
W4.3  Test cron: insertar delivery con success=false → POST cron → verificar attempt=2
W4.4  Test ownership: usuario B no ve webhooks de usuario A → 404
```

---

## 7. Out of Scope

- **NO** trigger `agent.circuit_open` (depende de WAS-73)
- **NO** webhooks para consumers (solo creators que poseen el agente)
- **NO** UI de replay manual de deliveries
- **NO** modificar `deliverWebhook.ts`
- **NO** modificar `027_webhooks.sql`
- **NO** i18n strings nuevos (strings en español/inglés hardcodeados en componente para MVP)
- **NO** paginación de deliveries (solo las últimas 10)
- **NO** filtros en la lista de webhooks

---

## 8. Escalation Rule

Si cualquier cosa no está especificada aquí, **Dev PARA y pregunta al Architect antes de improvisar**.

Casos concretos que requieren escalation:
- `deliverWebhook` retorna un tipo diferente a `{ statusCode, success }` (verificar el return type antes de usarlo)
- El número de migration `028` ya está tomado (preguntar qué número usar)
- `model.creator_id` no existe en el select del invoke route (verificar antes de asumir)
- `buildResponse` no existe como función extraída (puede ser inline — verificar el archivo real)
- `CRON_SECRET` env var no está configurada en Vercel (verificar antes de deployar)
- Cualquier conflict de merge en el invoke route (es un archivo grande — escalate antes de resolver a ciegas)

---

## Contrato de Integración (referencia rápida)

```typescript
// invoke route → triggerAgentEvent
triggerAgentEvent(
  'agent.invoked' | 'agent.error',
  model.id as string,
  model.creator_id as string,
  { slug: string, status: 'success' | 'error', latency_ms: number }
): Promise<void>  // fire-and-forget, nunca throws externamente

// Payload recibido en el endpoint del creator:
{
  event: "agent.invoked",
  timestamp: "2026-03-02T17:00:00.000Z",
  data: { slug: "my-agent", status: "success", latency_ms: 342 }
}

// WebhooksPanel → API shapes:
// GET /api/v1/webhooks       → { webhooks: Webhook[] }         // sin secret
// POST /api/v1/webhooks      → { webhook: Webhook, secret: string }
// PUT /api/v1/webhooks/[id]  → { webhook: Webhook }            // usar PUT, no PATCH
// DELETE /api/v1/webhooks/[id] → { ok: true }
// GET /api/v1/webhooks/[id]/deliveries → { deliveries: Delivery[] }
```
