# Spec Review v2 — WAS-259

**Reviewer:** Spec Reviewer (NexusAgile)
**Date:** 2026-03-21
**SDD:** sdd.md (v2 post-corrección)

---

## Checks

- **W1: ✅ TypeScript válido + listUsers existe**
  - `let userId: string | null = null` + `let isExistingUser = false` + `const { data: newUserData, error: createError }` = TypeScript válido ✅
  - `auth.admin.listUsers({ perPage: 1000 })`: no aparece en el codebase todavía, pero es método documentado del Supabase Admin client (service role). El SDD lo justifica con comentario explícito. `auth.admin.createUser` y `auth.admin.deleteUser` ya se usan en el mismo proyecto (confirmado en grep). ✅
  - `listData?.users?.find(u => u.email === answer)`: `answer` es `string` en ese scope — el guard `if (typeof answer !== 'string' || !emailRegex.test(answer))` al inicio de case 8 lo garantiza (líneas 258-260). ✅

- **W2: ✅ Ambos rollbacks cubiertos**
  - Rollback 1 (keyError) — línea 296 actual: `await serviceClient.auth.admin.deleteUser(userData.user.id).catch(...)`
  - Rollback 2 (agentError) — línea 348 actual: `await serviceClient.auth.admin.deleteUser(userData.user.id).catch(...)`
  - El SDD Cambio 4 cubre explícitamente ambos con `if (!isExistingUser)`. El segundo rollback está confirmado con "Lo mismo para el rollback de `agentError`." ✅

- **W3: ✅ Todas las referencias a `userData.user.id` en case 8 están cubiertas**
  - Aparece en 4 lugares:
    1. `owner_id: userData.user.id` (agent_keys insert) → cubierto por Cambio 3
    2. `creator_id: userData.user.id` (agents insert) → cubierto por Cambio 3
    3. Rollback keyError (línea 296) → cubierto por Cambio 4
    4. Rollback agentError (línea 348) → cubierto por Cambio 4
  - El SDD no deja referencias huérfanas. ✅

---

## Findings

| # | Severity | Issue |
|---|----------|-------|
| 1 | INFO | `listUsers` no tiene precedente en el codebase pero es API oficial Supabase Admin — aceptable, sin riesgo de tipo |
| 2 | INFO | Comentario en rollbacks dice `[onboard/step7]` (typo del código original) — no blocker, pero puede confundir en logs |

---

## Veredicto

**READY TO BUILD**

Los 2 blockers originales están resueltos. No hay issues nuevos de severidad MEDIUM o superior. El SDD cubre todas las referencias a `userData.user.id` y ambos rollbacks están protegidos con `isExistingUser`. Proceder a implementación.
