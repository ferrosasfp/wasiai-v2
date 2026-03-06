# Story File — SDD #025: WAS-74 Webhooks + Eventos
**Sprint 13 | WAS-74**
**Classification: QUALITY — HU-MAJOR**
**Source of truth: this file only. Read every file before modifying.**

---

## Context

Los clientes necesitan notificaciones push cuando ocurren eventos importantes.
En lugar de polling, WasiAI hace POST al endpoint del cliente cuando algo pasa.

Implementacion en 2 fases:
- Fase 1: CRUD de endpoints + evento credits.low (independiente de WAS-70)
- Fase 2: eventos job.completed + job.failed (requiere WAS-70 completado)

---

## Acceptance Criteria — Fase 1 (este SDD)

- AC1: POST /api/v1/webhooks → registrar endpoint (max 5 por usuario free tier)
- AC2: GET /api/v1/webhooks → listar webhooks del usuario
- AC3: PUT /api/v1/webhooks/:id → actualizar URL/eventos/secreto
- AC4: DELETE /api/v1/webhooks/:id → eliminar
- AC5: POST /api/v1/webhooks/:id/test → enviar evento de prueba
- AC6: Firma HMAC-SHA256 en header X-WasiAI-Signature en cada delivery
- AC7: Evento credits.low funcional (dispara cuando balance < umbral)
- AC8: Migracion SQL incluida (tablas webhooks + webhook_deliveries)
- AC9: npx tsc --noEmit = 0 errores

---

## Wave 1 — Migracion SQL

Crear: `supabase/migrations/028_webhooks.sql`

```sql
CREATE TABLE IF NOT EXISTS webhooks (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  url         TEXT NOT NULL,
  secret      TEXT NOT NULL,
  events      TEXT[] NOT NULL DEFAULT '{}',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  webhook_id  TEXT NOT NULL REFERENCES webhooks ON DELETE CASCADE,
  event       TEXT NOT NULL,
  payload     JSONB NOT NULL,
  status_code INTEGER,
  success     BOOLEAN NOT NULL DEFAULT false,
  attempt     INTEGER NOT NULL DEFAULT 1,
  delivered_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_webhooks" ON webhooks
  FOR ALL USING (auth.uid() = user_id);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_see_own_deliveries" ON webhook_deliveries
  FOR SELECT USING (
    webhook_id IN (SELECT id FROM webhooks WHERE user_id = auth.uid())
  );

CREATE INDEX idx_webhooks_user ON webhooks(user_id);
CREATE INDEX idx_deliveries_webhook ON webhook_deliveries(webhook_id, delivered_at DESC);
```

---

## Wave 2 — Webhook Service

Crear: `src/lib/webhooks/deliverWebhook.ts`

```typescript
import crypto from 'crypto'

export interface WebhookPayload {
  event: string
  timestamp: string
  data: Record<string, unknown>
}

export async function deliverWebhook(
  url: string,
  secret: string,
  payload: WebhookPayload
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const body = JSON.stringify(payload)
  const signature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex')

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-WasiAI-Signature': `sha256=${signature}`,
        'X-WasiAI-Event': payload.event,
      },
      body,
      signal: AbortSignal.timeout(10_000), // 10s timeout
    })
    return { success: res.ok, statusCode: res.status }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
```

---

## Wave 3 — API Routes

### src/app/api/v1/webhooks/route.ts

Patrón de auth: el mismo que `src/app/api/v1/models/[slug]/invoke/route.ts` — leer ese archivo antes de implementar.

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import crypto from 'crypto'

