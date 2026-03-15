# Work Item — WAS-215: Health check automático al registrar agente

**Tipo:** Feature
**Clasificación:** QUALITY
**Fecha:** 2026-03-14
**Issue Linear:** WAS-215

---

## Historia de Usuario

**Como** agente autónomo o creador que registra un agente en WasiAI,
**quiero** saber inmediatamente si mi endpoint funciona al registrarlo,
**para** que mi agente quede activo al instante o sepa exactamente qué corregir sin polling.

---

## Contexto técnico

- Actualmente los agentes registrados vía `x-agent-key` o `open` quedan en `reviewing` indefinidamente.
- Ya existe `GET /api/v1/agents/:slug/health` que hace probe al endpoint — reutilizar la lógica.
- `validateEndpointUrlAsync` ya protege contra SSRF — correr ANTES del health check.
- El health check debe ser no-blocking para Vercel (timeout <10s, no bloquear el response si el agente es lento).
- Al hacer PATCH del `endpoint_url`, se debe re-disparar el health check automáticamente.

---

## Scope

**IN:**
- Health check síncrono en `POST /api/v1/agents/register` al momento del registro
- Si health check pasa (HTTP 2xx en <10s) → `status = active` inmediatamente
- Si falla → `status = reviewing`, respuesta incluye `health_check` con razón e instrucciones
- Nuevo endpoint `GET /api/v1/agents/:slug/status` — permite al agente consultar su estado actual
- PATCH `endpoint_url` en endpoint existente de creator dispara re-verificación → si pasa → `active`
- Respuesta 201 siempre incluye campo `health_check` con `passed`, `latency_ms` o `reason`

**OUT:**
- Cron de re-verificación periódica
- Email de notificación (siguiente iteración)
- Verified badge (manual)
- Banner UI en creator dashboard (siguiente iteración)

---

## Acceptance Criteria (EARS)

- **AC1:** WHEN `POST /api/v1/agents/register` es exitoso, THE system SHALL realizar un health check al `endpoint_url` (POST con `{"input":"ping"}`, timeout 10s) antes de retornar la respuesta.
- **AC2:** WHEN el health check retorna HTTP 2xx en <10s, THE agent `status` SHALL ser `active` y la respuesta 201 SHALL incluir `health_check: { passed: true, latency_ms: N }`.
- **AC3:** WHEN el health check falla (timeout, non-2xx, connection error), THE agent `status` SHALL ser `reviewing` y la respuesta 201 SHALL incluir `health_check: { passed: false, reason: "timeout|http_error|connection_error", message: "<instrucción de corrección>", fix: "PATCH /api/v1/agents/:slug with endpoint_url" }`.
- **AC4:** WHEN `GET /api/v1/agents/:slug/status` es llamado con `x-agent-key` válida del owner, THE endpoint SHALL retornar el `status` actual, `health_check` del último intento, y `last_checked_at`.
- **AC5:** WHEN `PATCH /api/creator/agents/:slug` recibe un nuevo `endpoint_url`, THE system SHALL disparar un health check y actualizar `status` a `active` si pasa.
- **AC6:** THE health check SHALL reutilizar `validateEndpointUrlAsync` para protección SSRF antes de hacer el probe.
- **AC7:** WHEN el health check probe falla con timeout, THE `reason` SHALL ser `"timeout"`. WHEN falla con HTTP non-2xx, SHALL ser `"http_error"` con el status code. WHEN hay error de conexión, SHALL ser `"connection_error"`.

---

## Definition of Done

- [ ] Health check integrado en register
- [ ] `GET /api/v1/agents/:slug/status` creado
- [ ] PATCH re-verificación funcional
- [ ] Tests unitarios de la lógica de health check
- [ ] E2E en prod confirmado
- [ ] Linear actualizado
