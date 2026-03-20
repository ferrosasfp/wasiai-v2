# Logic Audit — SDD #078 (commit `ab4e01a0e`)

**Auditor:** Logic Auditor subagent  
**Fecha:** 2026-03-19  
**Commit:** `ab4e01a0e5a6583b301c1264a2cad31faa4e0315`  
**Scope:** webhook_secret per-agent upstream auth

---

## AC Trazabilidad

| AC | Descripción | Implementado en | Línea | Status |
|----|-------------|-----------------|-------|--------|
| AC1 | Generar `whsec_<hex64>` en registro y almacenar en `agents.webhook_secret` | `register/route.ts` | 229 | ✅ |
| AC2 | Incluir `Authorization: Bearer` + `X-WasiAI-Agent-Id` en todos los flujos upstream | `invoke/route.ts:632`, `compose/route.ts:488`, `sandbox/route.ts:272`, `trial/route.ts:170`, `introspect/route.ts:175`, `mcp/route.ts:56`, `jobs/route.ts:101` | múltiples | ✅ |
| AC3 | Health probe NO incluye `webhook_secret` | `health/route.ts:26` — solo selecciona `slug,name,status,endpoint_url`; no setea headers de auth en el fetch | 26 | ✅ |
| AC4 | GET /api/creator/agents/[slug]/webhook-secret retorna secret en texto plano | `webhook-secret/route.ts:30` | 30 | ✅ |
| AC5 | Cliente no autenticado recibe HTTP 401 | `webhook-secret/route.ts:20` | 20 | ✅ |
| AC6 | POST rotate genera nuevo secret y lo retorna | `rotate/route.ts:41-50` | 41-50 | ✅ |
| AC7 | Creador de agente ajeno recibe HTTP 403 (GET y rotate) | `webhook-secret/route.ts:28`, `rotate/route.ts:35` | 28, 35 | ✅ |
| AC8 | Selects públicos NO exponen `webhook_secret` | `agents/route.ts:115`, `agents/[slug]/route.ts:34` — columnas explícitas sin webhook_secret | 115, 34 | ✅ * |
| AC9 | Backfill en migración para agentes existentes | `070_webhook_secret.sql:8-11` — UPDATE con WHERE webhook_secret IS NULL | 8-11 | ✅ |

> \* Ver Finding #3 sobre `select('*')` en introspect y mcp (no expone en respuesta, pero amplía superficie interna).

---

