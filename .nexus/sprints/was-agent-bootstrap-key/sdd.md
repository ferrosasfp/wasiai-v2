# SDD #093: Agent Bootstrap Key — WAS-271

> SPEC_APPROVED: yes
> Fecha: 2026-03-21
> Tipo: feature/improvement
> SDD_MODE: full
> Branch: feature/093-agent-bootstrap-key
> Sprint dir: .nexus/sprints/was-agent-bootstrap-key/

---

## 1. Resumen

El endpoint `POST /api/v1/agents/register` acepta registros `open` sin identidad y deja agentes con `creator_id = null` y sin `management_key`. Se añade un flujo de **bootstrap anónimo**: cuando un agente llega sin JWT, sin agent key y sin creator_email, el sistema genera automáticamente un `auth.users` con email sintético, crea el `creator_profile`, registra el agente y emite una `management_key`. De ahí en adelante el agente usa esa key como identidad.

De paso se corrige el probe: HTTP 4xx significa endpoint vivo (status `reviewing`), solo 5xx/timeout/error → `draft`.

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | 093 / WAS-271 |
| **Tipo** | feature/improvement |
| **SDD_MODE** | full |
| **Objetivo** | Eliminar agentes huérfanos en registros open; emitir management_key siempre |
| **Reglas de negocio** | creator_profiles.id y agent_keys.owner_id son FK a auth.users — requiere auth.users entry primero |
| **Scope IN** | register/route.ts, health-probe.ts |
| **Scope OUT** | Challenge/recovery (WAS-272), revalidación periódica (WAS-273), UI, wallet, schema changes |

### Acceptance Criteria

AC1 — Bootstrap anónimo con orden exacto de operaciones
AC2 — creator_email tiene precedencia sobre bootstrap (ya implementado)
AC3 — Respuesta incluye management_key + warning + next_steps con campos exactos
AC4 — jwt y agent_key sin breaking changes
AC5 — Rollback en cadena: fallo en cualquier paso → deleteUser best-effort → error code
AC6 — Username único con hasta 3 intentos de sufijo
AC7 — Fix probe: 4xx → reviewing, 5xx/timeout → draft, ProbeStatus incluye 'draft'
AC8 — tsc limpio

---

## 3. Context Map

### Archivos leídos

| Archivo | Por qué | Patrón extraído |
|---------|---------|-----------------|
| `src/app/api/v1/agents/register/route.ts` | Archivo principal a modificar | `resolveCreatorFromEmail()` — patrón exacto para bootstrap; orden de operaciones actual; `generateApiKey()` ya importado; `randomBytes` ya importado |
| `src/lib/agents/health-probe.ts` | Fix probe 4xx | `ProbeStatus = 'active' \| 'reviewing'`; `updateAgentHealth(serviceClient, agentId, status, healthCheck)` — extender type + ajustar lógica |
| `supabase/migrations/00000000000003_wasiai_core.sql` | Verificar schema | `creator_profiles(id UUID FK auth.users, username TEXT UNIQUE NOT NULL, display_name TEXT)` — username tiene UNIQUE constraint; insert requiere auth.users primero |

### Exemplars

| Para | Seguir patrón de | Razón |
|------|-----------------|-------|
| `bootstrapAnonymousCreator()` | `resolveCreatorFromEmail()` en register/route.ts | Mismo flujo: createUser → upsert creator_profile → retornar userId |
| ProbeStatus extension | Línea 9 de health-probe.ts | Agregar `'draft'` al union type existente |

### Estado de BD relevante

| Tabla | Existe | Columnas relevantes |
|-------|--------|---------------------|
| `auth.users` | ✅ | Gestionado por Supabase Auth admin API |
| `creator_profiles` | ✅ | `id UUID FK auth.users`, `username TEXT UNIQUE NOT NULL`, `display_name TEXT` |
| `agent_keys` | ✅ | `owner_id UUID FK auth.users`, `key_hash TEXT UNIQUE NOT NULL`, `budget_usdc NUMERIC DEFAULT 10` |

### Componentes reutilizables

