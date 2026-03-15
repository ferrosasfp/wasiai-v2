## Spec Review — SDD #214

### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix existe | ✅ PASS | `src/app/api/v1/auth/agent-signup/route.ts` no existe — ok para implementar |
| 0.2 Archivos existen | ✅ PASS | `createServiceClient()` ✅ · `generateApiKey()` ✅ · `getRegisterLimit/checkRateLimit/getIdentifier` ✅ · exemplar route ✅ |
| 0.3a Tipos correctos | ✅ PASS | `auth.admin.createUser({email_confirm: true})` válido · `generateApiKey()` retorna `{raw: string, hash: string}` · `spent_usdc` existe en `agent_keys` |
| 0.3b DB Schema | ❌ FAIL | Ver Finding #1 (crítico): trigger auto-crea `creator_profiles` + `username NOT NULL` sin default |
| 0.4 Dependencias | ❌ FAIL | `AGENT_SIGNUP_KEY` no está declarada en `src/lib/env.ts` — solo existe `OPEN_REGISTRATION_KEY` |
| 0.5 Completitud | ❌ FAIL | No se especifica el error code/message de Supabase para email duplicado en `auth.admin.createUser` |

### Coherencia

| Check | Resultado | Detalle |
|-------|-----------|---------|
| Cada AC tiene wave | ✅ PASS | Wave 1 → ratelimit.ts · Wave 2 → route.ts · Wave 3 → commit |
| Build gate al final de cada wave | ✅ PASS | `npx tsc --noEmit` en Wave 1 y Wave 2 |

### Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| 1 | 🔴 CRÍTICO | **Step 5 romperá el flujo.** Existe un DB trigger `on_auth_user_created` (migration `00000000000004_wasiai_triggers.sql`) que auto-inserta en `creator_profiles` con `username`, `display_name`, `avatar_url` inmediatamente después de `auth.admin.createUser`. El insert manual del SDD `{id, wallet_address: null}` llegará tarde o simultáneo y fallará con `null value in column "username" violates not-null constraint`. Esto activará el compensating delete aunque el usuario se haya creado correctamente. | **Eliminar Step 5 del endpoint.** El trigger ya maneja la creación del perfil. Si se necesita setear `wallet_address: null` explícitamente, usar un UPDATE en vez de INSERT: `from('creator_profiles').update({wallet_address: null}).eq('id', user.id)`. Pero dado que `wallet_address` ya es nullable por defecto, probablemente Step 5 es innecesario por completo. |
| 2 | 🟠 ALTO | **`AGENT_SIGNUP_KEY` no declarada en `src/lib/env.ts`.** El schema Zod solo tiene `OPEN_REGISTRATION_KEY`. Si el Builder accede a `process.env.AGENT_SIGNUP_KEY` sin declararlo en `env.ts`, bypasea la validación centralizada (T-03). En build podría ser `undefined` silencioso. | Añadir `AGENT_SIGNUP_KEY: z.string().optional()` al schema de `env.ts` y usar `env.AGENT_SIGNUP_KEY` en el endpoint. |
| 3 | 🟡 MEDIO | **Error de email duplicado no especificado.** El SDD dice "→ 409 si email duplicado" pero no indica cómo detectarlo. `auth.admin.createUser` con email existente en Supabase retorna `{ error: { message: "User already registered", status: 422 } }` — no un error Postgres 23505. El Builder improvisará la detección. | Especificar: detectar con `error.message?.includes('User already registered')` o `error.status === 422 && error.message === 'User already registered'`. |
| 4 | 🟡 MEDIO | **`budget_usdc: 0` overrides DB default de 10.** En `agent_keys`, `budget_usdc NUMERIC(18,6) DEFAULT 10`. El SDD inserta explícitamente `budget_usdc: 0`, dejando la key sin saldo inicial. Puede ser intencional pero no está justificado en el SDD. | Clarificar si los agent-signup keys deben tener presupuesto 0 (pago manual posterior) o usar el default de 10 USDC. Si es 0 intencional, documentarlo. |
| 5 | 🟢 BAJO | **Compensating action en Step 6 no limpia `creator_profiles`.** Si el insert en `agent_keys` falla, solo se hace `auth.admin.deleteUser(user.id)`. El CASCADE `ON DELETE CASCADE` en `creator_profiles.id → auth.users.id` debería limpiarlo automáticamente, pero esto no está mencionado en el SDD. | Verificar y documentar que el CASCADE cubre la limpieza de `creator_profiles`. Añadir nota en SDD. |

### Veredicto

**NECESITA CORRECCIÓN**

Finding #1 es un blocker: el endpoint fallará sistemáticamente en Step 5 con `username NOT NULL violation`, activando incorrectamente el rollback y retornando 500 en todos los casos. Finding #2 viola la política T-03 de env vars centralizadas. Ambos deben corregirse antes de pasar al Builder.

**Acción mínima requerida:**
1. Eliminar Step 5 del flujo (o convertirlo en UPDATE condicional)
2. Añadir `AGENT_SIGNUP_KEY` a `src/lib/env.ts`
3. Especificar detección de email duplicado en Step 4
