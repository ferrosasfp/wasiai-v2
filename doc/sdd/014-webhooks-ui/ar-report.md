# AR Report — WAS-74: Webhooks UI y triggers
**Adversary:** San (NexusAgil)  
**Fecha:** 2026-03-02  
**Archivos revisados:** 8 (events.ts, triggerAgentEvent.ts, invoke/route.ts, deliveries/route.ts, retry cron/route.ts, WebhooksPanel.tsx, dashboard/page.tsx, 030_webhook_retry_index.sql)

---

## Tabla de hallazgos

| # | Categoría | Hallazgo | Severidad |
|---|-----------|----------|-----------|
| 1 | Seguridad | SSRF via DNS rebinding — validación solo verifica protocolo HTTPS, no rangos de IP privados | **BLOQUEANTE** |
| 2 | Race condition | Cron sin lock — dos ejecuciones simultáneas procesan las mismas deliveries | **BLOQUEANTE** |
| 3 | Lógica de negocio | Cron no filtra webhooks inactivos (`is_active = false`) — reintenta deliveries de webhooks desactivados | MENOR |
| 4 | Performance | Cron dispara hasta 50 HTTP calls externas en paralelo sin control de concurrencia | MENOR |
| 5 | Error handling | `handleToggle` y `handleDelete` en WebhooksPanel no notifican error al usuario | MENOR |
| 6 | Error handling | `handleExpand` (fetch de deliveries) no maneja errores — falla silenciosa | MENOR |
| 7 | Calidad de código | Prop `userId` en WebhooksPanel recibido pero marcado `_userId` (unused) — confuso | MENOR |
| 8 | Calidad de código | `deliveriesMap` no se invalida al refrescar lista — muestra datos stale | MENOR |
| 9 | Seguridad | Ownership check en deliveries endpoint | OK |
| 10 | Seguridad | CRON_SECRET protection en retry cron | OK |
| 11 | Lógica de negocio | Triggers async (fire-and-forget) — no bloquean response | OK |
| 12 | Lógica de negocio | Retry limit de 3 intentos correctamente implementado (`attempt < 3`) | OK |
| 13 | Pagos | `agent.invoked` se dispara después de verificar settlement — no antes del pago | OK |
| 14 | Auth | Dashboard page protegido con redirect si no hay sesión | OK |
| 15 | Performance | Límite de 5 webhooks por usuario implementado en POST /api/v1/webhooks | OK |
| 16 | Calidad de código | No hay `any` explícito en los archivos nuevos; imports correctos | OK |

---

## Detalle de BLOQUEANTES

### 🔴 BLOQUEANTE #1 — SSRF via DNS Rebinding

**Archivo:** `src/app/api/v1/webhooks/route.ts` (POST handler)

**Descripción:**  
La validación al registrar un webhook solo verifica que la URL use `https:` en producción:

```ts
if (new URL(url).protocol !== 'https:' && process.env.NODE_ENV === 'production') {
  return NextResponse.json({ error: 'URL must use HTTPS in production' }, { status: 400 })
}
```

Esto **no protege contra SSRF**. Un atacante puede registrar un dominio público que resuelve a una IP privada (e.g., `169.254.169.254` para AWS Instance Metadata, `10.x.x.x`, `192.168.x.x`). El servidor hará la petición HTTP outbound a la IP privada en el momento del delivery o retry.

Vectores de ataque:
- Registro de webhook apuntando a `https://attacker.com` → DNS rebinding hacia `169.254.169.254`
- Registro directo (si hay bypass de validación con dominios internos)

**Impacto:** Exfiltración de metadata cloud (AWS, GCP, Azure), escaneo de red interna, acceso a servicios internos sin autenticación.

**Acción requerida:**  
Implementar validación de IP range después de DNS resolution usando `validateEndpointUrl` (ya existe en `src/lib/security/validateEndpointUrl.ts` — se usa en invoke/route.ts):

