# SDD #214: Registro programático de agentes sin browser

> SPEC_APPROVED: yes — 2026-03-14
> Fecha: 2026-03-14
> Tipo: feature
> SDD_MODE: full
> Branch: feature/214-agent-signup-programatico
> Artefactos: .nexus/sprints/214-agent-signup-programatico/

---

## 1. Resumen

Se crea el endpoint `POST /api/v1/auth/agent-signup` para que agentes autónomos puedan registrarse en WasiAI completamente via API, sin browser ni inbox de email. El endpoint usa el Service Role de Supabase para crear un usuario ya confirmado (`email_confirm: true`), auto-crea su `creator_profile`, emite una `wasi_xxx` agent key, y la devuelve en la respuesta (única vez). Con esa key el agente puede registrar sus servicios en el marketplace y operar en la economía A2A.

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | WAS-214 |
| **Tipo** | feature |
| **SDD_MODE** | full |
| **Objetivo** | Signup programático de agentes autónomos sin email confirm |
| **Reglas de negocio** | La key raw solo se devuelve una vez. Si se pierde, la cuenta está muerta (no hay recovery). |
| **Scope IN** | Endpoint agent-signup, user creation via admin API, creator_profile auto-create, agent_key emission, rate limiting, rollback compensatorio |
| **Scope OUT** | UI, cambios al signup humano, recovery, login JWT, email de bienvenida |
| **Missing Inputs** | Confirmar con PO si se acepta password opcional en el body |

### Acceptance Criteria (EARS)

- AC1: WHEN POST `/api/v1/auth/agent-signup` recibe `{ email }` válido + `x-signup-key` header válido, THE endpoint SHALL retornar HTTP 201 con `wasi_xxx` agent key.
- AC2: WHEN el mismo email se usa dos veces, THE endpoint SHALL retornar HTTP 409 `{ error: "Email already registered" }`.
- AC3: WHEN `x-signup-key` header falta o es inválido (y `AGENT_SIGNUP_KEY` env var está seteada), THE endpoint SHALL retornar HTTP 401 `{ error: "Authentication required" }`.
- AC4: WHEN se excede el rate limit (>5/hora por IP), THE endpoint SHALL retornar HTTP 429.
- AC5: WHEN el signup es exitoso, THE system SHALL auto-crear `creator_profile` row con `id = user.id` via Service Role.
- AC6: WHEN el signup es exitoso, THE `wasi_xxx` key SHALL guardarse hasheada en `agent_keys` con `is_active: true`, `budget_usdc: 0`, `spent_usdc: 0`.
- AC7: IF `AGENT_SIGNUP_KEY` env var no está seteada O es string vacío, THE endpoint SHALL ser completamente abierto.
- AC8: WHEN email inválido, THE endpoint SHALL retornar HTTP 422 `{ error: "Invalid email format" }`.
- AC9: THE system SHALL auto-generar el campo `name` de `agent_keys` como `"agent-{email-local-part}"` (ej: `agent-mybot` para `mybot@example.com`).
- AC10: WHEN creación de user en Supabase es exitosa pero insert de `agent_keys` falla, THE endpoint SHALL retornar HTTP 500 Y SHALL intentar eliminar el user de Supabase (compensating transaction).
- AC11: WHEN Redis no está disponible durante rate-limit check, THE endpoint SHALL retornar HTTP 503 `{ error: "Service temporarily unavailable" }`.

---

## 3. Context Map

### Archivos leídos

| Archivo | Por qué | Patrón extraído |
|---------|---------|-----------------|
| `src/app/api/v1/agents/register/route.ts` | Exemplar principal de endpoint con x-agent-key auth | Estructura: rate limit → auth → validate → DB → response |
| `src/lib/supabase/server.ts` | Client factory | `createServiceClient()` disponible, usa SUPABASE_SERVICE_ROLE_KEY |
| `src/features/agent-api/services/agent-keys.service.ts` | Generación de keys | `generateApiKey()` retorna `{ raw, hash }` — reutilizar |
| `src/lib/ratelimit.ts` | Rate limiting | `getRegisterLimit()` = slidingWindow(5, '1h') — reutilizar |
| `src/actions/auth.ts` | Flujo humano actual | `signUp()` normal con redirect — NO modificar |

