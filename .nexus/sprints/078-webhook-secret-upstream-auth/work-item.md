# Work Item — WAS-078: Webhook Secret & Upstream Auth
**Tipo:** QUALITY  
**Fecha:** 2026-03-19 (v3 — análisis quirúrgico completo backend + frontend)

---

## Contexto

WasiAI es el intermediario entre usuarios y agentes externos. Cuando un usuario paga, WasiAI llama al `endpoint_url` del creador en nombre del usuario.

### Problema 1 — Auth global insegura en flujos upstream
`invoke`, `compose`, `sandbox`, `trial`, `introspect` envían un `x-internal-secret` **global** (una sola env var para todos los agentes). Esto es inseguro a escala: si un creador lo descubre por logs, puede falsificar llamadas como si fuera WasiAI hacia cualquier otro agente.

`mcp/route.ts` y `jobs/process/[id]/route.ts` no envían **ninguna** auth upstream.

### Problema 2 — Sin modelo de auth por agente
No existe un `webhook_secret` por agente. El creador no puede proteger su endpoint de forma granular. WasiAI no puede acreditarse ante cada creador de forma individual.

### Aclaración — endpoint_url NO está expuesta públicamente (verificado)
`GET /api/v1/agents/[slug]` selecciona `endpoint_url` de la BD para uso interno del handler, pero el body construido y serializado al cliente NO la incluye. No hay leak activo.

---

## Solución

### Modelo de auth por agente (webhook_secret)
Al registrar un agente, WasiAI genera automáticamente un `webhook_secret` único por agente (32 bytes aleatorios, formato `whsec_<hex64>`). Se almacena en texto plano en la BD (columna privada, nunca en selects públicos).

WasiAI envía el secret en **todos** los flujos que llaman upstream:
```
Authorization: Bearer {webhook_secret}
X-WasiAI-Agent-Id: {agent_id}
```

**El creador elige si validarlo (opt-in):**
- Si no le interesa → ignora el header, su endpoint acepta cualquier llamada
- Si quiere seguridad → activa la sección en su dashboard, copia el secret, lo valida en su servidor

Este modelo **reemplaza** el `x-internal-secret` global. Los flujos que ya lo enviaban pasan a usar el secret por agente.

El `health/route.ts` (probe de disponibilidad) **no necesita** el secret — es un ping, no una llamada de producción.

---

## Acceptance Criteria (EARS)

### Backend — Generación y almacenamiento
**AC-01:** WHEN se registra un agente (cualquier método de auth) THEN el sistema SHALL generar automáticamente un `webhook_secret` de 32 bytes de entropía en formato `whsec_<hex64>` y almacenarlo en la columna `webhook_secret` de la tabla `agents`.

**AC-02:** WHEN se re-registra un agente con un slug ya existente THEN el sistema SHALL retornar 409 (comportamiento actual) y NOT generar un nuevo `webhook_secret`.

**AC-03:** WHEN se realiza cualquier select público de agentes (listing, slug detail, MCP discovery) THEN la respuesta SHALL NOT contener el campo `webhook_secret`.

### Backend — Auth en flujos upstream
**AC-04:** WHEN WasiAI llama al `endpoint_url` de un agente vía MCP (`/api/v1/mcp`) THEN SHALL incluir `Authorization: Bearer {webhook_secret}` y `X-WasiAI-Agent-Id: {agent_id}`.

**AC-05:** WHEN WasiAI llama al `endpoint_url` de un agente vía invoke (`/api/v1/models/[slug]/invoke`) THEN SHALL incluir `Authorization: Bearer {webhook_secret}` y `X-WasiAI-Agent-Id: {agent_id}`, reemplazando `x-internal-secret`.

**AC-06:** WHEN WasiAI llama al `endpoint_url` de un agente vía compose (`/api/v1/compose`) THEN SHALL incluir `Authorization: Bearer {webhook_secret}` y `X-WasiAI-Agent-Id: {agent_id}`, reemplazando `x-internal-secret`.

**AC-07:** WHEN WasiAI llama al `endpoint_url` de un agente vía sandbox (`/api/v1/sandbox/invoke/[slug]`) THEN SHALL incluir `Authorization: Bearer {webhook_secret}` y `X-WasiAI-Agent-Id: {agent_id}`, reemplazando `x-internal-secret`.

**AC-08:** WHEN WasiAI llama al `endpoint_url` de un agente vía trial (`/api/v1/agents/[slug]/trial`) THEN SHALL incluir `Authorization: Bearer {webhook_secret}` y `X-WasiAI-Agent-Id: {agent_id}`, reemplazando `x-internal-secret`.

**AC-09:** WHEN WasiAI llama al `endpoint_url` de un agente vía introspect (`/api/v1/agents/[slug]/introspect`) THEN SHALL incluir `Authorization: Bearer {webhook_secret}` y `X-WasiAI-Agent-Id: {agent_id}`, reemplazando `x-internal-secret`.

**AC-10:** WHEN WasiAI llama al `endpoint_url` de un agente vía jobs (`/api/v1/jobs/process/[id]`) THEN SHALL incluir `Authorization: Bearer {webhook_secret}` y `X-WasiAI-Agent-Id: {agent_id}`.

**AC-11:** WHEN `health/route.ts` hace un probe de disponibilidad THEN SHALL NOT incluir `webhook_secret` en el request (es un ping, no una llamada de producción).

### Backend — API del creador (ver/rotar)
**AC-12:** WHEN el creador autenticado hace `GET /api/creator/agents/[slug]/webhook-secret` THEN el sistema SHALL retornar `{ webhook_secret: "whsec_..." }` en texto plano.

**AC-13:** WHEN un cliente no autenticado hace `GET /api/creator/agents/[slug]/webhook-secret` THEN el sistema SHALL retornar HTTP 401.

