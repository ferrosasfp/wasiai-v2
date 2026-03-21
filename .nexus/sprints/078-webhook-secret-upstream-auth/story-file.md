# Story File — #078: Webhook Secret & Upstream Auth

> SDD: .nexus/sprints/078-webhook-secret-upstream-auth/sdd.md
> Fecha: 2026-03-19
> Branch: improvement/078-webhook-secret-upstream-auth

---

## Goal

Agregar un `webhook_secret` por agente que WasiAI envía en **todos** los flujos que llaman al `endpoint_url` del creador (MCP, invoke, compose, sandbox, trial, introspect, jobs). Reemplaza el `x-internal-secret` global inseguro. El creador puede ver/rotar su secret en el dashboard (opt-in). Sin impacto en consumidores.

---

## Acceptance Criteria (EARS)

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

## Files to Modify/Create

| # | Archivo | Acción | Qué hacer | Exemplar |
|---|---------|--------|-----------|----------|
| 1 | `supabase/migrations/070_webhook_secret.sql` | Crear | ADD COLUMN + backfill + NOT NULL (ver sección Waves W0) | `supabase/migrations/069_agent_analytics_to_function.sql` |
| 2 | `src/app/api/v1/agents/register/route.ts` | Modificar | Agregar `randomBytes` al import de crypto. Agregar `webhook_secret: 'whsec_' + randomBytes(32).toString('hex')` en `agentPayload` antes del insert | mismo archivo |
| 3 | `src/app/api/v1/mcp/route.ts` | Modificar | Cambiar firma de `callUpstreamMcp` a `(endpointUrl, input, options?, webhookSecret: string\|null, agentId: string)`. En call site línea 239: pasar `model.webhook_secret, model.id`. Dentro de la función: agregar headers condicionales | `src/app/api/v1/models/[slug]/invoke/route.ts` → callUpstream |
| 4 | `src/app/api/v1/models/[slug]/invoke/route.ts` | Modificar | En `callUpstream()` reemplazar el spread de `x-internal-secret` por el patrón unificado con `webhook_secret`. El select es `'*'` — ya incluye `webhook_secret` ✅ | mismo archivo |
| 5 | `src/app/api/v1/compose/route.ts` | Modificar | Agregar `webhook_secret` al select explícito de agentes (líneas 244 y 292). Reemplazar `x-internal-secret` por patrón unificado en fetch upstream (línea 480) | mismo archivo |
| 6 | `src/app/api/v1/sandbox/invoke/[slug]/route.ts` | Modificar | Agregar `webhook_secret` al select (línea 155). Reemplazar `x-internal-secret` por patrón unificado en fetch (línea 267) | mismo archivo |
| 7 | `src/app/api/v1/agents/[slug]/trial/route.ts` | Modificar | Agregar `webhook_secret` al select (línea 127). Reemplazar `x-internal-secret` por patrón unificado (línea 174) | mismo archivo |
| 8 | `src/app/api/v1/agents/[slug]/introspect/route.ts` | Modificar | Usa `select('*')` — ya incluye `webhook_secret` ✅. Solo reemplazar `x-internal-secret` por patrón unificado (línea 171) | mismo archivo |
| 9 | `src/app/api/v1/jobs/process/[id]/route.ts` | Modificar | Agregar `webhook_secret` al select (línea 72): `'id, endpoint_url, user_id, webhook_secret'`. Agregar headers en fetch (línea 96) — actualmente sin auth | `src/app/api/v1/models/[slug]/invoke/route.ts` |
| 10 | `src/app/api/creator/agents/[slug]/webhook-secret/route.ts` | Crear | GET endpoint autenticado — ver secret del agente propio | `src/app/api/creator/agents/[slug]/route.ts` |
| 11 | `src/app/api/creator/agents/[slug]/webhook-secret/rotate/route.ts` | Crear | POST endpoint autenticado — rotar secret (CSRF requerido) | `src/app/api/creator/agents/[slug]/route.ts` |
| 12 | `src/app/[locale]/creator/dashboard/_components/WebhookSecretWidget.tsx` | Crear | Componente 'use client' — mostrar/copiar/rotar secret por agente | `WebhooksPanel.tsx` (banner) + `FreeTrialToggle.tsx` (widget inline) |
| 13 | `src/app/[locale]/creator/dashboard/page.tsx` | Modificar | Importar `WebhookSecretWidget` y renderizarlo por cada agente en la tabla (debajo de `FreeTrialToggle`) | mismo archivo |

---

## Exemplars

### Exemplar 1: Headers upstream unificados
**Usar para**: Archivos #3, #4, #5, #6, #7, #8, #9
**Patrón — ANTES (reemplazar):**
```ts
...(process.env.INTERNAL_API_SECRET ? { 'x-internal-secret': process.env.INTERNAL_API_SECRET } : {})
```
**Patrón — DESPUÉS (usar esto):**
```ts
...(model.webhook_secret ? {
  'Authorization': `Bearer ${model.webhook_secret}`,
  'X-WasiAI-Agent-Id': model.id,
} : {})
```
> `model` puede llamarse `agent` según el archivo — usar el nombre de variable que ya existe en ese contexto.