```ts
import { validateEndpointUrl } from '@/lib/security/validateEndpointUrl'

try {
  validateEndpointUrl(url) // lanza si es IP privada/interna
} catch {
  return NextResponse.json({ error: 'URL apunta a dirección no permitida' }, { status: 400 })
}
```

**Referencia:** La misma función ya se usa para proteger `endpoint_url` de los agentes en invoke/route.ts. Aplicar el mismo patrón aquí es consistente con el codebase.

---

### 🔴 BLOQUEANTE #2 — Race Condition en Cron (Doble Delivery)

**Archivo:** `src/app/api/cron/retry-webhook-deliveries/route.ts`

**Descripción:**  
El cron selecciona las 50 deliveries fallidas más antiguas sin ningún mecanismo de exclusión mutua:

```ts
const { data: deliveries } = await supabase
  .from('webhook_deliveries')
  .select('id, webhook_id, event, payload, attempt')
  .eq('success', false)
  .lt('attempt', 3)
  .order('delivered_at', { ascending: true })
  .limit(50)
```

Si dos instancias del cron se ejecutan simultáneamente (restart de Vercel, retry automático, error de red que causa re-trigger), **ambas instancias seleccionarán las mismas 50 filas** y enviarán el webhook dos veces al endpoint del creador.

Consecuencias:
- Creadores reciben eventos duplicados
- `attempt` se puede incrementar dos veces: una delivery en attempt=1 termina en attempt=3 en una sola invocación del cron (quemando reintentos sin haber llegado al límite real)
- Inconsistencia en los stats de `retried`/`succeeded`

**Acción requerida:**  
Implementar exclusión mutua con Postgres Advisory Lock o SELECT FOR UPDATE SKIP LOCKED:

```sql
-- Opción A: SELECT FOR UPDATE SKIP LOCKED (nativa en Postgres)
SELECT id, webhook_id, event, payload, attempt
FROM webhook_deliveries
WHERE success = false AND attempt < 3
ORDER BY delivered_at ASC
LIMIT 50
FOR UPDATE SKIP LOCKED;
```

En Supabase, usar RPC con la query raw, o marcar las filas como "en proceso" antes de hacer el delivery:

```ts
// 1. Marcar como "processing" atómicamente
await supabase
  .from('webhook_deliveries')
  .update({ processing: true, processing_at: new Date().toISOString() })
  .eq('id', delivery.id)
  .eq('processing', false) // solo si no está ya en proceso
```

Alternativamente, agregar columna `locked_until TIMESTAMPTZ` y filtrar por `locked_until IS NULL OR locked_until < now()`.

---

## Detalle de MENORES

### 🟡 MENOR #3 — Cron retinta deliveries de webhooks desactivados

**Archivo:** `src/app/api/cron/retry-webhook-deliveries/route.ts`

El cron selecciona deliveries fallidas sin verificar si el webhook padre está activo (`is_active = true`). Si un creador desactiva un webhook, el cron seguirá intentando entregar sus deliveries pendientes hasta llegar al limit de 3 intentos.

**Fix:** Agregar join o filtro en la query de deliveries:
```ts
// En la query de webhooks involucrados, filtrar solo activos:
const { data: webhooks } = await supabase
  .from('webhooks')
  .select('id, url, secret')
  .in('id', webhookIds)
  .eq('is_active', true) // ← añadir
```
Y saltar deliveries cuyo webhook no esté en el map.

---

### 🟡 MENOR #4 — 50 HTTP calls externas en paralelo sin concurrency control

**Archivo:** `src/app/api/cron/retry-webhook-deliveries/route.ts`

`Promise.allSettled` con 50 deliveries puede abrir 50 conexiones HTTP externas simultáneas desde el mismo servidor. Esto puede:
- Saturar el file descriptor limit en serverless
- Generar spikes de latencia para otros requests
- Violar rate limits de los servidores externos

**Fix:** Usar un semáforo o p-limit para limitar concurrencia a 10:
```ts
import pLimit from 'p-limit'
const limit = pLimit(10)
await Promise.allSettled(deliveries.map(d => limit(() => processDelivery(d))))
```

