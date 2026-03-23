# SDD — WAS-258 / WAS-259 / MGMT-KEY-NULL
## 3 fixes en /api/v1/agents/register/route.ts

---

## Context

`POST /api/v1/agents/register` soporta 4 modos de auth:
- `jwt` → Bearer token (creatorId conocido desde session)
- `agent_key` → x-agent-key (creatorId resuelto vía agent_keys table)
- `open_key` → x-register-key (creatorId = null ← BUG)
- `open` → sin auth (creatorId = null ← BUG)

Para open/open_key: `creatorId` queda `null` → management key nunca se emite → agentes quedan huérfanos sin owner.

Bugs confirmados en prod: 2 agentes (`test-was258-check`, `test-was259-second`) con `creator_id: null`. Ya eliminados.

**Archivo único a modificar:** `src/app/api/v1/agents/register/route.ts`

---

## Acceptance Criteria

**Fix 1 — Management key (MGMT-KEY-NULL)**
- AC1: WHEN open/open_key registration includes `creator_email`, THEN el endpoint crea o recupera un auth.user con ese email y emite management key con su id
- AC2: WHEN `auth.admin.createUser` se llama con email ya existente, THEN se captura el error y se hace lookup del user existente en su lugar
- AC3: WHEN creator_id es resuelto (nuevo o existente), THEN se inserta/verifica un creator_profile row, y se emite management key
- AC4: WHEN open/open_key registration NO incluye `creator_email`, THEN el agente se registra con creator_id = WASIAI_SYSTEM_CREATOR_ID (comportamiento actual preservado, sin breaking change)

**Fix 2 — WAS-258 (input_schema requerido)**
- AC5: WHEN se registra un agente sin `input_schema` en el body (vía cualquier auth method), THEN el endpoint devuelve 422 con error `"input_schema is required"`
- AC6: WHEN se registra con `input_schema: null` explícito, THEN también devuelve 422
- AC7: WHEN se registra con `input_schema: {}` (objeto vacío), THEN pasa validación (schema mínimo válido)

**Fix 3 — WAS-259 (multi-agente mismo email)**
- AC8: WHEN open registration con `creator_email` ya existente en auth.users, THEN el nuevo agente se vincula al creator existente (no error, no duplicado)
- AC9: WHEN se registra exitosamente con `creator_email`, THEN la respuesta incluye `creator_id` del user (nuevo o existente)

---

## Wave 0 — Pre-flight (Spec Reviewer ejecuta esto)

- [ ] W0.1: Leer `src/app/api/v1/agents/register/route.ts` completo — confirmar líneas de `creatorId`, `managementKey`, Zod schema
- [ ] W0.2: Confirmar que `createServiceClient` tiene acceso a `auth.admin.createUser` vía service role
- [ ] W0.3: Buscar si existe helper de `auth.admin` en el codebase (`lib/supabase/server.ts` o similar)
- [ ] W0.4: Confirmar schema de `creator_profiles` — qué campos son requeridos en insert
- [ ] W0.5: Confirmar que `input_schema` está actualmente como `z.unknown().optional().nullable()` en Zod schema
- [ ] W0.6: Verificar que no hay otros endpoints que dependan del comportamiento actual de `input_schema` siendo optional

---

## Wave 1 — Fix WAS-258: input_schema requerido

**Archivo:** `src/app/api/v1/agents/register/route.ts`

Cambiar en `RegisterAgentSchema`:
```typescript
// ANTES
input_schema: z.unknown().optional().nullable(),
// DESPUÉS
input_schema: z.record(z.unknown()),
```

**Build gate W1:** `tsc --noEmit` sin errores en el archivo modificado.

---

## Wave 2 — Fix MGMT-KEY + WAS-259: creator_email flow

**Archivo:** `src/app/api/v1/agents/register/route.ts`

### 2a — Agregar `creator_email` al Zod schema (campo opcional)

```typescript
creator_email: z.string().email().optional(),
```

### 2b — Función helper `resolveCreatorFromEmail`

Añadir función interna (antes del handler POST):