---

### Exemplar 2: Generación del secret
**Usar para**: Archivos #1 (backfill SQL), #2 (register), #10 rotate
**Patrón TypeScript:**
```ts
import { createHash, randomBytes } from 'crypto'
// ...
webhook_secret: 'whsec_' + randomBytes(32).toString('hex')
```
**Patrón SQL (backfill sin pgcrypto):**
```sql
'whsec_' || md5(random()::text || clock_timestamp()::text || id::text)
        || md5(random()::text || id::text || now()::text)
```

---

### Exemplar 3: Creator API — auth + ownership
**Archivo**: `src/app/api/creator/agents/[slug]/route.ts`
**Usar para**: Archivos #10 y #11
**Patrón clave:**
```ts
// Auth
const supabase = await createClient()
const { data: { user } } = await supabase.auth.getUser()
if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

// Ownership check (usar serviceClient para bypasear RLS)
const serviceClient = createServiceClient()
const { data: existing } = await serviceClient
  .from('agents')
  .select('id, creator_id')
  .eq('slug', slug)
  .single()
if (!existing) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
if (existing.creator_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
```
**CSRF (solo en métodos mutantes — POST):**
```ts
import { validateCsrf } from '@/lib/security/csrf'
const csrfError = validateCsrf(req)
if (csrfError) return csrfError
```

---

### Exemplar 4: Banner secret one-time (UI)
**Archivo**: `src/app/[locale]/creator/dashboard/_components/WebhooksPanel.tsx`
**Usar para**: Archivo #12
**Patrón clave:**
```tsx
{newSecret && (
  <div className="rounded-xl border border-yellow-300 bg-yellow-50 p-4 space-y-2">
    <p className="text-sm font-semibold text-yellow-800">
      ⚠️ Guarda tu secret ahora — no se mostrará de nuevo
    </p>
    <div className="flex items-center gap-2">
      <code className="flex-1 rounded bg-yellow-100 px-2 py-1 text-xs font-mono text-yellow-900 break-all">
        {newSecret}
      </code>
      <button onClick={() => navigator.clipboard.writeText(newSecret)}>
        Copiar
      </button>
    </div>
    <button onClick={() => setNewSecret(null)}>Entendido</button>
  </div>
)}
```

---

### Exemplar 5: Widget inline por agente (UI)
**Archivo**: `src/app/[locale]/creator/dashboard/_components/FreeTrialToggle.tsx`
**Usar para**: Archivo #12 (estructura) y #13 (cómo se integra)
**Patrón de integración en page.tsx:**
```tsx
<tr>
  <td colSpan={7} className="px-6 pb-4">
    <FreeTrialToggle slug={model.slug} ... />
  </td>
</tr>
// Agregar debajo:
<tr>
  <td colSpan={7} className="px-6 pb-4">
    <WebhookSecretWidget slug={model.slug} />
  </td>
</tr>
```

---

## Constraint Directives

### OBLIGATORIO
- Patrón de auth creator: `createClient()` + `getUser()` + ownership check — ver Exemplar 3
- `validateCsrf(req)` en el POST de rotate
- `serviceClient` (bypass RLS) para updates y reads en creator API
- Headers upstream: spread condicional — ver Exemplar 1
- `'use client'` en `WebhookSecretWidget.tsx`
- Estilos Tailwind: seguir `WebhooksPanel.tsx` para banner, `FreeTrialToggle.tsx` para widget
- Agregar `randomBytes` al import de crypto en `register/route.ts`

### PROHIBIDO
- NO incluir `webhook_secret` en ningún select público de agentes
- NO enviar `x-internal-secret` en flujos modificados — reemplazar completamente, no acumular ambos
- NO tocar `src/app/api/v1/agents/[slug]/health/route.ts`
- NO agregar dependencias npm nuevas
- NO modificar la firma pública de los endpoints existentes (solo agregar headers internos)
- NO mostrar `webhook_secret` en la respuesta de `POST /register`
- NO modificar archivos fuera de la tabla Files to Modify/Create
- NO "mejorar" código adyacente — solo el cambio específico

---

## Test Expectations

| Test | ACs que cubre | Framework | Tipo |
|------|--------------|-----------|------|
| `src/app/api/v1/agents/__tests__/register.test.ts` (si existe) | AC-1, AC-8 | Vitest | unit |
| `src/app/api/creator/agents/[slug]/__tests__/webhook-secret.test.ts` | AC-4, AC-5, AC-7 | Vitest | unit |

### Criterio Test-First

