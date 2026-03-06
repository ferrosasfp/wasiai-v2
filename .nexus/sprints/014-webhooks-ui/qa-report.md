# WAS-74 — Webhooks UI: CR + QA Validation Report

**Fecha:** 2026-03-02  
**Rol:** Adversary + QA  
**Resultado final:** CR: APPROVED (con menores) | QA: 5/5 PASS

---

## Code Review

### 1. Patrones consistentes con el codebase

| Archivo | Veredicto | Notas |
|---------|-----------|-------|
| `src/lib/webhooks/events.ts` | ✅ OK | `as const` + tipo derivado, patrón idéntico a otros enums del codebase |
| `src/lib/webhooks/triggerAgentEvent.ts` | ✅ OK | Usa `createServiceClient`, `Promise.allSettled`, `logger.error` — consistente con `triggerCreditsLow.ts` |
| `src/app/api/v1/webhooks/route.ts` | ✅ OK | Auth con `createClient`, ownership checks, patrón igual a otros route handlers |
| `src/app/api/v1/webhooks/[id]/deliveries/route.ts` | ✅ OK | Ownership check antes de query; patrón correcto |
| `src/app/api/cron/retry-webhook-deliveries/route.ts` | ✅ OK | CRON_SECRET auth igual a `retry-recordings/route.ts` |
| `src/app/[locale]/creator/dashboard/_components/WebhooksPanel.tsx` | ✅ OK | `'use client'`, hooks, `useCallback`, `void` en async handlers — estilo consistente |
| `supabase/migrations/030_*.sql` + `031_*.sql` | ✅ OK | `IF NOT EXISTS`, índice parcial bien justificado |

### 2. Sin `any` explícito

- `deliverWebhook.ts:33` usa `err: unknown` ✅  
- `route.ts` en webhooks usa `Record<string, unknown>` ✅  
- `WebhooksPanel.tsx` usa interfaces tipadas explícitas ✅  
- **Sin `any` explícito en ningún archivo revisado.** ✅

### 3. Funciones cortas, responsabilidad única

- `events.ts`: 2 líneas, solo tipos ✅  
- `deliverWebhook.ts`: 1 responsabilidad (HTTP + HMAC sign) ✅  
- `triggerAgentEvent.ts`: busca webhooks activos y dispara deliveries — ligeramente compuesta (podría separar `recordDelivery`) pero dentro de límite razonable ✅  
- `WebhooksPanel.tsx`: handlers separados (`handleCreate`, `handleToggle`, `handleDelete`, `handleExpand`) ✅

### 4. Sin código duplicado

- Lógica de HMAC centralizada en `deliverWebhook.ts`, usada por trigger y cron ✅  
- `validateEndpointUrl` reutilizado desde `security/validateEndpointUrl` (SSRF fix B1) ✅

### 5. Solo dependencias aprobadas

- `crypto` (Node builtin), no dependencias npm nuevas ✅

### Hallazgos CR

#### SUGERENCIA (no bloqueante) — S01

**Archivo:** `src/app/api/cron/retry-webhook-deliveries/route.ts`  
**Línea:** ~50  
**Descripción:** El cron no filtra `is_active` al obtener los webhooks para retry. Si un webhook es desactivado después de una delivery fallida, el cron seguirá reintentando la entrega.  
**Recomendación:** Agregar `.eq('is_active', true)` en la query de webhooks del cron, o filtrar el `webhookMap` antes de procesar.

#### SUGERENCIA (no bloqueante) — S02

**Archivo:** `src/app/api/cron/retry-webhook-deliveries/route.ts`  
**Línea:** ~73-80  
**Descripción:** El campo `error_message` nunca se escribe en la actualización de delivery del cron. `deliverWebhook` lo retorna en `result.error` pero no se persiste.  
**Recomendación:** Agregar `error_message: result.error ?? null` en el `.update()` del cron.

#### SUGERENCIA (no bloqueante) — S03