### Exemplar principal
| Para crear | Seguir patrón de | Razón |
|-----------|-----------------|-------|
| `route.ts` del endpoint | `src/app/api/v1/agents/register/route.ts` | Mismo patrón: rate limit → auth header → Zod → DB → response |

### Estado de BD relevante

| Tabla | Existe | Columnas relevantes |
|-------|--------|---------------------|
| `agent_keys` | ✅ | `owner_id` (FK → creator_profiles.id), `key_hash`, `name`, `budget_usdc`, `spent_usdc`, `is_active` |
| `creator_profiles` | ✅ | `id` (= auth.users.id), `wallet_address` (nullable) |

### Componentes reutilizables
- `generateApiKey()` en `agent-keys.service.ts` — no re-implementar
- `getRegisterLimit()` en `ratelimit.ts` — no crear nuevo limiter
- `getIdentifier()` + `checkRateLimit()` en `ratelimit.ts` — mismo patrón
- `createServiceClient()` en `supabase/server.ts` — usar para todas las operaciones DB (RLS bypass)

---

## 4. Diseño Técnico

### 4.1 Archivos a crear/modificar

| Operación | Archivo | Detalle |
|-----------|---------|---------|
| **CREAR** | `src/app/api/v1/auth/agent-signup/route.ts` | Endpoint principal |
| **MODIFICAR** | `src/lib/ratelimit.ts` | Añadir `getAgentSignupLimit()` (5/h, prefix `rl:agent-signup`) |
| **MODIFICAR** | `src/lib/env.ts` | Añadir `AGENT_SIGNUP_KEY: z.string().optional()` al schema Zod |
| **NO MODIFICAR** | `src/actions/auth.ts` | Flujo humano — intocable |
| **NO MODIFICAR** | `src/app/api/v1/agents/register/route.ts` | Ya corregido en WAS-214 bugfix |

### 4.2 DB — creator_profiles (trigger auto-create)

Existe el trigger `on_auth_user_created` (migration `00000000000004_wasiai_triggers.sql`) que auto-inserta en `creator_profiles` inmediatamente después de `auth.admin.createUser`. Incluye `username`, `display_name`, `avatar_url`. **No insertar manualmente.** El Service Role ya bypasea RLS para operaciones de lectura/update si se necesitan.

El CASCADE `ON DELETE CASCADE` en `creator_profiles.id → auth.users.id` garantiza que si el rollback compensatorio elimina el user, el perfil se limpia automáticamente.

### 4.3 Flujo del endpoint

```
POST /api/v1/auth/agent-signup
  Body: { email: string }

1. Rate limit check (getAgentSignupLimit, by IP)
   → 503 si Redis down
   → 429 si excedido

2. Auth check (x-signup-key header vs AGENT_SIGNUP_KEY env var)
   → 401 si env var seteada y header inválido/faltante
   → skip si env var vacía o no seteada

3. Validate body (Zod: email válido)
   → 422 si email inválido

4. serviceClient.auth.admin.createUser({
     email,
     email_confirm: true,
     password: randomBytes(32).toString('hex')  // password aleatorio — el agente nunca lo usa
   })
   // Detectar email duplicado: Supabase retorna error con message "User already registered" y status 422
   // NO es un error Postgres 23505 — chequear: error.message?.includes('User already registered')
   → 409 `{ error: "Email already registered" }` si email duplicado
   → 500 en otro error
   // NOTA: el DB trigger `on_auth_user_created` auto-crea `creator_profiles` automáticamente
   // NO insertar en creator_profiles manualmente — el trigger lo maneja con username, display_name, etc.

5. generateApiKey() → { raw, hash }
   emailLocalPart = email.split('@')[0].slice(0, 50)
   serviceClient.from('agent_keys').insert({
     owner_id: user.id,
     name: `agent-${emailLocalPart}`,
     key_hash: hash,
     budget_usdc: 0,   // 0 intencional: agente fondea manualmente después. Pisa el default DB de 10 USDC.
     spent_usdc: 0,
     is_active: true,
   })
   → 500 si falla → COMPENSATING: serviceClient.auth.admin.deleteUser(user.id) → retornar 500
   // CASCADE ON DELETE de creator_profiles limpia el perfil automáticamente al eliminar el user

7. Retornar HTTP 201:
   {
     agent_key: raw,           // wasi_xxx... — solo se muestra ESTA vez
     agent_key_warning: "Store this key securely. It will not be shown again.",
     user_id: user.id,
     next_steps: {
       register_agent: "POST /api/v1/agents/register with x-agent-key header",
       docs: "https://wasiai.io/docs/agents/register"
     }
   }
```