| Tipo de cambio | Test-first? |
|----------------|-------------|
| Generación de webhook_secret en register | Sí |
| GET/POST creator endpoints | Sí |
| Modificación de headers en flujos upstream | No (lógica trivial de spread) |
| Componente WebhookSecretWidget | No (UI) |
| Migración SQL | No |

---

## Waves

### Wave 0 — Migración BD (SERIAL GATE — completar antes de todo)
- [ ] W0.1: Crear `supabase/migrations/070_webhook_secret.sql` con:
  ```sql
  ALTER TABLE agents ADD COLUMN webhook_secret TEXT;
  UPDATE agents SET webhook_secret = 'whsec_' || md5(random()::text || clock_timestamp()::text || id::text) || md5(random()::text || id::text || now()::text) WHERE webhook_secret IS NULL;
  ALTER TABLE agents ALTER COLUMN webhook_secret SET NOT NULL;
  ```
- [ ] W0.2: Aplicar migración en dev: `supabase db push` o `supabase migration up`
- [ ] W0.3: Verificar: `SELECT count(*) FROM agents WHERE webhook_secret IS NULL;` → debe retornar 0
- **Build gate:** query retorna 0

### Wave 1 — Backend (paralelo entre sí, depende de W0)
- [ ] W1.1: `register/route.ts` → Archivo #2 → Exemplar 2
- [ ] W1.2: `mcp/route.ts` → Archivo #3 → Exemplar 1 + 2
- [ ] W1.3: `invoke/route.ts` → Archivo #4 → Exemplar 1
- [ ] W1.4: `compose/route.ts` → Archivo #5 → Exemplar 1
- [ ] W1.5: `sandbox/invoke/route.ts` → Archivo #6 → Exemplar 1
- [ ] W1.6: `trial/route.ts` → Archivo #7 → Exemplar 1
- [ ] W1.7: `introspect/route.ts` → Archivo #8 → Exemplar 1
- [ ] W1.8: `jobs/process/route.ts` → Archivo #9 → Exemplar 1
- **Build gate:** `npx tsc --noEmit` sin errores

### Wave 2 — Creator API (depende de W0)
- [ ] W2.1: Crear `webhook-secret/route.ts` (GET) → Archivo #10 → Exemplar 3
- [ ] W2.2: Crear `webhook-secret/rotate/route.ts` (POST) → Archivo #11 → Exemplar 3
- **Build gate:** `npx tsc --noEmit` sin errores

### Wave 3 — Frontend (depende de W2)
- [ ] W3.1: Crear `WebhookSecretWidget.tsx` → Archivo #12 → Exemplar 4 + 5
- [ ] W3.2: Integrar en `dashboard/page.tsx` → Archivo #13 → Exemplar 5
- **Build gate:** `npx tsc --noEmit` sin errores + visual check en dev

### Wave 4 — Verificación end-to-end
- [ ] W4.1: Test MCP: `curl -X POST "https://app.wasiai.io/api/v1/mcp?key=wasi_e3feb00fa9cb5e0dce018f0c86224b4735f7184eaa3ee9ae" -d '{"method":"tools/call","params":{"name":"wasiai_wasi_chainlink_price","arguments":{"input":"AVAX"}}}'` → debe retornar resultado, NO 401
- [ ] W4.2: `GET /api/v1/agents/wasi-chainlink-price` → respuesta NO contiene `webhook_secret`
- [ ] W4.3: `GET /api/creator/agents/{slug}/webhook-secret` con JWT válido → 200 con secret
- [ ] W4.4: `POST /api/creator/agents/{slug}/webhook-secret/rotate` → nuevo secret generado

### Verificación incremental

| Wave | Verificación al completar |
|------|--------------------------|
| W0 | `SELECT count(*) FROM agents WHERE webhook_secret IS NULL` → 0 |
| W1 | `npx tsc --noEmit` |
| W2 | `npx tsc --noEmit` |
| W3 | `npx tsc --noEmit` + visual en dev |
| W4 | curl end-to-end |

---

## Out of Scope

- `src/app/api/v1/agents/[slug]/health/route.ts` — NO tocar
- SDK del creador para validar el secret
- Logs de rechazos de upstream
- Rotación automática periódica
- Ventana de gracia al rotar
- RLS en Supabase para la columna
- Cualquier archivo no listado en la tabla Files to Modify/Create

---

## Escalation Rule

**Si algo no está en este Story File, PARA y pregunta a Architect.**
No inventar. No asumir. No improvisar.

Situaciones de escalación:
- Un archivo del exemplar ya no existe o tiene estructura diferente
- Un import no está disponible
- La tabla `agents` tiene columnas diferentes a lo esperado
- Ambigüedad en un AC
- El cambio requiere tocar archivos fuera de la tabla

---

*Story File generado por NexusAgil — Q4/F2.5 — 2026-03-19*
