# SDD #078: Webhook Secret & Upstream Auth

> SPEC_APPROVED: yes — 2026-03-19
> Fecha: 2026-03-19
> Tipo: improvement | security
> SDD_MODE: full
> Branch: improvement/078-webhook-secret-upstream-auth
> Artefactos: .nexus/sprints/078-webhook-secret-upstream-auth/

---

## 1. Resumen

WasiAI llama al `endpoint_url` del creador en 7 flujos distintos (invoke, compose, sandbox, trial, introspect, mcp, jobs). Cinco de ellos usan un `x-internal-secret` global compartido — si se filtra, cualquiera puede impersonar a WasiAI contra cualquier agente. Dos flujos (mcp, jobs) no envían ninguna auth.

Esta HU reemplaza el shared secret por un `webhook_secret` por agente, generado automáticamente al registrar. Se envía en todos los flujos upstream. El creador puede verlo/rotarlo en su dashboard (opt-in) — si no le interesa, WasiAI lo gestiona transparentemente.

Resultado: infraestructura de auth granular por agente, sin fricción para consumidores (humanos, agentes, devs), con opción de seguridad adicional para creadores que la quieran.

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | 078 |
| **Tipo** | improvement / security |
| **SDD_MODE** | full |
| **Objetivo** | Auth granular por agente en todos los flujos upstream, reemplazando x-internal-secret global |
| **Reglas de negocio** | El creador opt-in para validar el secret. WasiAI siempre lo envía independientemente. |
| **Scope IN** | BD, 9 route handlers backend, 2 endpoints creator nuevos, 1 componente frontend |
| **Scope OUT** | SDK creador, logs rechazos, rotación automática, ventana de gracia, health probe |

### Acceptance Criteria (EARS)

1. WHEN se registra un agente THEN el sistema SHALL generar `whsec_<hex64>` y almacenarlo en `agents.webhook_secret`
2. WHEN WasiAI llama upstream vía cualquier flujo (invoke/compose/sandbox/trial/introspect/mcp/jobs) THEN SHALL incluir `Authorization: Bearer {webhook_secret}` y `X-WasiAI-Agent-Id: {agent_id}`
3. WHEN health probe llama al endpoint THEN SHALL NOT incluir `webhook_secret`
4. WHEN creador autenticado llama `GET /api/creator/agents/[slug]/webhook-secret` THEN SHALL retornar el secret en texto plano
5. WHEN cliente no autenticado llama ese endpoint THEN SHALL retornar HTTP 401
6. WHEN creador llama `POST /api/creator/agents/[slug]/webhook-secret/rotate` THEN SHALL generar nuevo secret y retornarlo
7. WHEN creador intenta ver/rotar secret de agente ajeno THEN SHALL retornar HTTP 403
8. WHEN cualquier select público de agentes ocurre THEN la respuesta SHALL NOT contener `webhook_secret`
9. WHEN la migración corre THEN todos los agentes existentes SHALL recibir un `webhook_secret` via backfill

---

## 3. Context Map

### Archivos leídos

