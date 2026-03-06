# Work Item #005 — HU-8.4: Rate Limiting configurable por creator

| Campo | Valor |
|-------|-------|
| **#** | 005 |
| **Linear** | WAS-44 |
| **Tipo** | feature |
| **SDD_MODE** | full |
| **Objetivo** | Permitir que cada creator configure límites de invocación por API key consumer para su agente. Upstash Redis ya está configurado. Rate limit aplica por `agent_key_id` (header X-API-Key). |
| **Reglas de negocio** | Creator configura max_rpm (default 60) y max_rpd (default 1000) en PublishForm. Límite aplica por combinación slug+api_key_hash en Upstash. Superar límite → 429 con header Retry-After. Migration: columnas max_rpm y max_rpd en tabla agents (siguiente: 025). |
| **Scope IN** | Migration 025 (max_rpm, max_rpd en agents). Campo en PublishForm. Middleware en /api/v1/agents/[slug]/invoke. Respuesta 429. |
| **Scope OUT** | Rate limiting global de WasiAI (ya existe). Dashboard de métricas de rate limit. |

## Acceptance Criteria

| # | AC |
|---|---|
| 1 | WHEN creator publica/edita agente, THE creator SHALL poder configurar max_rpm y max_rpd |
| 2 | WHEN consumer supera max_rpm, THE API SHALL responder 429 con header Retry-After en segundos |
| 3 | WHEN consumer supera max_rpd, THE API SHALL responder 429 con body `{error: "Daily limit reached"}` |
| 4 | WHEN rate limit no configurado, THE agente SHALL usar defaults (60 rpm, 1000 rpd) |
| 5 | WHILE consumer está dentro de límites, THE invocación SHALL proceder normalmente |