### 4.4 Schema Zod

```typescript
const AgentSignupSchema = z.object({
  email: z.string().email('Invalid email format'),
})
```

### 4.5 Nuevo rate limiter

```typescript
// En ratelimit.ts — añadir:
let _agentSignup: Ratelimit | null = null
export function getAgentSignupLimit() {
  return _agentSignup ??= new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(5, '1 h'),
    prefix: 'rl:agent-signup'
  })
}
```

---

## 5. Wave Plan

### Wave 0 — Pre-flight (ejecuta el Spec Reviewer)
- 0.1 Verificar que `createServiceClient()` existe en `src/lib/supabase/server.ts` ✅
- 0.2 Verificar que `generateApiKey()` exporta `{ raw, hash }` ✅
- 0.3 Verificar que `getRegisterLimit()` sigue patrón `slidingWindow(5, '1h')` ✅
- 0.4 Verificar que `src/app/api/v1/agents/register/route.ts` es el exemplar (patrón rate-limit → auth → Zod → DB) ✅
- 0.5 Verificar que NO existe `src/app/api/v1/auth/agent-signup/route.ts` (nuevo archivo) ✅

### Wave 1 — Rate limiter
**Archivos:** `src/lib/ratelimit.ts`
**Tarea:** Añadir `getAgentSignupLimit()` con `slidingWindow(5, '1h')` y prefix `rl:agent-signup`
**Build gate:** `npx tsc --noEmit` sin errores

### Wave 2 — Endpoint principal
**Archivos:** `src/app/api/v1/auth/agent-signup/route.ts` (CREAR)
**Tarea:** Implementar endpoint completo según flujo 4.3
**Build gate:** `npx tsc --noEmit` sin errores

### Wave 3 — Commit y push
**Tarea:** `git add` de los 2 archivos → commit `feat(WAS-214): POST /api/v1/auth/agent-signup — registro programático sin browser`

---

## 6. Rollback

Si el deploy a prod causa problemas:
1. El endpoint es nuevo — no afecta ningún flujo existente.
2. Rollback: `git revert <commit>` + redeploy en Vercel.
3. Los users creados en Supabase quedan (no hay rollback de datos), pero el endpoint deja de estar disponible.

---

## 7. Critical Constraints

- **OBLIGATORIO:** Usar `createServiceClient()` para TODAS las operaciones DB — nunca `createClient()` en este endpoint (no hay sesión activa).
- **OBLIGATORIO:** Implementar rollback compensatorio en el insert de `agent_keys` (step 5 del flujo).
- **OBLIGATORIO:** La key raw (`wasi_xxx`) SOLO se devuelve en la respuesta 201 — nunca logearla, nunca guardarla en texto plano.
- **OBLIGATORIO:** Usar `env.AGENT_SIGNUP_KEY` (de `src/lib/env.ts`), no `process.env.AGENT_SIGNUP_KEY` directo.
- **PROHIBIDO:** Insertar manualmente en `creator_profiles` — el trigger `on_auth_user_created` lo maneja.
- **PROHIBIDO:** Modificar `src/actions/auth.ts` o cualquier flujo de signup humano.
- **PROHIBIDO:** Guardar el password generado (es random, desechable, el agente nunca lo usa).
- **PROHIBIDO:** Usar `createClient()` (requiere cookies de sesión activa).
