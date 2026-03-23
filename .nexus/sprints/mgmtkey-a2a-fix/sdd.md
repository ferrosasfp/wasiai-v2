# SDD — MGMT-KEY A2A: management key null en /api/v1/agents/register

## Context

`POST /api/v1/agents/register` — registro programático directo (A2A).

Para auth `open` / `open_key`, `creatorId` queda `null` porque no hay sesión JWT ni agent-key con owner conocido. El bloque de management key está guardado por `if (creatorId)` → nunca entra → respuesta devuelve `management_key: null`.

Fix: aceptar `creator_email` opcional en el body. Si se provee:
1. `auth.admin.createUser(email)` → nuevo usuario
2. Si email ya existe → buscar user existente en `auth.users`
3. Con el `userId` obtenido → emitir management key normalmente

**Archivo único:** `src/app/api/v1/agents/register/route.ts`

---

## Acceptance Criteria

- AC1: WHEN open/open_key registration incluye `creator_email` válido y nuevo, THEN se crea auth.user, se emite management key, y la respuesta incluye `management_key: "wasi_xxx"` y `creator_id`
- AC2: WHEN open/open_key registration incluye `creator_email` ya existente, THEN se vincula al creator existente, se emite nueva management key, respuesta incluye `management_key` y `creator_id`
- AC3: WHEN open/open_key registration NO incluye `creator_email`, THEN comportamiento actual preservado (creator_id = system o null, management_key = null con warning)
- AC4: WHEN auth es `jwt` o `agent_key`, THEN `creator_email` se ignora completamente (creatorId ya resuelto)
- AC5: WHEN `creator_email` tiene formato inválido, THEN 422 de validación Zod

---

## Wave 0 — Pre-flight

- [ ] Confirmar línea de `let creatorId` y del `if (creatorId)` en management key block
- [ ] Confirmar línea del body parse (`request.json()`)
- [ ] Confirmar que `createServiceClient` tiene `auth.admin` disponible (service_role)
- [ ] Confirmar patrón de `serviceClient.schema('auth').from('users')` en el codebase

---

## Wave 1 — Agregar `creator_email` al Zod schema

En `RegisterAgentSchema`, junto a los campos opcionales:
```typescript
creator_email: z.string().email().optional(),
```

**Build gate W1:** `npx tsc --noEmit 2>&1 | head -20`

---

## Wave 2 — Función `resolveCreatorFromEmail` + invocación

### 2a — Función helper (añadir ANTES del `export async function POST`)

```typescript
async function resolveCreatorFromEmail(
  serviceClient: ReturnType<typeof createServiceClient>,
  email: string
): Promise<string | null> {
  const { data: newUser, error: createError } = await serviceClient.auth.admin.createUser({
    email,
    email_confirm: true,
    password: randomBytes(32).toString('hex'),
  })

  let userId: string | null = null

  if (!createError && newUser?.user) {
    userId = newUser.user.id
  } else if (
    createError?.message?.includes('User already registered') ||
    createError?.message?.includes('already been registered') ||
    createError?.message?.toLowerCase().includes('already exists') ||
    createError?.code === 'email_exists' ||
    createError?.code === 'user_already_exists' ||
    createError?.status === 422
  ) {
    // Email ya existe → buscar vía admin listUsers
    const { data: listData } = await serviceClient.auth.admin.listUsers({ perPage: 1000 })
    const existing = listData?.users?.find((u) => u.email === email)
    if (existing) userId = existing.id
  }

  if (!userId) return null

  // Safety net: asegurar creator_profile existe
  await serviceClient.from('creator_profiles').upsert({
    id: userId,
    username: `${email.split('@')[0].replace(/[^a-z0-9_]/gi, '_').toLowerCase()}_${Date.now()}`,
    display_name: email.split('@')[0],
  }, { onConflict: 'id' })

  return userId
}
```

### 2b — Invocar después del parse del body

Después del bloque de validación Zod (tras `parsed.success` check), antes del slug check:

```typescript
// MGMT-KEY fix: resolver creator desde email para open registrations
if ((authMethod === 'open_key' || authMethod === 'open') && !creatorId && data.creator_email) {
  creatorId = await resolveCreatorFromEmail(serviceClient, data.creator_email)
}
```

### 2c — Añadir `creator_id` al response final

En el `return NextResponse.json({...})`, añadir:
```typescript
creator_id: creatorId,
```

**Build gate W2:** `npx tsc --noEmit 2>&1 | head -20`

---

## Critical Constraints

- OBLIGATORIO: No breaking change para registros sin `creator_email`
- OBLIGATORIO: `auth.admin` solo en serviceClient, nunca en supabase (anon client)
- OBLIGATORIO: `randomBytes` ya está importado en el archivo — no re-importar
- PROHIBIDO: Tocar flujo de auth `jwt` o `agent_key`
- PROHIBIDO: Cambiar validación de `input_schema` (eso es WAS-258, scope separado)

---

## Rollback

```bash
git revert HEAD
# o
git checkout origin/main -- src/app/api/v1/agents/register/route.ts
```

---

## Files affected

- `src/app/api/v1/agents/register/route.ts` — único archivo