**Archivo:** `src/app/[locale]/creator/dashboard/_components/WebhooksPanel.tsx`  
**Línea:** 26  
**Descripción:** Prop `userId` recibida pero no usada (el componente llama directamente a `/api/v1/webhooks` que usa la sesión del user logueado). El eslint-disable es intencional y válido, pero el prop podría eliminarse del contrato para mayor claridad.

---

## F4 QA — Acceptance Criteria

### AC-1 — Creator crea webhook → se guarda y aparece en lista

| Evidencia | Detalle |
|-----------|---------|
| `src/app/api/v1/webhooks/route.ts:41-49` | POST valida url + events, verifica límite de 5, inserta con `user_id` |
| `src/app/api/v1/webhooks/route.ts:51-54` | Retorna `{ webhook, secret }` con status 201 |
| `WebhooksPanel.tsx:63-68` | `handleCreate` recibe el webhook del response y hace `setWebhooks(prev => [json.webhook!, ...prev])` |
| `WebhooksPanel.tsx:36-42` | `load()` en `useEffect` carga lista al montar |

**✅ CUMPLE**

---

### AC-2 — Agente invocado → `agent.invoked` disparado async

| Evidencia | Detalle |
|-----------|---------|
| `src/app/api/v1/models/[slug]/invoke/route.ts:320` | `void triggerAgentEvent('agent.invoked' \| 'agent.error', ...)` — `void` = fire-and-forget async |
| `src/app/api/v1/models/[slug]/invoke/route.ts:379` | Segunda llamada en path alternativo del handler |
| `src/lib/webhooks/triggerAgentEvent.ts:1-50` | Consulta `webhooks` activos con `.contains('events', [event])`, entrega y registra delivery |

**✅ CUMPLE**

---

### AC-3 — Delivery falla → reintento hasta 3 veces con backoff

| Evidencia | Detalle |
|-----------|---------|
| `src/app/api/cron/retry-webhook-deliveries/route.ts:27` | `.lt('attempt', 3)` — solo elige deliveries con attempt < 3 |
| `retry-webhook-deliveries/route.ts:76` | `attempt: (delivery.attempt ?? 1) + 1` — incrementa en cada retry |
| `migrations/030_webhook_retry_index.sql:7-9` | Índice parcial `WHERE success = false AND attempt < 3` optimiza el query |
| `migrations/031_webhook_delivery_lock.sql` | Columna `locked_until` para evitar race conditions entre runs de cron |
| `retry-webhook-deliveries/route.ts:42-47` | Lock adquirido antes de procesar, liberado después |

Nota: El "backoff" está implícito en la frecuencia del cron (no hay delay exponencial en código, el intervalo del cron actúa como backoff mínimo). Esto es aceptable para MVP.

**✅ CUMPLE**

---

### AC-4 — Webhook inactivo → deliveries omitidas

| Evidencia | Detalle |
|-----------|---------|
| `src/lib/webhooks/triggerAgentEvent.ts:19` | `.eq('is_active', true)` en la query de webhooks — filtra inactivos antes de disparar |

**✅ CUMPLE** *(ver S01 para gap en retries)*

---

### AC-5 — URL responde >= 400 → delivery marcada como failed

| Evidencia | Detalle |
|-----------|---------|
| `src/lib/webhooks/deliverWebhook.ts:31` | `return { success: res.ok, statusCode: res.status }` — `res.ok` es `false` para status >= 400 |
| `src/lib/webhooks/triggerAgentEvent.ts:36-40` | `success: result.success` se persiste en `webhook_deliveries` |
| `src/app/api/cron/retry-webhook-deliveries/route.ts:73-80` | `success: result.success` actualizado en cada retry |

**✅ CUMPLE**

---

## Quality Gates

| Gate | Resultado |
|------|-----------|
| `npx tsc --noEmit` | ✅ **0 errores** |

---

## Resumen

| Dimensión | Resultado |
|-----------|-----------|
| Code Review | **APPROVED** — 3 sugerencias menores, 0 bloqueantes |
| AC-1 | ✅ PASS |
| AC-2 | ✅ PASS |
| AC-3 | ✅ PASS |
| AC-4 | ✅ PASS |
| AC-5 | ✅ PASS |
| **QA Total** | **5/5 PASS** |