| Archivo | Por qué | Patrón extraído |
|---------|---------|-----------------|
| `src/app/api/v1/mcp/route.ts` | Flujo sin auth | `callUpstreamMcp()` hace fetch sin headers de auth — agregar aquí |
| `src/app/api/v1/models/[slug]/invoke/route.ts` | Flujo con x-internal-secret | `callUpstream()` línea 628 — reemplazar header |
| `src/app/api/v1/compose/route.ts` | Flujo con x-internal-secret | fetch en línea 480 — reemplazar header |
| `src/app/api/v1/sandbox/invoke/[slug]/route.ts` | Flujo con x-internal-secret | fetch en línea 267 — reemplazar header |
| `src/app/api/v1/agents/[slug]/trial/route.ts` | Flujo con x-internal-secret | `reqHeaders` en línea 174 — reemplazar |
| `src/app/api/v1/agents/[slug]/introspect/route.ts` | Flujo con x-internal-secret | fetch en línea 171 — reemplazar |
| `src/app/api/v1/jobs/process/[id]/route.ts` | Flujo sin auth | fetch en línea 96 — agregar headers |
| `src/app/api/v1/agents/register/route.ts` | Registro de agentes | Patrón de inserción en `agentPayload` — agregar `webhook_secret` aquí |
| `src/app/api/creator/agents/[slug]/route.ts` | API creator existente | CSRF + ownership check + serviceClient — mismo patrón para nuevos endpoints |
| `src/app/[locale]/creator/dashboard/_components/WebhooksPanel.tsx` | UI de secret one-time | Banner "Guarda tu secret" con copy-to-clipboard — reusar UX |
| `src/app/[locale]/creator/dashboard/_components/FreeTrialToggle.tsx` | Widget inline por agente | Patrón de componente 'use client' inline en tabla de agentes |
| `src/app/[locale]/creator/dashboard/page.tsx` | Dashboard principal | Cómo se integran widgets por agente en la tabla |
| `supabase/migrations/069_agent_analytics_to_function.sql` | Última migración | Formato de archivo SQL a seguir |
| `src/features/agent-api/services/agent-keys.service.ts` | Generación de API keys | `generateApiKey()` usa `crypto.randomBytes` — mismo patrón para webhook_secret |

### Exemplars

| Para crear/modificar | Seguir patrón de | Razón |
|---------------------|------------------|-------|
| `webhook-secret/route.ts` (GET) | `src/app/api/creator/agents/[slug]/route.ts` | CSRF + auth + ownership check |
| `webhook-secret/rotate/route.ts` (POST) | `src/app/api/creator/agents/[slug]/route.ts` | CSRF + auth + ownership + serviceClient update |
| `WebhookSecretWidget.tsx` | `WebhooksPanel.tsx` (banner secret) + `FreeTrialToggle.tsx` (widget inline) | UX de secret + patrón inline por agente |
| Headers en `callUpstreamMcp` | `callUpstream` en invoke/route.ts | Mismo patrón de spread de headers condicional |
| Generación `webhook_secret` | `generateApiKey()` en agent-keys.service.ts | `crypto.randomBytes(32).toString('hex')` |

### Estado de BD

| Tabla | Existe | Columnas relevantes |
|-------|--------|---------------------|
| `agents` | Sí | `id`, `slug`, `endpoint_url`, `creator_id` — agregar `webhook_secret TEXT NOT NULL` |

### Componentes reutilizables

- Banner de secret one-time en `WebhooksPanel.tsx` (estado `newSecret`) — reusar para rotate
- `validateCsrf(req)` en `@/lib/security/csrf` — usar en POST rotate
- `createServiceClient()` para bypasear RLS en updates — mismo patrón
- `generateApiKey()` en `agent-keys.service.ts` — adaptar para generar `webhook_secret`

---

## 4. Diseño Técnico

### 4.1 Archivos a crear/modificar

