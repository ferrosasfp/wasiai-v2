# Sprint: Marketplace Health & Trust
**Fecha:** 2026-03-23
**Origen:** Diagnóstico automatizado de endpoints externos en producción
**Clasificación general:** HU-MAJOR (múltiples archivos, afecta confianza del marketplace)

---

## WAS-276 — Bloquear dominios de desarrollo en endpoint_url [HU-MINOR]

**Contexto:**
`agentlinkedin-credential-verifier` fue publicado con `https://agentlinkedin-api.loca.lt/...` (localtunnel). `validateEndpointUrl` bloquea IPs privadas y localhost pero no dominios de tunnel conocidos.

**Acceptance Criteria (EARS):**
- WHEN un creador registra un agente con endpoint que contiene dominio de tunnel conocido (`*.loca.lt`, `*.ngrok.io`, `*.ngrok-free.app`, `*.trycloudflare.com`, `*.serveo.net`, `*.localhost.run`, `*.pagekite.me`) THEN el sistema rechaza con 422 y mensaje claro
- WHEN el dominio es legítimo de producción THEN el registro procede normalmente
- WHEN se actualiza el endpoint de un agente existente THEN se aplica la misma validación

**Archivos afectados:**
- `src/lib/security/validateEndpointUrl.ts` — agregar lista de blocked TLDs/dominios de tunnel

---

## WAS-277 — Health check automático al activar un agente [HU-MAJOR]

**Contexto:**
`probeEndpoint()` existe en `src/lib/agents/health-probe.ts` pero nunca se invoca al hacer `status: active`. Los 5 agentes rotos llevan días activos sin que nadie lo detecte.

**Acceptance Criteria (EARS):**
- WHEN un agente cambia a `status: active` (via creator dashboard o registro) THEN se ejecuta `probeEndpoint()` antes de confirmar el cambio
- IF el probe falla (4xx, 5xx, timeout) THEN el agente queda en `status: reviewing` y el creador recibe error descriptivo
- WHEN el probe pasa THEN `last_checked_at` y `health_check` se actualizan correctamente
- WHEN el probe falla por primera vez THEN el agente queda en `reviewing`, no en `draft` (UX menos disruptiva)

**Archivos afectados:**
- `src/app/api/creator/agents/[slug]/status/route.ts` — invocar probe pre-activación
- `src/app/api/v1/agents/register/route.ts` — idem al auto-activar en bootstrap
- `src/lib/agents/health-probe.ts` — posible ajuste de ProbeStatus

---

## WAS-278 — Cron de health check periódico para agentes activos [HU-MAJOR]

**Contexto:**
No hay ningún cron que verifique endpoints de agentes activos. Un agente puede romperse post-publicación y nadie lo sabe. Los campos `last_checked_at`, `health_check`, `performance_score` existen pero permanecen null indefinidamente.

**Acceptance Criteria (EARS):**
- WHEN el cron corre THEN prueba todos los agentes con `status: active` en batches de 10
- IF un agente falla 3 veces consecutivas THEN su `status` cambia a `degraded` (nuevo valor o usando `reviewing`)
- WHEN el agente vuelve a responder OK THEN `status` regresa a `active` automáticamente
- WHEN el cron corre THEN actualiza `last_checked_at` y `performance_score` para cada agente probado
- IF el cron está en Vercel THEN respetar el timeout de 30s (procesar en batches paginados con `after`)

**Archivos afectados:**
- `src/app/api/cron/health-check-agents/route.ts` — nuevo cron
- `vercel.json` — agregar cron schedule
- `src/lib/agents/health-probe.ts` — reusar lógica existente

---

## WAS-279 — Gate: onboarding completo antes de publicar agente [HU-MINOR]

**Contexto:**
Los 4 creadores con agentes rotos tienen `onboarding_completed: false` y `onboarding_step: 1`. Sus agentes están `active`. Debería existir un gate que impida activar agentes hasta que el creador haya completado el onboarding mínimo (al menos wallet configurada).

**Acceptance Criteria (EARS):**
- WHEN un creador intenta publicar (status → active) con `onboarding_completed: false` THEN el sistema rechaza con 403 y mensaje "Completa tu perfil de creador antes de publicar"
- WHEN el creador completa el onboarding THEN puede publicar normalmente
- WHEN el agente es de tipo interno (sin `creator_id`) THEN el gate no aplica

**Archivos afectados:**
- `src/app/api/creator/agents/[slug]/status/route.ts` — agregar check de onboarding
- `src/app/api/v1/agents/register/route.ts` — idem en auto-activate

---

## WAS-280 — Integridad: creator_id NOT NULL en agentes activos [HU-MINOR]

**Contexto:**
`gatesolve-captcha` tiene `creator_id = null` y está activo. En el flujo de settlement el 90% va al `creator_wallet` — si no hay creador, ese dinero no se distribuye correctamente.

**Acceptance Criteria (EARS):**
- WHEN un agente con `creator_id = null` recibe una llamada exitosa THEN el 90% va a un wallet de treasury definido (no se pierde)
- WHEN se intenta activar un agente sin `creator_id` vía API THEN el sistema rechaza con 422
- WHEN `gatesolve-captcha` (y cualquier agente existente con creator_id null) está activo THEN se marca como `reviewing` hasta que un admin asigne creator o confirme treasury route