export async function GET(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('webhooks')
    .select('id, url, events, is_active, created_at, updated_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ webhooks: data })
}

export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { url, events, secret } = await req.json()

  if (!url || !events?.length) {
    return NextResponse.json({ error: 'url and events are required' }, { status: 400 })
  }

  // Validar HTTPS en produccion
  const NODE_ENV = process.env.NODE_ENV
  if (new URL(url).protocol !== 'https:' && NODE_ENV === 'production') {
    return NextResponse.json({ error: 'URL must use HTTPS in production' }, { status: 400 })
  }

  // Limitar a 5 webhooks por usuario (free tier)
  const { data: countData } = await supabase
    .from('webhooks')
    .select('count', { count: 'exact', head: true })
    .eq('user_id', user.id)
  // equivalente a: SELECT count(*) FROM webhooks WHERE user_id = $1
  if ((countData as any) >= 5) {
    return NextResponse.json({ error: 'Maximum 5 webhooks allowed per user' }, { status: 422 })
  }

  const generatedSecret = secret ?? crypto.randomBytes(32).toString('hex')

  const { data: webhook, error } = await supabase
    .from('webhooks')
    .insert({ user_id: user.id, url, events, secret: generatedSecret })
    .select('id, url, events, is_active, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ webhook, secret: generatedSecret }, { status: 201 })
}
```

> **Nota:** Usar `count` via Supabase:
> ```typescript
> const { count } = await supabase
>   .from('webhooks')
>   .select('*', { count: 'exact', head: true })
>   .eq('user_id', user.id)
> if ((count ?? 0) >= 5) { ... }
> ```

### src/app/api/v1/webhooks/[id]/route.ts

Patrón de auth: idéntico al de `route.ts` arriba. Verificar siempre que `user_id = auth.uid()` antes de operar.

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const NODE_ENV = process.env.NODE_ENV

  if (body.url && new URL(body.url).protocol !== 'https:' && NODE_ENV === 'production') {
    return NextResponse.json({ error: 'URL must use HTTPS in production' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('webhooks')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('user_id', user.id) // ownership check — webhook pertenece al usuario autenticado
    .select('id, url, events, is_active, updated_at')
    .single()

  if (error || !data) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
  return NextResponse.json({ webhook: data })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('webhooks')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id) // ownership check
  
  if (error) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
```

### src/app/api/v1/webhooks/[id]/test/route.ts

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { deliverWebhook } from '@/lib/webhooks/deliverWebhook'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createRouteHandlerClient({ cookies })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: webhook, error } = await supabase
    .from('webhooks')
    .select('id, url, secret')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (error || !webhook) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })

  const payload = {
    event: 'test',
    timestamp: new Date().toISOString(),
    data: { message: 'Test webhook from WasiAI' },
  }

  // fire-and-forget — no bloquear la response
  deliverWebhook(webhook.url, webhook.secret, payload).then(async (result) => {
    await supabase.from('webhook_deliveries').insert({
      webhook_id: webhook.id,
      event: payload.event,
      payload,
      status_code: result.statusCode ?? null,
      success: result.success,
    })
  }).catch(console.error)

  return NextResponse.json({ ok: true, message: 'Test event dispatched' })
}
```

---

## Wave 4 — Evento credits.low

Crear: `src/lib/webhooks/triggerCreditsLow.ts`

```typescript
// Llamar cuando el balance del usuario baje del umbral
// Buscar webhooks del usuario que tengan 'credits.low' en events
// Llamar deliverWebhook para cada uno
// Guardar delivery en webhook_deliveries
```

Integracion: buscar donde se descuentan creditos (src/app/api/v1/models/[slug]/invoke/route.ts)
y llamar triggerCreditsLow despues de cada descuento si balance < threshold.

---

## Wave 5 — TypeScript check + commit

```bash
cd /home/ferdev/.openclaw/workspace/wasiai-v2
npx tsc --noEmit
git add src/lib/webhooks/ src/app/api/v1/webhooks/ supabase/migrations/028_webhooks.sql
git commit -m "feat(WAS-74 Fase 1): webhooks CRUD + delivery service + credits.low event"
git push origin master master:main
```

---

## Critical Constraints

1. Leer TODOS los archivos en src/app/api/v1/ antes de crear rutas nuevas — respetar patrones de auth
2. HTTPS obligatorio para URLs en produccion (NODE_ENV === 'production')
3. El secret se genera con crypto.randomBytes(32).toString('hex') si no se provee
4. Fase 2 (job.completed / job.failed) NO va en este SDD — es trabajo separado post-WAS-70
5. deliverWebhook es fire-and-forget en la ruta /test — no bloquear la response
6. Verificar si supabase/migrations/ existe antes de crear archivos ahi
