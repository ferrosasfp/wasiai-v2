# Work Item — WAS-214: Registro programático de agentes sin browser

**Tipo:** Feature  
**Clasificación:** QUALITY (auth + seguridad)  
**Fecha:** 2026-03-14  
**Issue Linear:** WAS-214  
**Estado:** HU_APPROVED

---

## Historia de Usuario

**Como** agente autónomo (sin acceso a browser ni inbox),  
**quiero** poder crear una cuenta y obtener una agent key en WasiAI completamente vía API/curl,  
**para** poder registrar mi servicio en el marketplace y operar en la economía A2A sin intervención humana.

---

## Contexto técnico

- `POST /auth/v1/signup` de Supabase requiere confirmar email — un agente no tiene inbox.
- Supabase Service Role expone `auth.admin.createUser({ email_confirm: true })` que crea el usuario ya confirmado sin mandar email.
- La identidad del agente en WasiAI vive en `agent_keys` (`wasi_xxx`), no en JWT de Supabase.
- `generateApiKey()` ya existe en `agent-keys.service.ts` — reutilizar.
- `getRegisterLimit()` ya existe en `ratelimit.ts` — reutilizar.
- El Service Role client debe usarse para insertar en `creator_profiles` (RLS bloquea sin sesión activa).

---

## Scope

**IN:**
- Nuevo endpoint `POST /api/v1/auth/agent-signup`
- Crea Supabase user con `email_confirm: true` vía Service Role (sin mandar email)
- Auto-crea `creator_profile` para el nuevo user vía Service Role
- Emite `wasi_xxx` agent key en la respuesta (única vez — hash guardado en DB)
- Rate limiting por IP (máx 5 signups/hora, reutilizar `getRegisterLimit()`)
- `AGENT_SIGNUP_KEY` como barrera de acceso opcional (env var)
- Rollback compensatorio: si falla `agent_keys` insert, eliminar el user de Supabase
- Policy RLS o función `SECURITY DEFINER` para permitir inserción en `creator_profiles` vía Service Role

**OUT:**
- UI de signup para agentes
- Cambios al flujo de signup humano existente
- Recovery de cuenta (si pierdes la key, la cuenta está muerta — by design)
- Login posterior con JWT
- Email de bienvenida (Supabase no manda email con `email_confirm: true`)

---

## Acceptance Criteria (EARS)

- **AC1:** WHEN a POST is made to `/api/v1/auth/agent-signup` with `{ email }` in the body and a valid `x-signup-key` header (when env var is set), THE endpoint SHALL create a Supabase user with `email_confirm: true` and return HTTP 201 with a `wasi_xxx` agent key.
- **AC2:** WHEN the same email is used twice, THE endpoint SHALL return HTTP 409 with `{ error: "Email already registered" }`.
- **AC3:** WHEN the `x-signup-key` header is missing or invalid (and `AGENT_SIGNUP_KEY` env var is set), THE endpoint SHALL return HTTP 401 with `{ error: "Authentication required" }`.
- **AC4:** WHEN the rate limit is exceeded (>5 signups/hour per IP), THE endpoint SHALL return HTTP 429.
- **AC5:** WHEN a valid signup is created, THE system SHALL auto-create a `creator_profile` row linked to the new user id using Service Role client.
- **AC6:** WHEN a valid signup is created, THE `wasi_xxx` agent key SHALL be stored hashed in `agent_keys` with `is_active: true`, `budget_usdc: 0`, and `spent_usdc: 0`.
- **AC7:** IF the `AGENT_SIGNUP_KEY` env var is not set OR is set to an empty string, THE endpoint SHALL be fully open (no header required).
- **AC8:** WHEN an invalid email format is received, THE endpoint SHALL return HTTP 422 with `{ error: "Invalid email format" }`.
- **AC9:** WHEN a signup is created, THE system SHALL auto-generate the `name` for the `agent_keys` row in the format `"agent-{email-local-part}"` (e.g. `agent-mybot` for `mybot@example.com`).
- **AC10:** WHEN Supabase user creation succeeds but `agent_keys` insertion fails, THE endpoint SHALL return HTTP 500 and THE system SHALL attempt to delete the newly created Supabase user to avoid orphaned accounts.
- **AC11:** WHEN Upstash Redis is unavailable during rate-limit check, THE endpoint SHALL return HTTP 503 with `{ error: "Service temporarily unavailable" }`.

---

## Definition of Done

- [ ] Endpoint implementado y funcional en local
- [ ] Rate limiting activo
- [ ] Rollback compensatorio implementado
- [ ] RLS/policy de `creator_profiles` resuelta para Service Role
- [ ] Commit con referencia WAS-214
- [ ] Linear actualizado (AC1 completo)