- `resolveCreatorFromEmail()` — ya existe, crear `bootstrapAnonymousCreator()` siguiendo el mismo patrón
- `generateApiKey()` — ya importado en register/route.ts
- `randomBytes` — ya importado en register/route.ts
- `createServiceClient()` — ya usado en el archivo

---

## 4. Diseño Técnico

### 4.1 Archivos a crear/modificar

| Archivo | Acción | Descripción | Exemplar |
|---------|--------|-------------|----------|
| `src/app/api/v1/agents/register/route.ts` | Modificar | Añadir `bootstrapAnonymousCreator()`, ajustar flujo open/open_key | `resolveCreatorFromEmail()` |
| `src/lib/agents/health-probe.ts` | Modificar | Extender `ProbeStatus`, cambiar lógica 4xx vs 5xx | Línea 9 y bloque del callback HTTP |

### 4.2 Nueva función: `bootstrapAnonymousCreator()`

```typescript
// NOTA: añadir randomUUID al import existente de 'crypto':
// import { createHash, randomBytes, randomUUID } from 'crypto'

async function bootstrapAnonymousCreator(
  serviceClient: ReturnType<typeof createServiceClient>
): Promise<{ userId: string } | null> {
  const uuid = randomUUID()  // usar import nombrado, no crypto.randomUUID() global
  const syntheticEmail = `agent_${uuid}@bootstrap.wasiai.internal`

  // 1. Crear auth.users
  const { data: newUser, error: createError } = await serviceClient.auth.admin.createUser({
    email: syntheticEmail,
    email_confirm: true,
    password: randomBytes(32).toString('hex'),
  })
  if (createError || !newUser?.user) return null

  const userId = newUser.user.id
  const baseUsername = `agent_${uuid.slice(0, 8)}`

  // 2. Insertar creator_profile con username único (hasta 3 intentos)
  let inserted = false
  for (const suffix of ['', '_2', '_3', `_${uuid}`]) {
    const username = baseUsername + suffix
    const { error } = await serviceClient
      .from('creator_profiles')
      .insert({ id: userId, username, display_name: 'Agent Publisher' })
    if (!error) { inserted = true; break }
    if (!error.message?.includes('unique') && !error.code?.includes('23505')) break // error no-recoverable
  }

  if (!inserted) {
    // Rollback auth.users
    await serviceClient.auth.admin.deleteUser(userId).catch(err =>
      console.error('[register] bootstrap rollback failed — creator_profile insert', { userId, err })
    )
    return null
  }

  return { userId }
}
```

### 4.3 Flujo en POST handler (open/open_key sin creator_email)

```typescript
// Declarar en la primera línea del handler POST, justo después de:
//   const supabase = await createClient()
//   const serviceClient = createServiceClient()
// y ANTES de la sección de auth:
let isBootstrap = false

// ANTES del insert del agente, si authMethod open/open_key y !creatorId y !data.creator_email:
// Envolver en try/catch — la función puede lanzar si hay error inesperado:
let bootstrapResult: { userId: string } | null = null
try {
  bootstrapResult = await bootstrapAnonymousCreator(serviceClient)
} catch (err) {
  console.error('[register] bootstrapAnonymousCreator threw unexpectedly', err)
}
if (!bootstrapResult) {
  return NextResponse.json(
    { error: 'Registration service temporarily unavailable', code: 'bootstrap_failed' },
    { status: 503 }
  )
}
creatorId = bootstrapResult.userId
isBootstrap = true  // flag para incluir next_steps en respuesta
```

**Rollback del agente (AC5 — punto 3 y 4):**
```typescript
// Si agente insert falla:
if (isBootstrap && creatorId) {
  await serviceClient.auth.admin.deleteUser(creatorId).catch(err =>
    console.error('[register] bootstrap rollback failed — agent insert', { userId: creatorId, err })
  )
}

// Si management_key insert falla (agente ya creado):
// IMPORTANTE: agents.creator_id es SET NULL en CASCADE, NO se elimina automáticamente.
// El agente quedaría huérfano — mismo problema original. Delete es OBLIGATORIO.
if (isBootstrap && creatorId) {
  // Primero eliminar el agente (OBLIGATORIO — sin esto queda huérfano)
  await serviceClient.from('agents').delete().eq('id', agent.id).catch(err =>
    console.error('[register] bootstrap rollback failed — agent delete', { agentId: agent.id, err })
  )
  // Luego deleteUser (CASCADE limpia creator_profile)
  await serviceClient.auth.admin.deleteUser(creatorId).catch(err =>
    console.error('[register] bootstrap rollback failed — key insert', { userId: creatorId, err })
  )
}
```