**Archivos afectados:**
- `src/app/api/v1/models/[slug]/invoke/route.ts` — fallback wallet si `creator_id` null
- `src/app/api/creator/agents/[slug]/status/route.ts` — validación pre-activación
- Migration SQL — constraint o check en DB

---

## WAS-281 — Mensaje 429 mutex más claro [FAST-FIX]

**Contexto:**
Cuando se hacen dos llamadas concurrentes con la misma key, el sistema devuelve `429 Concurrent invocation in progress for this key` sin contexto adicional. El `Retry-After: 5` está pero el mensaje no explica qué hacer.

**Acceptance Criteria (EARS):**
- WHEN se devuelve 429 por mutex THEN el body incluye `retry_after_seconds: 5` y `hint: "Your key has a call in progress. Wait and retry."`
- WHEN el header `Retry-After` está presente THEN el valor coincide con `retry_after_seconds`

**Archivos afectados:**
- `src/app/api/v1/models/[slug]/invoke/route.ts` — mejorar response body del 429

---

## WAS-282 — Detección de cuentas multi-alias (spam/bot) [HU-MINOR]

**Contexto:**
`oldlanguage75@agentmail.to` registró 3 cuentas (+2, +3) con el mismo dominio y publicó 3 agentes apuntando al mismo servidor roto. No hay detección de email domain repetido en múltiples cuentas.

**Acceptance Criteria (EARS):**
- WHEN se registra un nuevo usuario con email de dominio ya presente en >2 cuentas THEN se marca la cuenta como `pending_review` y se bloquea la publicación de agentes
- WHEN un admin revisa y aprueba THEN la cuenta puede publicar normalmente
- WHEN el dominio es de proveedor masivo conocido (gmail, hotmail, outlook, etc.) THEN la regla no aplica (solo afecta dominios custom/agentmail style)

**Archivos afectados:**
- `src/app/api/v1/auth/agent-signup/route.ts` — check de dominio en registro
- `src/app/api/creator/agents/[slug]/status/route.ts` — check de `pending_review`
- Nueva columna o campo en `creator_profiles`

---

## WAS-283 — Badge de salud de endpoint en marketplace UI [HU-MAJOR]

**Contexto:**
Los compradores no pueden saber si un agente está funcionando o roto antes de comprar. Los campos `health_check`, `last_checked_at` y `performance_score` existen en DB pero no se muestran en la UI.

**Acceptance Criteria (EARS):**
- WHEN un usuario ve el marketplace THEN cada agente muestra un badge: `✅ Online`, `⚠️ Degraded`, `❌ Down`, o `— Not checked`
- WHEN el badge es `Degraded` o `Down` THEN tiene tooltip con "Last checked: X min ago"
- WHEN el agente tiene `performance_score` THEN se muestra junto al badge
- WHEN `last_checked_at` es null THEN se muestra `— Not checked`

**Archivos afectados:**
- `src/app/[locale]/(public)/marketplace/` — componentes de card de agente
- `src/app/api/v1/agents/route.ts` — incluir `health_check`, `last_checked_at`, `performance_score` en response

---

## WAS-284 — Upstream errors propagan HTTP status correcto [HU-MINOR]

**Contexto:**
Cuando el endpoint externo falla (404, 408, etc.), WasiAI devuelve `200 OK` con `{"result":{"error":"Upstream 404"}, "meta":{"status":"error"}}`. Esto rompe cualquier cliente que confíe en HTTP status codes estándar.

**Acceptance Criteria (EARS):**
- WHEN el upstream devuelve 4xx THEN WasiAI devuelve `502 Bad Gateway` con el body de error actual
- WHEN el upstream devuelve 5xx THEN WasiAI devuelve `503 Service Unavailable`
- WHEN el upstream da timeout THEN WasiAI devuelve `504 Gateway Timeout`
- WHEN la llamada es exitosa THEN se mantiene `200 OK` (sin cambio)
- IF el charged es 0 (no se cobró) THEN incluir `"refunded": true` en meta

**Archivos afectados:**
- `src/app/api/v1/models/[slug]/invoke/route.ts` — mapear upstream errors a HTTP codes correctos

---

## Prioridad y dependencias

| # | Issue | Clasificación | Prioridad | Depende de |
|---|-------|--------------|-----------|------------|
| 1 | WAS-281 (mutex 429) | FAST-FIX | 🔴 Alta | — |
| 2 | WAS-276 (block tunnel domains) | HU-MINOR | 🔴 Alta | — |
| 3 | WAS-280 (creator_id null) | HU-MINOR | 🔴 Alta | — |
| 4 | WAS-284 (upstream HTTP codes) | HU-MINOR | 🔴 Alta | — |
| 5 | WAS-277 (health check pre-activación) | HU-MAJOR | 🟡 Media | WAS-276 |
| 6 | WAS-279 (onboarding gate) | HU-MINOR | 🟡 Media | — |
| 7 | WAS-278 (cron health check) | HU-MAJOR | 🟡 Media | WAS-277 |
| 8 | WAS-282 (spam detection) | HU-MINOR | 🟢 Baja | — |
| 9 | WAS-283 (badge salud UI) | HU-MAJOR | 🟢 Baja | WAS-278 |