| Archivo | Acción | Descripción | Exemplar |
|---------|--------|-------------|----------|
| `supabase/migrations/070_webhook_secret.sql` | Crear | ADD COLUMN + backfill + NOT NULL | `069_agent_analytics_to_function.sql` |
| `src/app/api/v1/agents/register/route.ts` | Modificar | Agregar `webhook_secret` en `agentPayload` | mismo archivo |
| `src/app/api/v1/mcp/route.ts` | Modificar | Leer `webhook_secret` del agente y enviar en `callUpstreamMcp` | `invoke/route.ts` callUpstream |
| `src/app/api/v1/models/[slug]/invoke/route.ts` | Modificar | Reemplazar `x-internal-secret` por `webhook_secret` en `callUpstream` | mismo archivo |
| `src/app/api/v1/compose/route.ts` | Modificar | Reemplazar `x-internal-secret` por `webhook_secret` en fetch upstream | mismo archivo |
| `src/app/api/v1/sandbox/invoke/[slug]/route.ts` | Modificar | Reemplazar `x-internal-secret` por `webhook_secret` | mismo archivo |
| `src/app/api/v1/agents/[slug]/trial/route.ts` | Modificar | Reemplazar `x-internal-secret` por `webhook_secret` | mismo archivo |
| `src/app/api/v1/agents/[slug]/introspect/route.ts` | Modificar | Reemplazar `x-internal-secret` por `webhook_secret` | mismo archivo |
| `src/app/api/v1/jobs/process/[id]/route.ts` | Modificar | Agregar `webhook_secret` en fetch upstream (actualmente sin auth) | `invoke/route.ts` |
| `src/app/api/creator/agents/[slug]/webhook-secret/route.ts` | Crear | GET — ver secret (auth + ownership) | `creator/agents/[slug]/route.ts` |
| `src/app/api/creator/agents/[slug]/webhook-secret/rotate/route.ts` | Crear | POST — rotar secret (CSRF + auth + ownership) | `creator/agents/[slug]/route.ts` |
| `src/app/[locale]/creator/dashboard/_components/WebhookSecretWidget.tsx` | Crear | Widget 'use client' — mostrar/copiar/rotar secret por agente | `WebhooksPanel.tsx` + `FreeTrialToggle.tsx` |
| `src/app/[locale]/creator/dashboard/page.tsx` | Modificar | Agregar `<WebhookSecretWidget slug={model.slug} />` en tabla de agentes | mismo archivo |

### 4.2 Modelo de datos

```sql
-- 070_webhook_secret.sql

-- 1. Agregar columna nullable primero (para el backfill)
ALTER TABLE agents ADD COLUMN webhook_secret TEXT;

-- 2. Backfill sin extensiones (md5 es nativo en PostgreSQL, no requiere pgcrypto)
UPDATE agents
SET webhook_secret = 'whsec_' || md5(random()::text || clock_timestamp()::text || id::text)
                               || md5(random()::text || id::text || now()::text)
WHERE webhook_secret IS NULL;
-- Resultado: 'whsec_' + 64 chars (dos md5 concatenados = 256 bits de entropía efectiva)

-- 3. Hacer NOT NULL después del backfill
ALTER TABLE agents ALTER COLUMN webhook_secret SET NOT NULL;
```
> **Nota:** Si `pgcrypto` está habilitado (verificar: `SELECT * FROM pg_extension WHERE extname = 'pgcrypto'`), reemplazar el UPDATE por `encode(gen_random_bytes(32), 'hex')` para mayor entropía criptográfica. El `md5` doble es el fallback nativo seguro.

**Nunca se incluye en selects públicos.** Los selects de listing (`GET /agents`) y detail (`GET /agents/[slug]`) no seleccionan esta columna — ya verificado que el body público no la expone.

### 4.3 Generación del secret

```
webhook_secret = 'whsec_' + crypto.randomBytes(32).toString('hex')
```
Resultado: `whsec_` + 64 caracteres hex = 70 caracteres totales, 256 bits de entropía. Mismo patrón que `generateApiKey()` en el proyecto.

Se genera en `register/route.ts` dentro de `agentPayload` antes del insert. **`register/route.ts` actualmente solo importa `createHash` de `crypto`** — el Builder debe actualizar el import a:
```ts
import { createHash, randomBytes } from 'crypto'
```

### 4.4 Headers upstream (todos los flujos)

Patrón unificado — reemplaza el spread de `x-internal-secret`:

```ts
// ANTES (flujos que tenían auth)
...(process.env.INTERNAL_API_SECRET ? { 'x-internal-secret': process.env.INTERNAL_API_SECRET } : {})

// DESPUÉS (todos los flujos)
...(model.webhook_secret ? {
  'Authorization': `Bearer ${model.webhook_secret}`,
  'X-WasiAI-Agent-Id': model.id,
} : {})
```

El fallback a `{}` cuando `webhook_secret` es null garantiza que si por alguna razón el backfill no corrió, no se envía `Authorization: Bearer null`.

