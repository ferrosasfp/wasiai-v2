# WAS-259 → Sprint #262 — Onboarding: múltiples agentes bajo el mismo creator

**Tipo:** improvement  
**Clasificación:** QUALITY  
**Fecha:** 2026-03-20  
**Linear:** WAS-259

## Problema

En el step 7 del wizard, si el email ya existe en Supabase Auth, `createUser` retorna 422 y el handler devuelve 409 "Email already registered". El creator no puede registrar un segundo agente.

**Código actual (step 7, línea ~195):**
```ts
if (createError.message?.includes('User already registered') || ...) {
  return NextResponse.json({ error: 'Email already registered' }, { status: 409 })
}
```

## Riesgo de seguridad a evaluar

Si el email ya existe, hay que asociar el nuevo agente al `user.id` existente. Pero esto significa que cualquier persona que conozca el email de un creator puede registrar agentes bajo su cuenta. Necesita análisis de seguridad.

## Archivos relevantes

- `src/app/api/v1/onboard/step/route.ts` — step 7, bloque createUser

## Solución propuesta

En lugar de retornar 409, cuando el email ya existe:
1. Buscar el user existente por email via `serviceClient.auth.admin.listUsers()` o query a `auth.users`
2. Usar su `user.id` como `creator_id` para el nuevo agente
3. Generar nueva API key asociada al user existente
4. Registrar el nuevo agente con el mismo `creator_id`

**Constraint de seguridad:** El wizard no tiene autenticación — cualquiera puede completarlo. Si un atacante conoce el email de un creator, podría registrar agentes bajo su cuenta. El Security Reviewer debe evaluar si esto es aceptable o si se necesita una confirmación adicional (magic link, etc.).

## Acceptance Criteria

- AC1: WHEN email already exists, SHALL NOT return 409
- AC2: WHEN email already exists, SHALL associate new agent to existing user.id
- AC3: WHEN email already exists, SHALL generate new API key for existing user
- AC4: WHEN email already exists, SHALL NOT create duplicate user
- AC5: New agent SHALL be inserted with existing user's creator_id
- AC6: TypeScript build SHALL pass
- AC7: Security Reviewer SHALL evaluate email-based account association risk