### 4.4 Cambios en respuesta (AC3)

El campo `management_key_warning` ya existe en la respuesta actual con valor `null` cuando hay key. El Builder debe reemplazarlo por el texto del bootstrap cuando `isBootstrap === true`. El spread del bootstrap va AL FINAL del objeto, sobreescribiendo el campo existente:

```typescript
// En el return final — el spread va AL FINAL para sobreescribir management_key_warning existente:
return NextResponse.json({
  // ... campos existentes ...
  management_key: managementKey,
  management_key_warning: managementKey ? null : 'Management key could not be issued.',
  // ... otros campos ...
  // Bootstrap override — VA AL FINAL, sobreescribe management_key_warning:
  ...(isBootstrap && managementKey && {
    management_key_warning: 'Store this key securely. It will NOT be shown again. Recovery: POST /api/v1/agents/{slug}/recover (coming soon).',
    next_steps: {
      publish_another_agent: `POST /api/v1/agents/register with header x-agent-key: ${managementKey}`,
      update_this_agent: `PATCH /api/v1/agents/${data.slug} with header x-agent-key: <your_key>`,
      docs: 'https://wasiai.io/docs/agents/management-key',
    },
  }),
}, { status: 201 })
```

### 4.5 Fix probe: health-probe.ts

**Cambio 1 — Extender ProbeStatus:**
```typescript
// Antes:
type ProbeStatus = 'active' | 'reviewing'
// Después:
type ProbeStatus = 'active' | 'reviewing' | 'draft'
```

**Cambio 2 — Lógica 4xx → reviewing, 5xx → draft:**
```typescript
// En el callback HTTP res (actualmente todo non-2xx → reviewing):
if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
  await updateAgentHealth(serviceClient, agentId, 'active', { passed: true, latency_ms })
} else if (res.statusCode && res.statusCode >= 400 && res.statusCode < 500) {
  // 4xx = endpoint vivo, solo rechaza el input — status reviewing
  await updateAgentHealth(serviceClient, agentId, 'reviewing', {
    passed: false,
    reason: 'http_error',
    status_code: res.statusCode,
    message: `Endpoint returned HTTP ${res.statusCode} — endpoint is live but requires valid input.`,
    fix: 'Ensure your endpoint returns HTTP 2xx for valid POST requests.',
  })
} else {
  // 5xx = error del servidor → draft
  await updateAgentHealth(serviceClient, agentId, 'draft', {
    passed: false,
    reason: 'http_error',
    status_code: res.statusCode,
    message: `Endpoint returned HTTP ${res.statusCode} — server error.`,
    fix: 'Check your server logs. Endpoint must return HTTP 2xx.',
  })
}
```

**Cambio 3 — timeout/connection_error → draft:**
```typescript
// En req.on('error'):
await updateAgentHealth(serviceClient, agentId, 'draft', {  // era 'reviewing'
  passed: false,
  reason: isTimeout ? 'timeout' : 'connection_error',
  ...
})
```

### 4.6 Flujo completo (Happy Path bootstrap)

1. POST /api/v1/agents/register sin headers de auth, sin creator_email
2. Zod validation → OK
3. Slug check → no existe → OK
4. Rate limit → OK
5. `bootstrapAnonymousCreator()` → `userId` generado
6. Insert agente con `creator_id = userId`, `status = 'reviewing'`
7. `generateApiKey()` → insert en `agent_keys`
8. Si tiene `endpoint_url` → `probeEndpoint()` fire-and-forget
9. Return 201 con `management_key` + `management_key_warning` + `next_steps`

### 4.7 Flujos de error