**MCP:** `callUpstreamMcp()` (línea 40) actualmente recibe `(endpointUrl: string, input: string, options?)`. Cambiar firma a:
```
callUpstreamMcp(endpointUrl: string, input: string, options?, webhookSecret: string | null, agentId: string)
```
El call site en línea 239 ya tiene `model` disponible (select `'*'` en línea 208): `callUpstreamMcp(model.endpoint_url, input, options, model.webhook_secret, model.id)`

**Jobs:** el select actual (línea 72) es `'id, endpoint_url, user_id'` — agregar `webhook_secret`: `'id, endpoint_url, user_id, webhook_secret'`.

**Compose:** el select de agentes (líneas 244 y 292) es explícito — agregar `webhook_secret`: `'id, slug, name, price_per_call, endpoint_url, status, category, max_rpm, max_rpd, input_schema, output_schema, webhook_secret'`.

**Sandbox:** el select (línea 155) es `'id, endpoint_url, price_per_call, status, sandbox_enabled, input_schema, output_schema'` — agregar `webhook_secret`.

**Trial:** el select (línea 127) es `'id, endpoint_url, name, free_trial_enabled, free_trial_limit'` — agregar `webhook_secret`.

**Introspect:** usa `select('*')` (línea 244) — ya incluye `webhook_secret` automáticamente ✅.

**Invoke:** usa `select('*')` (línea 163) — ya incluye `webhook_secret` automáticamente ✅.

### 4.5 Endpoints creator nuevos

**GET `/api/creator/agents/[slug]/webhook-secret`**
```
1. validateCsrf (no aplica GET — omitir)
2. getUser() → 401 si no autenticado
3. serviceClient.from('agents').select('id, creator_id, webhook_secret').eq('slug', slug).single()
4. 404 si no existe
5. 403 si creator_id !== user.id
6. Retornar { webhook_secret: agent.webhook_secret }
```

**POST `/api/creator/agents/[slug]/webhook-secret/rotate`**
```
1. validateCsrf(req) → error si falla
2. getUser() → 401 si no autenticado
3. serviceClient.from('agents').select('id, creator_id').eq('slug', slug).single()
4. 404 si no existe
5. 403 si creator_id !== user.id
6. Generar nuevo_secret = 'whsec_' + randomBytes(32).toString('hex')
7. serviceClient.from('agents').update({ webhook_secret: nuevo_secret }).eq('id', agent.id)
8. Retornar { webhook_secret: nuevo_secret, rotated_at: new Date().toISOString() }
```

### 4.6 Flujo principal — Happy Path

**Registro:**
1. Creador llama `POST /api/v1/agents/register`
2. Sistema genera `webhook_secret = 'whsec_' + randomBytes(32).toString('hex')`
3. Inserta agente con `webhook_secret` en BD
4. Respuesta al creador no incluye `webhook_secret` (es interno)

**Invocación (cualquier flujo):**
1. Usuario/agente llama a WasiAI (invoke/compose/sandbox/etc.)
2. WasiAI valida auth del caller, verifica budget
3. WasiAI lee `webhook_secret` del agente desde BD
4. WasiAI llama `endpoint_url` con `Authorization: Bearer {webhook_secret}` y `X-WasiAI-Agent-Id: {id}`
5. Creador puede validar el header o ignorarlo

**Dashboard (ver secret):**
1. Creador visita `/creator/dashboard`
2. Ve `<WebhookSecretWidget>` por cada agente con botón "Mostrar secret"
3. Click → `GET /api/creator/agents/[slug]/webhook-secret` → muestra `whsec_abc...xyz` con botón copiar

**Rotación:**
1. Creador hace click en "Rotar secret" y confirma
2. `POST /api/creator/agents/[slug]/webhook-secret/rotate`
3. Banner: "⚠️ Nuevo secret generado — guarda este valor ahora"
4. Muestra nuevo secret completo con botón copiar
5. Llamadas futuras ya usan el nuevo secret

### 4.7 Flujos de error

