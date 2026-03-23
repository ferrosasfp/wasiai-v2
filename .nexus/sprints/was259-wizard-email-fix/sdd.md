# SDD — WAS-259: Wizard step 8 — email ya existe → asociar creator existente

## Context

`POST /api/v1/onboard/step` — Conversational Wizard.

Step 8 recibe el email del creator. Flujo actual cuando el email **ya existe en auth.users**:
```
createUser → error "already registered" → return 409 "Email already registered"
```

Comportamiento correcto: si el email ya tiene cuenta → buscar su `user.id` → crear un nuevo agente bajo ese mismo creator → emitir nueva agent key.

**Archivo único:** `src/app/api/v1/onboard/step/route.ts`

---

## Acceptance Criteria

- AC1: WHEN step 8 recibe un email ya registrado en auth.users, THEN el wizard NO devuelve 409 — en su lugar vincula el nuevo agente al creator existente y completa el flujo normalmente
- AC2: WHEN el email ya existe, THEN se emite una **nueva** agent key para el nuevo agente (no se reutiliza la key anterior)
- AC3: WHEN el email ya existe, THEN la respuesta es idéntica a la del flujo normal: `{ completed: true, agent_key, slug, status, agent_url, dashboard_url }`
- AC4: WHEN el email es inválido (formato), THEN sigue devolviendo 400 (sin cambio)
- AC5: WHEN el email es nuevo, THEN el flujo actual (createUser → agent → key) no cambia

---

## Wave 0 — Pre-flight

- [ ] Confirmar líneas exactas del `case 8` en `src/app/api/v1/onboard/step/route.ts`
- [ ] Confirmar el bloque de `createError` que actualmente devuelve 409
- [ ] Confirmar que `serviceClient.schema('auth').from('users').select('id').eq('email', email).single()` es el patrón correcto para lookup (vs `listUsers`)
- [ ] Confirmar que el flujo después de obtener `userData.user.id` es idéntico para ambos casos (nuevo y existente)

---

## Wave 1 — Fix step 8

### Cambio 1: declaración de `userData` como `let` + flag `isExistingUser`

Buscar la declaración de `userData` con `const` (destructuring de `createUser`) y reestructurar así:

```typescript
// ANTES (aprox):
const { data: userData, error: createError } = await serviceClient.auth.admin.createUser({...})

// DESPUÉS:
let userId: string | null = null
let isExistingUser = false

const { data: newUserData, error: createError } = await serviceClient.auth.admin.createUser({
  email: answer,
  email_confirm: true,
  password: randomBytes(32).toString('hex'),
})

if (!createError && newUserData?.user) {
  userId = newUserData.user.id
}
```

### Cambio 2: bloque `if (createError)` — lookup por email sin schema('auth')

```typescript
if (createError) {
  const isEmailExists =
    createError.message?.includes('User already registered') ||
    createError.message?.includes('already been registered') ||
    createError.message?.toLowerCase().includes('already exists') ||
    createError.code === 'email_exists' ||
    createError.code === 'user_already_exists' ||
    createError.status === 422

  if (isEmailExists) {
    // WAS-259: email ya existe → buscar vía admin listUsers (no hay getUserByEmail en el client)
    const { data: listData } = await serviceClient.auth.admin.listUsers({ perPage: 1000 })
    const existing = listData?.users?.find((u) => u.email === answer)

    if (!existing) {
      return NextResponse.json({ error: 'Failed to resolve existing account' }, { status: 500 })
    }

    userId = existing.id
    isExistingUser = true
  } else {
    console.error('[onboard/step8] createUser failed', createError)
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
  }
}

if (!userId) {
  return NextResponse.json({ error: 'Failed to obtain user id' }, { status: 500 })
}
```

### Cambio 3: reemplazar referencias a `userData.user.id` → `userId`

En todo el flujo posterior (insert agent_keys, insert agents), reemplazar `userData.user.id` con `userId`.

### Cambio 4: proteger rollbacks con `isExistingUser`

Los bloques de rollback que llaman `deleteUser()` DEBEN condicionarse para no borrar usuarios preexistentes:

```typescript
// ANTES en rollback de keyError:
await serviceClient.auth.admin.deleteUser(userData.user.id).catch(...)

// DESPUÉS:
if (!isExistingUser) {
  await serviceClient.auth.admin.deleteUser(userId).catch((e) =>
    console.error('[onboard/step8] ZOMBIE USER cleanup failed', e),
  )
}
```

Lo mismo para el rollback de `agentError`.

**Build gate W1:** `cd /home/ferdev/.openclaw/workspace/wasiai-v2 && npx tsc --noEmit 2>&1 | head -20`

---

## Critical Constraints

- OBLIGATORIO: El flujo post-`userData` (generación de key, insert del agente) NO se toca — solo cambia cómo se obtiene `userData`
- OBLIGATORIO: Siempre emitir una **nueva** key (no buscar la key anterior del creator)
- PROHIBIDO: Cambiar el comportamiento del flujo agent-key (isAgentKeyFlow, case 7)
- PROHIBIDO: Tocar cualquier otro case del switch

---

## Rollback

```bash
git revert HEAD
# o
git checkout origin/main -- src/app/api/v1/onboard/step/route.ts
```

---

## Files affected

- `src/app/api/v1/onboard/step/route.ts` — único archivo