**AC-14:** WHEN un creador autenticado hace `POST /api/creator/agents/[slug]/webhook-secret/rotate` THEN el sistema SHALL generar un nuevo `webhook_secret`, persistirlo, y retornar el nuevo valor.

**AC-15:** WHEN un creador intenta ver/rotar el `webhook_secret` de un agente que no le pertenece THEN el sistema SHALL retornar HTTP 403.

### Frontend — Dashboard del creador
**AC-16:** WHEN el creador visita su dashboard THEN SHALL ver una sección "Webhook Secret" por agente con un botón "Mostrar secret".

**AC-17:** WHEN el creador hace click en "Mostrar secret" THEN el sistema SHALL llamar a `GET /api/creator/agents/[slug]/webhook-secret` y mostrar el valor con opción de copiar al portapapeles.

**AC-18:** WHEN el creador hace click en "Rotar secret" y confirma THEN el sistema SHALL llamar a `POST /api/creator/agents/[slug]/webhook-secret/rotate`, mostrar el nuevo valor con banner de advertencia "Guarda este valor — no se mostrará de nuevo" y ocultar el anterior.

**AC-19:** WHEN el secret está visible en el dashboard THEN SHALL mostrarse parcialmente ofuscado por defecto (ej. `whsec_abc...xyz`) con botón de reveal completo.

### Comportamiento sin cambios
**AC-20:** WHEN un agente no tiene `endpoint_url` configurado (estado draft) THEN ningún flujo upstream se ejecuta y el comportamiento actual no cambia.

---

## Archivos afectados

### Backend
| Archivo | Cambio |
|---|---|
| `supabase/migrations/070_webhook_secret.sql` | Columna `webhook_secret TEXT` en tabla `agents` (NOT NULL, DEFAULT gen aleatorio o NULL migración) |
| `src/app/api/v1/agents/register/route.ts` | Generar `webhook_secret` al insertar agente |
| `src/app/api/v1/mcp/route.ts` | Leer `webhook_secret` del agente + enviarlo en `callUpstreamMcp` |
| `src/app/api/v1/models/[slug]/invoke/route.ts` | Reemplazar `x-internal-secret` por `webhook_secret` en `callUpstream` |
| `src/app/api/v1/compose/route.ts` | Reemplazar `x-internal-secret` por `webhook_secret` |
| `src/app/api/v1/sandbox/invoke/[slug]/route.ts` | Reemplazar `x-internal-secret` por `webhook_secret` |
| `src/app/api/v1/agents/[slug]/trial/route.ts` | Reemplazar `x-internal-secret` por `webhook_secret` |
| `src/app/api/v1/agents/[slug]/introspect/route.ts` | Reemplazar `x-internal-secret` por `webhook_secret` |
| `src/app/api/v1/jobs/process/[id]/route.ts` | Agregar `webhook_secret` (actualmente sin auth) |
| `src/app/api/creator/agents/[slug]/webhook-secret/route.ts` | **NUEVO** — GET para ver secret (autenticado + ownership) |
| `src/app/api/creator/agents/[slug]/webhook-secret/rotate/route.ts` | **NUEVO** — POST para rotar secret (autenticado + ownership) |

### Frontend
| Archivo | Cambio |
|---|---|
| `src/app/[locale]/creator/dashboard/_components/WebhookSecretWidget.tsx` | **NUEVO** — componente por agente: mostrar/copiar/rotar secret |
| `src/app/[locale]/creator/dashboard/page.tsx` | Agregar `<WebhookSecretWidget>` por agente en la tabla de agentes |

---

## Patrones existentes a respetar

- `WebhooksPanel.tsx` ya tiene el patrón "secret one-time banner" con `newSecret` state → reusar UX idéntica para el rotate
- `FreeTrialToggle.tsx` es el patrón de toggle por agente en la tabla → `WebhookSecretWidget` sigue la misma estructura inline
- `AgentKeyWidget.tsx` es el patrón de widget de credenciales con copy-to-clipboard → reusar estilos
- Auth en API creator: siempre `createClient()` + `getUser()` + ownership check contra `creator_id` (ver `PATCH /api/creator/agents/[slug]`)
- CSRF: `validateCsrf(req)` en todos los métodos mutantes (POST de rotate)

---

## Migración BD — comportamiento crítico

La migración debe hacer **backfill automático** de todos los agentes existentes:

```sql
ALTER TABLE agents ADD COLUMN webhook_secret TEXT;

UPDATE agents
SET webhook_secret = 'whsec_' || encode(gen_random_bytes(32), 'hex')
WHERE webhook_secret IS NULL;

ALTER TABLE agents ALTER COLUMN webhook_secret SET NOT NULL;
```

**Por qué:** si la columna queda NULL en registros existentes y el código intenta construir `Authorization: Bearer null`, todos los agentes en producción rompen en el primer deploy. El backfill garantiza que todos los agentes tengan secret desde el momento del deploy.

El código backend debe omitir el header solo si `webhook_secret` es NULL (fallback seguro durante la ventana de migración), pero con el backfill esto nunca debería ocurrir.

## Out of scope
- SDK del creador para validar el secret en su servidor (solo docs en el futuro)
- Logs de llamadas rechazadas por el agente externo (deuda técnica)
- Rotación automática periódica de secrets
- Ventana de gracia al rotar (llamadas en vuelo pueden fallar — aceptado)
- `health/route.ts` — no necesita auth (probe de disponibilidad)
- RLS en Supabase para `webhook_secret` (controlado a nivel de API)
- Agentes existentes sin `webhook_secret` — la migración puede generar uno en el backfill o dejarlo NULL hasta primera llamada