| Caso | Comportamiento |
|---|---|
| `webhook_secret` es NULL en BD (no debería pasar post-backfill) | No enviar el header (fallback `{}`) — no romper la llamada |
| Creador no autenticado pide ver secret | HTTP 401 |
| Creador pide secret de agente ajeno | HTTP 403 |
| Agente externo rechaza la llamada (401 desde upstream) | Comportamiento actual — retorna error al caller (no se cambia) |
| Error en rotación (DB falla) | HTTP 500 con mensaje de error |

### 4.8 UI — WebhookSecretWidget

Estado del componente:
```
loading | hidden | revealed | rotating | rotated
```

UX:
```
[ Webhook Secret ]
Estado hidden: [••••••••••••••••] [Mostrar] [Rotar]
Estado revealed: whsec_abc...xyz  [Copiar ✓] [Ocultar] [Rotar]
Estado rotated: banner amarillo "⚠️ Nuevo secret — guarda ahora: whsec_xyz..." [Copiar] [Entendido]
```

Llamadas API:
- `GET /api/creator/agents/{slug}/webhook-secret` → al hacer click en Mostrar
- `POST /api/creator/agents/{slug}/webhook-secret/rotate` → al confirmar Rotar

### 4.9 Microcopy

| Elemento | Texto exacto |
|----------|-------------|
| Título sección | "Webhook Secret" |
| Botón mostrar | "Mostrar secret" |
| Botón ocultar | "Ocultar" |
| Botón copiar | "Copiar" / "Copiado ✓" |
| Botón rotar | "Rotar secret" |
| Confirm rotar | "¿Rotar el secret? Las llamadas con el secret anterior fallarán inmediatamente." |
| Banner rotado | "⚠️ Nuevo secret generado — guarda este valor ahora, no se mostrará de nuevo" |
| Descripción | "WasiAI envía este secret en cada llamada a tu endpoint. Valídalo en tu servidor para asegurarte que la llamada viene de WasiAI." |

---

## 5. Constraint Directives

### OBLIGATORIO seguir
- Patrón de auth en creator API: `createClient()` + `getUser()` + ownership check contra `creator_id` — ver `creator/agents/[slug]/route.ts`
- CSRF: `validateCsrf(req)` en POST de rotate (método mutante)
- `serviceClient` (bypass RLS) para updates en BD desde creator API — patrón existente
- Generación de secret: `'whsec_' + randomBytes(32).toString('hex')` — mismo patrón que `generateApiKey()`
- Headers upstream: spread condicional `...(secret ? { 'Authorization': ..., 'X-WasiAI-Agent-Id': ... } : {})`
- `'use client'` en `WebhookSecretWidget.tsx` — es interactivo
- Seguir estilos Tailwind de `WebhooksPanel.tsx` para el banner y de `FreeTrialToggle.tsx` para el widget inline

### PROHIBIDO
- NO incluir `webhook_secret` en ningún select público de agentes
- NO enviar `x-internal-secret` en flujos modificados — reemplazar, no acumular
- NO tocar `src/app/api/v1/agents/[slug]/health/route.ts` — explícitamente excluido del scope (es probe de disponibilidad, no invocación de producción)
- NO agregar dependencias npm nuevas
- NO modificar la firma pública de los endpoints existentes (solo agregar headers internos)
- NO hardcodear el prefijo `whsec_` — definirlo como constante si se usa en más de un lugar
- NO mostrar el `webhook_secret` en la respuesta de `POST /register` — es dato interno del creador

---

## 6. Scope

**IN:**
- Migración BD con backfill
- Generación de secret en registro
- Auth en 7 flujos upstream (invoke, compose, sandbox, trial, introspect, mcp, jobs)
- 2 endpoints creator (ver + rotar)
- 1 componente frontend `WebhookSecretWidget`
- Integración del widget en dashboard

**OUT:**
- `health/route.ts` — no necesita auth
- SDK del creador para validar el secret
- Logs de rechazos de upstream
- Rotación automática periódica
- Ventana de gracia al rotar
- RLS en Supabase para la columna

---

