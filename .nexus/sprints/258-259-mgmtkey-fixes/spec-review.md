# Spec Review — WAS-258/259/MGMT-KEY

## Wave 0 Results

- **W0.1:** ✅
  - `let creatorId: string | null = null` → **line 94**
  - `if (creatorId) {` (management key gate) → **line 289**
  - `input_schema: z.unknown().optional().nullable()` → **line 78**

- **W0.2:** ✅ `createServiceClient()` usa `createSupabaseClient(url, SUPABASE_SERVICE_ROLE_KEY)` — el cliente Supabase JS con service_role key expone `auth.admin` completo (GoTrueAdminApi). Confirmado en `src/lib/supabase/server.ts`.

- **W0.3:** ✅ `auth.admin` ya se usa en el proyecto:
  - `src/app/api/v1/auth/agent-signup/route.ts:55` — `auth.admin.createUser`
  - `src/app/api/v1/auth/agent-signup/route.ts:89` — `auth.admin.deleteUser`
  - `src/app/api/v1/onboard/step/route.ts:263,296,348` — mismo patrón
  - Patrón probado y funcional en producción.

- **W0.4:** ✅ Campos NOT NULL requeridos en insert a `creator_profiles`:
  - `id UUID` (PK, NOT NULL)
  - `username TEXT UNIQUE NOT NULL`
  - El SDD incluye ambos en el upsert. **Nota importante:** existe un trigger `handle_new_user()` en `auth.users` que auto-crea el `creator_profile` cuando `auth.admin.createUser` inserta el user. El upsert manual del SDD con `onConflict: 'id'` es seguro como safety net.

- **W0.5:** ✅ El cambio de `z.unknown().optional().nullable()` → `z.record(z.unknown())` no rompe los casts posteriores.
  - `data.input_schema as JsonSchema` (line 257) es un cast explícito → TypeScript lo acepta.
  - `metaValidateSchema(data.input_schema)` (line 170) recibe `Record<string, unknown>` — compatible con `object` / `unknown`.
  - `data.input_schema ?? null` (line 247) nunca retorna `null` con el nuevo schema (required), pero el `?? null` es inofensivo.
  - AC5/AC6/AC7 cubiertos: ausente o null → 422; `{}` → pasa.

- **W0.6:** ✅ Body parse en **line 155** (`try { body = await request.json() }`), que es ANTES del slug check (line ~192). El flujo Wave 2d (inyectar resolución de `creator_email` DESPUÉS del parse, ANTES del slug check) es completamente viable sin mover el parse. No hay doble-parse.

- **W0.7:** ✅ Error code confirmado en tipos Supabase:
  - **`email_exists`** → listado explícitamente en `@supabase/auth-js/dist/main/lib/error-codes.d.ts`
  - **`user_already_exists`** → también listado en el mismo tipo `ErrorCode`
  - ⚠️ El SDD solo verifica `createError?.code === 'email_exists'` pero omite `user_already_exists`. Ambos pueden ser retornados dependiendo del contexto/versión de GoTrue.

---

## Findings

| # | Severity | Issue |
|---|----------|-------|
| 1 | 🟡 | **W0.7 — Error code incompleto:** El SDD solo verifica `createError?.code === 'email_exists'` para el fallback de email existente. GoTrue también puede retornar `'user_already_exists'`. Agregar `\|\| createError?.code === 'user_already_exists'` al condition en `resolveCreatorFromEmail`. |
| 2 | 🟡 | **listUsers() sin filtro:** La función `resolveCreatorFromEmail` llama `auth.admin.listUsers()` sin paginación/filtro para buscar el user por email. En producción con muchos usuarios, esto puede ser lento o consumir mucha memoria. No existe `getUserByEmail` en el Admin API de esta versión. Alternativa: query directo a `auth.users` vía serviceClient con `.from('users').select('id').eq('email', email).schema('auth').single()`. |
| 3 | 🟡 | **AC9 sin implementación explícita:** AC9 requiere que la respuesta incluya `creator_id` cuando se registra con `creator_email`. El Wave 2 del SDD no menciona agregar `creator_id` al response object (`return NextResponse.json({...})`). Debe agregarse explícitamente. |
| 4 | 🟢 | **Trigger auto-crea creator_profile:** El trigger `handle_new_user()` en `auth.users` ya crea el `creator_profile` automáticamente con username único. El upsert manual del SDD es redundante pero inofensivo gracias a `onConflict: 'id'`. El SDD puede simplificarse omitiendo el check/upsert manual, pero dejarlo como safety net es aceptable. |
| 5 | 🟢 | **`input_schema` validation gate (line 169):** Actualmente el gate es `if (data.input_schema !== undefined && data.input_schema !== null)`. Con el cambio a `z.record(z.unknown())` (required), `data.input_schema` siempre estará definido. El gate seguirá funcionando correctamente (siempre entrará), pero puede simplificarse a `if (data.input_schema)`. No es bloqueante. |

---

## Veredicto

**READY TO BUILD** — con las correcciones menores de findings #1 y #3 incorporadas durante Wave 2:
1. Agregar `|| createError?.code === 'user_already_exists'` al condition de email-exists en `resolveCreatorFromEmail`
2. Agregar `creator_id: creatorId` al response object final

Finding #2 (listUsers) es aceptable para el volumen actual; puede optimizarse en un sprint posterior si escala.
