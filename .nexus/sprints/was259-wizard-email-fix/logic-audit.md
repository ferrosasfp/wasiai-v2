# Logic Audit — WAS-259

**Auditor:** Logic Auditor (NexusAgile)
**Date:** 2026-03-21
**File:** `src/app/api/v1/onboard/step/route.ts`

---

## AC Verification

| AC | Status | Evidence (file:line) |
|----|--------|---------------------|
| AC1: case 8 NO devuelve 409 cuando email existe | ✅ PASS | Bloque `if (isEmailExists)` hace lookup vía `listUsers` y continúa el flujo; nunca hay `return 409` en ese path |
| AC2: Se emite una NUEVA agent key siempre | ✅ PASS | `generateApiKey()` se llama incondicionalmente después de resolver `userId`; no hay búsqueda de keys previas |
| AC3: Respuesta final `{ completed, agent_key, slug, status, agent_url, dashboard_url }` para ambos casos | ✅ PASS | Único `return NextResponse.json({ completed: true, agent_key: raw, slug: finalSlug, status: 'active', agent_url, dashboard_url })` al final del case 8; ambos paths (nuevo y existente) convergen ahí |
| AC4: Guard emailRegex devuelve 400 si formato inválido | ✅ PASS | `const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/` + `return 400` si falla — sin cambios |
| AC5: Flujo email nuevo (createUser exitoso) no cambió | ✅ PASS | `if (!createError && newUserData?.user) { userId = newUserData.user.id }` → cae al mismo flujo de key+agent insert |

---

## Critical Checks

- **Rollback keyError:** ✅ — `if (!isExistingUser) { await serviceClient.auth.admin.deleteUser(userId!) }` presente antes del return de error
- **Rollback agentError:** ✅ — mismo patrón `if (!isExistingUser)` en el bloque de rollback de agent insert
- **userId null path:** ✅ — guard explícito `if (!userId) { return NextResponse.json({ error: 'Failed to obtain user id' }, { status: 500 }) }` antes del insert de `agent_keys`

---

## Findings

| # | Severity | Issue |
|---|----------|-------|
| 1 | LOW | `listUsers({ perPage: 1000 })` es un scan lineal; si el workspace crece a >1000 usuarios, `find()` podría no encontrar al usuario. Sin paginación adicional. No es bloqueante para el MVP pero debe documentarse como deuda técnica. |
| 2 | INFO | La respuesta incluye campos extra (`agent_key_warning`, `status_message`) que no están en el AC3. Esto es aditivo y no rompe contratos, pero conviene validar que los clientes los ignoren correctamente. |

---

## Veredicto

**PASS with findings**

La implementación cumple los 5 ACs y los 3 critical checks. Los findings son LOW/INFO y no bloquean el merge. Se recomienda documentar el límite de `listUsers` como deuda técnica (issue #1).
