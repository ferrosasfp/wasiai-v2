# WAS-244 — Work Item

**Tipo:** BUG FIX
**Clasificación:** HU-MINOR

## Descripción

`GET /api/v1/agents/[slug]/health` reporta `status: "healthy"` cuando el upstream devuelve 401.

**Root cause:** La ruta health hace un POST sin `Authorization` header. Desde WAS-079, wasiai-agents requiere `Bearer {webhook_secret}` en todos los requests. El probe recibe 401, pero la lógica `probe.ok || probe.status < 500` trata 401 (<500) como healthy.

**Fix:** Incluir `webhook_secret` en el select de agents y enviar `Authorization: Bearer {webhook_secret}` en el probe.

## Acceptance Criteria (EARS)

- **AC-01:** WHEN the health probe is sent to an upstream that requires Bearer auth, THEN the probe MUST include `Authorization: Bearer {webhook_secret}` from the agents table.
- **AC-02:** WHEN the upstream responds HTTP 200, THEN `status` MUST be `"healthy"`.
- **AC-03:** WHEN the upstream responds HTTP 4xx or 5xx (including 401), THEN `status` MUST be `"unhealthy"`.
- **AC-04:** WHEN `webhook_secret` is null or empty in the DB, THEN the probe MUST still be sent (without auth header) and result must be accurate.
- **AC-05:** The `webhook_secret` field MUST NOT appear in the API response.
- **AC-06:** Existing response shape (`slug`, `name`, `status`, `latency_ms`, `upstream_status`) MUST be preserved.

## Files

- `src/app/api/v1/agents/[slug]/health/route.ts` — MODIFY