```typescript
async function resolveCreatorFromEmail(
  serviceClient: ReturnType<typeof createServiceClient>,
  email: string
): Promise<string | null> {
  // 1. Intentar crear nuevo user
  const { data: newUser, error: createError } = await serviceClient.auth.admin.createUser({
    email,
    email_confirm: true,
  })

  let userId: string | null = null

  if (!createError && newUser?.user) {
    userId = newUser.user.id
  } else if (createError?.message?.includes('already been registered') ||
             createError?.message?.includes('already exists') ||
             createError?.code === 'email_exists') {
    // WAS-259: email ya existe → buscar user existente
    const { data: users } = await serviceClient.auth.admin.listUsers()
    const existing = users?.users?.find(u => u.email === email)
    if (existing) userId = existing.id
  }

  if (!userId) return null

  // Asegurar que creator_profile existe
  const { data: existingProfile } = await serviceClient
    .from('creator_profiles')
    .select('id')
    .eq('id', userId)
    .single()

  if (!existingProfile) {
    const username = email.split('@')[0].replace(/[^a-z0-9_]/gi, '_').toLowerCase()
    await serviceClient.from('creator_profiles').upsert({
      id: userId,
      username: `${username}_${Date.now()}`,
      display_name: email.split('@')[0],
    }, { onConflict: 'id' })
  }

  return userId
}
```

### 2c — Usar `resolveCreatorFromEmail` en el handler

En la sección open/open_key auth (después de `authMethod = 'open_key'` y `authMethod = 'open'`), añadir al final antes de validar el body:

```typescript
// Para open/open_key: intentar resolver creator desde email si se provee
if ((authMethod === 'open_key' || authMethod === 'open') && !creatorId) {
  // Necesitamos parsear el body primero para acceder a creator_email
  // NOTA: el parse del body se mueve ANTES de este bloque (ver Wave 3)
}
```

**CONSTRAINT:** El body parse actualmente ocurre DESPUÉS del bloque de auth. Para acceder a `creator_email` en el bloque de auth, necesitamos reorganizar ligeramente.

### 2d — Reorganización del flujo (Wave 3)

**Mover** el parse del body y validación Zod **antes** del bloque de management key, pero mantener los early returns de auth intactos. La solución más limpia: manejar el `creator_email` **después** del parse del body, como un paso de resolución de `creatorId` adicional:

```typescript
// DESPUÉS del parse del body (línea ~160 aprox), ANTES del slug check:

// Resolver creatorId desde email para open registrations
if ((authMethod === 'open_key' || authMethod === 'open') && !creatorId && data.creator_email) {
  creatorId = await resolveCreatorFromEmail(serviceClient, data.creator_email)
}
```

**Build gate W2:** `tsc --noEmit` sin errores.

---

## Critical Constraints

- OBLIGATORIO: No breaking change para open registration sin `creator_email` — debe seguir funcionando (creator_id = system o null)
- OBLIGATORIO: `auth.admin` solo disponible en serviceClient (service_role), NO en supabase (anon/user client)
- OBLIGATORIO: `creator_profiles` upsert con `onConflict: 'id'` para evitar duplicate key errors en multi-agente
- PROHIBIDO: Parsear body dos veces (usar la misma variable `body`)
- PROHIBIDO: Cambiar el comportamiento para auth `jwt` o `agent_key`

---

## Rollback

```bash
git revert HEAD  # si hay un commit único
# o
git checkout origin/main -- src/app/api/v1/agents/register/route.ts
```

---

## Files affected

- `src/app/api/v1/agents/register/route.ts` — único archivo modificado

---

## Test vectors post-fix

```bash
# Fix 2: input_schema requerido
curl -X POST .../api/v1/agents/register \
  -d '{"name":"Test","slug":"test-x","category":"data","price_per_call":0.01}'
# → 422 "input_schema is required"

# Fix 1+3: management key con email nuevo
curl -X POST .../api/v1/agents/register \
  -d '{"name":"Test","slug":"test-x","category":"data","price_per_call":0.01,"input_schema":{"type":"object"},"creator_email":"new@example.io"}'
# → 200 con management_key: "wasi_xxx..."

# Fix 3: segundo agente mismo email
curl -X POST .../api/v1/agents/register \
  -d '{"name":"Test2","slug":"test-y","category":"nlp","price_per_call":0.01,"input_schema":{"type":"object"},"creator_email":"new@example.io"}'
# → 200 con mismo creator_id, nuevo management_key
```