---

### 🟡 MENOR #5 — WebhooksPanel: toggle/delete fallan silenciosamente

**Archivo:** `src/app/[locale]/creator/dashboard/_components/WebhooksPanel.tsx`

`handleToggle` revierte el estado en la UI si el request falla, pero no muestra mensaje de error al usuario. `handleDelete` no notifica si el DELETE falla.

```ts
// handleToggle — revert existe pero sin feedback
if (!res.ok) {
  setWebhooks(prev => prev.map(w => w.id === webhook.id ? { ...w, is_active: webhook.is_active } : w))
  // ← falta: setError('No se pudo actualizar el webhook')
}
```

**Fix:** Llamar `setError(...)` con mensaje descriptivo en los bloques de error.

---

### 🟡 MENOR #6 — handleExpand sin manejo de errores

**Archivo:** `src/app/[locale]/creator/dashboard/_components/WebhooksPanel.tsx`

```ts
async function handleExpand(id: string) {
  // ...
  const res = await fetch(`/api/v1/webhooks/${id}/deliveries`)
  const json = await res.json() as { deliveries?: Delivery[] }
  setDeliveriesMap(prev => ({ ...prev, [id]: json.deliveries ?? [] }))
  // ← no hay try/catch, no se verifica res.ok
}
```

Si el fetch falla (network error, 500), el panel queda en estado "Cargando..." indefinidamente porque `deliveriesMap[id]` nunca se setea.

**Fix:** Envolver en try/catch y setear `deliveriesMap[id] = []` con un mensaje de error visible.

---

### 🟡 MENOR #7 — Prop `userId` unused en WebhooksPanel

**Archivo:** `src/app/[locale]/creator/dashboard/_components/WebhooksPanel.tsx`

```ts
export function WebhooksPanel({ userId: _userId }: Props) {
```

El prop se recibe y se descarta inmediatamente. Las llamadas fetch usan la sesión del servidor (cookie de auth). El prop confunde: ¿debería usarse? ¿Es para futura personalización? Si no se usa, eliminarlo del interface y de la llamada en page.tsx para reducir ruido.

**Fix:** Eliminar el prop `userId` de `Props` y de `<WebhooksPanel userId={user.id} />` en page.tsx.

---

### 🟡 MENOR #8 — deliveriesMap no se invalida al recargar webhooks

**Archivo:** `src/app/[locale]/creator/dashboard/_components/WebhooksPanel.tsx`

El mapa de deliveries se cachea en `deliveriesMap` por `webhook.id` y nunca se invalida. Si el usuario hace refresh de la lista (`load()`) y luego expande un webhook que ya había expandido, ve datos stale (los que cargó la primera vez).

**Fix:** Limpiar `deliveriesMap` en la función `load()`:
```ts
const load = useCallback(async () => {
  setLoading(true)
  setDeliveriesMap({}) // ← limpiar cache al recargar
  // ...
}, [])
```

---

## Resumen ejecutivo

| Categoría | Resultado |
|-----------|-----------|
| Seguridad | ⚠️ BLOQUEANTE (SSRF via DNS rebinding) |
| Lógica de negocio | ✅ OK (async, retry limit correcto) |
| Pagos | ✅ OK (triggers después de payment verification) |
| Race conditions | ⚠️ BLOQUEANTE (cron sin lock) |
| Error handling | 🟡 MENOR (UI silencia errores) |
| Auth / Authorization | ✅ OK (ownership check, dashboard protegido) |
| Performance | 🟡 MENOR (50 concurrent HTTP, cron retries de webhooks inactivos) |
| Calidad de código | 🟡 MENOR (prop unused, cache stale) |

**Total: 2 BLOQUEANTE, 6 MENOR, 8 OK**

Los 2 BLOQUEANTEs deben corregirse antes de mergear WAS-74 a main. El SSRF es el más crítico por impacto de seguridad directo. La race condition es crítica por integridad de datos (deliveries duplicadas a creadores).