## Findings

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|---------------|
| F1 | 🟡 MEDIUM | Edge Case / Silent Degradation | `X-WasiAI-Agent-Id: ''` cuando `agentId` es undefined. La firma `agentId?: string` + el fallback `agentId ?? ''` hace que si `agentId` es undefined, el header se envíe vacío en lugar de omitirse. En producción `model.id` siempre existe, pero el fallback silencioso es engañoso y rompe el AC2 parcialmente para ese caso. | `mcp/route.ts:60` |
| F2 | 🟡 MEDIUM | Entropía del backfill sobreestimada | El comentario SQL afirma "256 bits de entropía efectiva". `now()` y `clock_timestamp()` dentro de la misma sentencia UPDATE son idénticos para todas las filas afectadas en esa transacción. Solo `random()` e `id` aportan diferenciación por fila. La entropía real es ≈128 bits (un md5) de variación única por fila, no 256. No compromete la seguridad en la práctica pero la documentación es incorrecta. | `070_webhook_secret.sql:9-11` |
| F3 | 🟡 MEDIUM | `select('*')` en flujos con autenticación | `mcp/route.ts:216` e `introspect/route.ts:247` usan `select('*')` para cargar el agente. Esto trae `webhook_secret` al runtime del servidor junto con todos los demás campos. No se expone en la respuesta (AC8 ✅), pero una refactorización futura que accidentalmente serialice `model` podría filtrar el secret. | `mcp/route.ts:216`, `introspect/route.ts:247` |
| F4 | 🟡 MEDIUM | Condicional débil en todos los flujos upstream | Todos los flujos usan `agent.webhook_secret ? ... : {}` — si un agente llega a tener `webhook_secret = null` (backfill fallido, inserción manual, etc.), la llamada upstream se hace **sin autenticación** sin ningún warning ni log. Debería fallar rápido con un error o loggear la anomalía. | `compose/route.ts:488`, `sandbox/route.ts:272`, `jobs/route.ts:101`, `trial/route.ts:170` |
| F5 | 🔵 LOW | `rotated_at` vs `updated_at` doble `new Date()` | En rotate, `updated_at` y `rotated_at` en la respuesta son dos llamadas separadas a `new Date()`. Si hay lag entre llamadas (raro pero posible), los timestamps difieren por milisegundos. Usar una sola variable `const now = new Date().toISOString()`. | `rotate/route.ts:43,49` |
| F6 | 🔵 LOW | Estado `rotated` sin botón de re-reveal | En `WebhookSecretWidget`, tras hacer "Entendido" el estado pasa a `hidden` y el secret queda en React state (no eliminado). Si el usuario hace click en "Mostrar secret" vuelve a hacer fetch al servidor. No es un bug lógico pero el secret persiste en memoria del componente hasta unmount. Sin impacto funcional. | `WebhookSecretWidget.tsx:68` |
| F7 | 🔵 LOW | `invoke-long` route no actualizada | `src/app/api/v1/agents/[slug]/invoke-long/route.ts` despacha a una URL interna (`/api/v1/internal/agents/${slug}/run`) y no al endpoint del agente directamente. Queda fuera del scope del SDD pero si el runner interno hace la llamada upstream, también debería incluir el secret. No analizado en este diff. | `invoke-long/route.ts:175` |
| F8 | 🟢 INFO | CSRF solo en rotate, no en GET reveal | El endpoint GET `/webhook-secret` no valida CSRF (solo el POST rotate lo hace). Correcto por convención HTTP: GET no tiene side effects, CSRF en GET no es requerido. Sin hallazgo. | `webhook-secret/route.ts` (expected) |

---

## Análisis Detallado por AC

### AC2 — Cobertura de flujos upstream

Los 7 flujos del SDD están cubiertos:

| Flujo | Header enviado | Condicional correcto |
|-------|---------------|----------------------|
| invoke | ✅ | ✅ (truthy check) |
| compose | ✅ | ✅ (truthy check) |
| sandbox | ✅ | ✅ (truthy check) |
| trial | ✅ | ✅ (truthy check) |
| introspect | ✅ | ✅ (truthy check) |
| mcp | ✅ ⚠️ F1 | ✅ pero agentId fallback `''` |
| jobs | ✅ | ✅ (truthy check) |

### AC1 — Generación del secret

`randomBytes(32).toString('hex')` produce exactamente 64 chars hex → `whsec_` + 64 = 70 chars total. Correcto y criptográficamente fuerte (Node.js CSPRNG).

### AC9 — Backfill SQL

La migración es correcta en estructura (nullable → backfill → NOT NULL). Ver F2 sobre entropía del backfill.

---

## Veredicto

**REQUIERE CORRECCIÓN** (2 findings MEDIUM bloqueantes)

### Correcciones prioritarias antes de merge a producción:

1. **F1** — En `mcp/route.ts`, cambiar `agentId ?? ''` por condicional explícito: solo incluir `X-WasiAI-Agent-Id` si `agentId` es truthy.
2. **F4** — En todos los flujos upstream, agregar un `logger.warn` cuando `webhook_secret` es null/falsy para detectar agentes sin secret en producción. No silenciar esta condición.

### Correcciones recomendadas (no bloqueantes):

3. **F2** — Corregir comentario en SQL (`~128 bits efectivos por fila`, no 256).
4. **F3** — Reemplazar `select('*')` en mcp e introspect por selects explícitos que incluyan `webhook_secret`.
5. **F5** — Una sola variable `now` en rotate.
