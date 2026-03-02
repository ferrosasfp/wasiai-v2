# Report Final — WAS-74: Webhooks y Eventos para Agentes (UI)

**HU:** WAS-74 | **NNN:** 014 | **Sprint:** 14 | **Branch:** master  
**Fecha cierre:** 2026-03-02 | **Estado:** ✅ DONE

---

## Archivos creados / modificados

| # | Path | Acción |
|---|------|--------|
| 1 | `src/lib/webhooks/events.ts` | CREADO |
| 2 | `src/lib/webhooks/triggerAgentEvent.ts` | CREADO |
| 3 | `src/app/api/v1/models/[slug]/invoke/route.ts` | MODIFICADO |
| 4 | `src/app/api/v1/webhooks/[id]/deliveries/route.ts` | CREADO |
| 5 | `src/app/api/cron/retry-webhook-deliveries/route.ts` | CREADO |
| 6 | `src/app/[locale]/creator/dashboard/_components/WebhooksPanel.tsx` | CREADO |
| 7 | `src/app/[locale]/creator/dashboard/page.tsx` | MODIFICADO |
| 8 | `supabase/migrations/028_webhook_retry_index.sql` | CREADO |

---

## AC Status — 5/5 PASS

| AC | Criterio | Resultado |
|----|----------|-----------|
| AC-1 | Creator puede crear/editar/eliminar webhooks con URL + eventos | ✅ PASS |
| AC-2 | `agent.invoked` disparado en cada invocación exitosa | ✅ PASS |
| AC-3 | `agent.error` disparado cuando invocación falla | ✅ PASS |
| AC-4 | Retry automático con backoff exponencial (3 intentos) | ✅ PASS |
| AC-5 | `success: false` persiste en `webhook_deliveries` cuando endpoint retorna 4xx/5xx | ✅ PASS |

---

## Adversarial Review — BLOQUEANTEs

| # | Hallazgo | Estado |
|---|----------|--------|
| B-01 | SSRF via DNS rebinding — validación solo verificaba protocolo HTTPS, no rangos de IP privados | ✅ RESUELTO — validación de IP privadas añadida en `deliverWebhook.ts` |
| B-02 | Race condition en cron — dos ejecuciones simultáneas procesaban las mismas deliveries | ✅ RESUELTO — `SELECT ... FOR UPDATE SKIP LOCKED` implementado como lock |

Menores (6 hallazgos): No bloqueantes, documentados.

---

## Auto-Blindaje acumulado

- URL validation: bloquea `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- Cron lock via `FOR UPDATE SKIP LOCKED` — previene double-delivery
- `deliverWebhook` retorna `{ success: res.ok, statusCode }` — failure tracking correcto

---

## Build

| Gate | Resultado |
|------|-----------|
| `npx tsc --noEmit` | ✅ 0 errores |
| Code Review | ✅ APPROVED |
| QA | ✅ 5/5 PASS |
