# Requirements Review — WAS-214

## Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | Gap de AC | ALTA | No existe AC para el campo `name` de `agent_keys`. El schema actual requiere `name` (min 1, max 64) pero el endpoint de agent-signup no lo menciona en ningún AC ni en el Scope IN. ¿Se auto-genera? ¿Se recibe en el body? Sin especificarlo, el implementador lo inventará. | AC9 |
| 2 | Gap de AC | ALTA | No hay AC para fallo atómico: si `creator_profile` se crea OK pero la inserción en `agent_keys` falla, ¿qué pasa? El usuario de Supabase ya existe (email_confirm: true) pero no tiene key. No hay AC de rollback ni de comportamiento en fallo parcial. | AC10 |
| 3 | Gap de dependencia | ALTA | No se menciona migración DB requerida. La tabla `agent_keys` tiene `owner_id FK → creator_profiles.id`, y `creator_profiles.id = auth.users.id`. Para que un Service Role pueda insertar en `creator_profiles`, las RLS policies actuales probablemente bloquean (solo el propio user puede insertar su perfil). Se necesita policy `USING (true)` para Service Role o función `SECURITY DEFINER`. Esto no está en Scope IN ni en dependencias. | — |
| 4 | Gap de AC | ALTA | No hay AC para el body de la request. AC1 solo menciona "valid email" y "AGENT_SIGNUP_KEY header" pero no documenta que email venga en el body JSON. ¿Hay otros campos requeridos u opcionales (nombre del agente, descripción)? El endpoint queda sub-especificado para quien lo consuma. | AC9 |
| 5 | Gap de env vars | MEDIA | Se menciona `AGENT_SIGNUP_KEY` pero no se mencionan `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (ya existen en el proyecto, pero no están listadas como dependencias del WI). Si el entorno no tiene Redis configurado, el rate limiting fallará silenciosamente o lanzará excepción no manejada. El patrón del proyecto para este caso es retornar 503 (ver sprint 034-ratelimit-fallback-503), pero no hay AC al respecto. | AC11 |
| 6 | Gap de AC | MEDIA | No hay AC para respuesta de error del body: AC8 dice HTTP 422 para email inválido, pero no especifica el formato de la respuesta (`{ error: "..." }` vs `{ message: "..." }` vs Zod validation object). Los otros ACs sí especifican el body (`{ error: "Email already registered" }`). Inconsistencia testeable. | AC8 (amend) |
| 7 | Gap de scope | MEDIA | "Login posterior con JWT" está en Scope OUT, pero no se menciona qué pasa con la identidad Supabase creada si el agente necesita usar endpoints autenticados con JWT internamente. El agente solo tendrá la `wasi_xxx` key. Si algún endpoint del sistema solo acepta JWT (no agent key), queda un dead-end no documentado. Riesgo de scope creep durante implementación. | — (nota) |
| 8 | Calidad de AC | MEDIA | AC6 especifica `budget_usdc: 0` pero no especifica `spent_usdc`. Por el schema actual `spent_usdc` existe en `agent_keys`. Debería inicializarse en 0 también. Omisión menor pero puede generar ambigüedad en tests. | AC6 (amend) |
| 9 | Gap de AC | MEDIA | No hay AC para concurrencia: dos requests simultáneos con el mismo email. El AC2 cubre el caso secuencial, pero Supabase `createUser` con Service Role bajo concurrencia podría crear dos usuarios antes de que el duplicate check ocurra (race condition). No se especifica si hay un unique constraint en Supabase Auth por email (lo hay implícitamente, pero el comportamiento del error no está mapeado). | AC10 |
| 10 | Gap de AC | BAJA | No hay AC para el caso en que `AGENT_SIGNUP_KEY` env var está seteada pero con valor vacío `""`. AC3 dice "missing or invalid" y AC7 dice "not set" — pero `""` es técnicamente "set" aunque vacío. Comportamiento ambiguo. | AC7 (amend) |
| 11 | Gap de scope | BAJA | El Scope OUT no menciona explícitamente "no se emite email de bienvenida". Supabase por defecto puede enviar emails en `createUser` incluso con `email_confirm: true`. Se debe especificar `{ email_confirm: true, ...otros opts }` para suprimir el email. No está documentado como dependencia de configuración de Supabase. | — (nota) |
| 12 | INFO | INFO | `getRegisterLimit()` ya existe en `src/lib/ratelimit.ts` con `slidingWindow(5, '1h')` y prefix `rl:register`. El AC4 puede reutilizarlo directamente — no requiere nueva función. Esto confirma que el patrón de rate limit del WI es correcto y ya está implementado. | — |
| 13 | INFO | INFO | `generateApiKey()` ya existe en `agent-keys.service.ts` y retorna `{ raw, hash }`. El AC6 es implementable sin código nuevo para la generación de la key. El riesgo es si ese service importa `createClient()` que usa cookies de sesión — no funcionará sin user session activa. El nuevo endpoint necesitará un Supabase Service Role client, no el client de sesión. No está documentado. | — |

## ACs sugeridos (agregar)

- **AC9:** WHEN a POST is made to `/api/v1/auth/agent-signup`, THE request body SHALL contain `email` (string, valid format) as the only required field; THE system SHALL auto-generate a `name` for the agent_key in the format `"agent-{email-prefix}"` (or equivalent deterministic scheme).

- **AC10:** WHEN Supabase user creation succeeds but `agent_keys` insertion fails, THE endpoint SHALL return HTTP 500 and THE system SHALL attempt to delete the newly created Supabase user to avoid orphaned accounts (compensating transaction).

- **AC11:** WHEN Upstash Redis is unavailable during rate-limit check, THE endpoint SHALL return HTTP 503 with `{ error: "Service temporarily unavailable" }` (consistent with project pattern in sprint 034).

## ACs a enmendar

- **AC6 (amend):** Add `spent_usdc: 0` to the specified initial state: `...stored hashed in agent_keys with is_active: true, budget_usdc: 0, and spent_usdc: 0.`

- **AC7 (amend):** Clarify empty-string edge case: `IF the AGENT_SIGNUP_KEY env var is not set OR is set to an empty string, THE endpoint SHALL be fully open.`

- **AC8 (amend):** Specify error body format: `...THE endpoint SHALL return HTTP 422 with { error: "Invalid email format" }.`

## Veredicto

**NECESITA CAMBIOS** — Hay 3 gaps de severidad ALTA que bloquean una implementación segura y correcta: (1) el campo `name` de `agent_keys` no está especificado, (2) no hay comportamiento definido para fallo atómico entre creación de user y agent_key, y (3) faltan las dependencias de RLS/política de Supabase necesarias para que Service Role pueda insertar en `creator_profiles`. Sin estos cambios, el implementador tomará decisiones de diseño por su cuenta en puntos críticos de seguridad y consistencia de datos.