| Caso | Respuesta |
|------|-----------|
| `auth.admin.createUser` falla | 503 `bootstrap_failed` |
| `creator_profile` insert falla | deleteUser → 500 |
| Agente insert falla | deleteUser → 500 |
| management_key insert falla | deleteUser + delete agente → 500 |
| deleteUser rollback falla | console.error + error original |
| Slug ya existe | 409 (antes del bootstrap, sin crear nada) |
| Rate limit | 429 (antes del bootstrap, sin crear nada) |

---

## 5. Constraint Directives

### OBLIGATORIO
- `bootstrapAnonymousCreator()` sigue el patrón exacto de `resolveCreatorFromEmail()`
- Rate limit y slug check ANTES de `bootstrapAnonymousCreator()`
- `isBootstrap` flag controla qué aparece en la respuesta (no modificar respuesta jwt/agent_key)
- `ProbeStatus` extendido con `'draft'` antes de usarlo
- `randomBytes` ya importado — no reimportar
- Agregar `randomUUID` al import existente de `'crypto'`: `import { createHash, randomBytes, randomUUID } from 'crypto'`
- NO usar `crypto.randomUUID()` como global — usar el import nombrado `randomUUID()`

### PROHIBIDO
- NO modificar el flujo jwt
- NO modificar el flujo agent_key
- NO modificar el flujo open + creator_email (resolveCreatorFromEmail)
- NO hacer `auth.admin` con anon client — solo `serviceClient`
- NO agregar dependencias npm nuevas
- NO hacer git push — solo commit local

---

## 6. Scope

**IN:** `src/app/api/v1/agents/register/route.ts`, `src/lib/agents/health-probe.ts`

**OUT:** WAS-272, WAS-273, UI, KYC, wallet, schema changes, jwt/agent_key flows

---

## 7. Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| `auth.admin.createUser` tiene rate limit en Supabase | BAJA | MEDIO | Ya hay rate limit por IP en el endpoint que lo protege |
| `@bootstrap.wasiai.internal` rechazado por Supabase email validation | BAJA | BAJO | Supabase valida formato RFC, no resolución DNS. Dominio interno es formato válido. |
| Acumulación de auth.users sintéticos en prod | MEDIA | BAJO | Esperado, limpiar periódicamente con cron (tech debt) |

---

## 8. Waves de Implementación

### Wave 0 — Pre-flight (Builder ejecuta primero)
- [ ] W0.1: Verificar que `resolveCreatorFromEmail` existe y leer su implementación completa
- [ ] W0.2: Verificar que `generateApiKey` está importado en register/route.ts
- [ ] W0.3: Verificar que `randomBytes` está importado
- [ ] W0.4: Verificar que `auth.admin.createUser` acepta email con dominio `@bootstrap.wasiai.internal` (test en dev o revisar docs Supabase)
- [ ] W0.5: `npx tsc --noEmit` pasa en estado actual del repo

### Wave 1 — health-probe.ts
- [ ] W1.1: Extender `ProbeStatus` a `'active' | 'reviewing' | 'draft'`
- [ ] W1.2: Cambiar lógica 4xx → `reviewing`, 5xx → `draft`, timeout/error → `draft`
- [ ] W1.3: `npx tsc --noEmit` pasa

### Wave 2 — register/route.ts
- [ ] W2.1: Añadir función `bootstrapAnonymousCreator(serviceClient)`
- [ ] W2.2: Añadir flag `isBootstrap` al flujo
- [ ] W2.3: Integrar bootstrap en el flujo open/open_key (después de rate limit, antes del insert)
- [ ] W2.4: Añadir rollback del agente y de la key si falla post-bootstrap
- [ ] W2.5: Añadir `management_key_warning` + `next_steps` en respuesta cuando `isBootstrap`
- [ ] W2.6: `npx tsc --noEmit` pasa

### Wave 3 — Commit
- [ ] W3.1: `git add src/app/api/v1/agents/register/route.ts src/lib/agents/health-probe.ts`
- [ ] W3.2: `git commit -m "feat(register): agent bootstrap key + fix probe 4xx — WAS-271 SDD #093"`
- [ ] W3.3: NO git push

---

## 9. Rollback

```bash
git revert HEAD   # revierte route.ts y health-probe.ts
# No hay migraciones que revertir
```

---

*SDD generado por NexusAgile — FULL*