## 7. Waves de Implementación

### Wave 0 — Migración BD (SERIAL GATE — debe ir primero)
- [ ] W0.1: Crear y aplicar `supabase/migrations/070_webhook_secret.sql`
- [ ] W0.2: Verificar que todos los agentes tienen `webhook_secret` NOT NULL en dev
- **Build gate:** `SELECT count(*) FROM agents WHERE webhook_secret IS NULL` → debe retornar 0

### Wave 1 — Backend (paralelo entre sí, depende de W0)
- [ ] W1.1: `register/route.ts` — agregar generación de `webhook_secret` en `agentPayload`
- [ ] W1.2: `mcp/route.ts` — actualizar `callUpstreamMcp` para recibir y enviar secret
- [ ] W1.3: `invoke/route.ts` — reemplazar `x-internal-secret` por `webhook_secret` en `callUpstream`
- [ ] W1.4: `compose/route.ts` — reemplazar `x-internal-secret` por `webhook_secret`
- [ ] W1.5: `sandbox/invoke/route.ts` — reemplazar `x-internal-secret` por `webhook_secret`
- [ ] W1.6: `trial/route.ts` — reemplazar `x-internal-secret` por `webhook_secret`
- [ ] W1.7: `introspect/route.ts` — reemplazar `x-internal-secret` por `webhook_secret`
- [ ] W1.8: `jobs/process/[id]/route.ts` — agregar select de `webhook_secret` y enviar headers
- **Build gate:** `npx tsc --noEmit` sin errores

### Wave 2 — Creator API (depende de W0)
- [ ] W2.1: Crear `webhook-secret/route.ts` (GET)
- [ ] W2.2: Crear `webhook-secret/rotate/route.ts` (POST)
- **Build gate:** `npx tsc --noEmit` sin errores

### Wave 3 — Frontend (depende de W2)
- [ ] W3.1: Crear `WebhookSecretWidget.tsx`
- [ ] W3.2: Integrar en `dashboard/page.tsx`
- **Build gate:** `npx tsc --noEmit` sin errores + visual check en dev

### Wave 4 — Verificación end-to-end
- [ ] W4.1: Test manual MCP con key `wasi_e3feb...` → confirmar que ya no retorna 401 de upstream
- [ ] W4.2: Verificar que `GET /api/v1/agents/wasi-chainlink-price` no expone `webhook_secret`
- [ ] W4.3: Verificar GET creator secret → 200 con secret
- [ ] W4.4: Verificar POST rotate → nuevo secret generado

---

## 8. Riesgos

| Riesgo | Prob | Impacto | Mitigación |
|--------|------|---------|------------|
| Agentes externos que ya validaban `x-internal-secret` dejan de funcionar | Baja | Alto | El backfill genera secret nuevo — son agentes propios, actualizar sus validaciones |
| Migración backfill falla en prod por permisos de `gen_random_bytes` | Media | Alto | Verificar en dev primero; alternativa: usar `md5(random()::text || clock_timestamp()::text)` si `pgcrypto` no está habilitado |
| `callUpstreamMcp` en MCP no tiene acceso al objeto `model` completo | ~~Resuelto~~ | — | Firma actualizada en sección 4.4 — `model` disponible en call site vía `select('*')` línea 208 |
| Creador expone su `webhook_secret` públicamente | Baja | Bajo para WasiAI | Riesgo asumido por el creador — documentar en UI |

---

## 9. Dependencias

- `pgcrypto` o `gen_random_bytes` disponible en Supabase (verificar en Wave 0)
- Agentes activos en prod con `endpoint_url` válida para test end-to-end (Wave 4)

---

## 10. Rollback

Si el deploy falla:
1. Revertir migración: `ALTER TABLE agents DROP COLUMN webhook_secret;`
2. Revertir código de los route handlers a `x-internal-secret` (git revert)
3. Los agentes vuelven al comportamiento anterior

El rollback no afecta funcionalidad del usuario final — los flujos upstream funcionaban antes (con auth global o sin auth).
