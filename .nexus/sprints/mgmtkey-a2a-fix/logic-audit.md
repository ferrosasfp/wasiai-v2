# Logic Audit — MGMT-KEY A2A

**Archivo auditado:** `src/app/api/v1/agents/register/route.ts`  
**Fecha:** 2026-03-21  
**Auditor:** Logic Auditor (NexusAgile)

---

## AC Verification

| AC | Status | Evidence (file:line) |
|----|--------|---------------------|
| AC1: open/open_key + creator_email nuevo → crea user + management_key | ✅ PASS | Schema: `creator_email: z.string().email().optional()` (~L82). `resolveCreatorFromEmail` llama `auth.admin.createUser({email, email_confirm:true, password: randomBytes(32)...})` (~L94-99). Invocación (~L176-178) setea `creatorId`. Bloque `if (creatorId)` (~L253) emite management key. Response incluye `creator_id: creatorId` (~L293) y `management_key: managementKey`. |
| AC2: open/open_key + creator_email existente → usa creator existente + management_key | ✅ PASS | `resolveCreatorFromEmail` captura errores `User already registered / already exists / email_exists / user_already_exists / status 422` (~L103-113). Hace `auth.admin.listUsers({perPage:1000})` y busca por email (~L115-117). Si encuentra, retorna `userId` existente → `creatorId` queda resuelto → management key se emite normalmente. |
| AC3: open/open_key SIN creator_email → comportamiento previo preservado (management_key null + warning) | ✅ PASS | Condición de invocación incluye `data.creator_email` como guard (~L177). Sin email → `creatorId` permanece `null` → `if (creatorId)` no entra → `managementKey = null`. Response: `management_key_warning: 'Management key could not be issued. Contact support@wasiai.io'` cuando `managementKey` es falsy (~L298). |
| AC4: jwt o agent_key → creator_email ignorado (creatorId ya resuelto antes) | ✅ PASS | Condición explícita: `if ((authMethod === 'open_key' \|\| authMethod === 'open') && !creatorId && data.creator_email)` (~L176). Para `jwt` y `agent_key`, `authMethod` no cumple → bloque never ejecuta. `creatorId` para estos métodos ya viene resuelto en el bloque de auth (~L150-165). |
| AC5: creator_email con formato inválido → 422 de Zod | ✅ PASS | `z.string().email()` en el schema (~L82) rechaza emails malformados. El bloque de validación retorna `{ status: 422, error: 'Validation failed', details: parsed.error.flatten() }` (~L172-174) antes de cualquier lógica posterior. |

---

## Additional Checks

- **`resolveCreatorFromEmail` posición (fuera del handler):** ✅ — Función declarada a nivel de módulo antes de `export async function POST` (~L88-120).
- **Invocación 2b posición (después del parse, antes del slug check):** ✅ — Invocación en ~L176-178, después del `if (!parsed.success)` return (~L171-174) y antes de la consulta `supabase.from('agents').select('id').eq('slug', ...)` slug check (~L182-187).
- **`creator_id: creatorId` en el return final:** ✅ — Campo presente explícitamente en el `return NextResponse.json({...})` (~L293).
- **`if (creatorId)` del management key block sin cambios:** ✅ — Bloque intacto: `if (creatorId) { const { raw, hash } = generateApiKey(); ... }` (~L253-265). No se modificó la lógica interna ni la condición de guarda.

---

## Findings

| # | Severity | Issue |
|---|----------|-------|
| 1 | LOW | `resolveCreatorFromEmail` usa `listUsers({ perPage: 1000 })` para encontrar un email existente. Con >1000 usuarios este lookup fallará silenciosamente (el usuario no se encontrará y `creatorId` quedará null). Hay un `TODO` comentado en el código (~L115) pero no está en ningún ticket de backlog visible. Mitigación sugerida: paginar o buscar por email directamente si la API lo permite. |
| 2 | INFO | En AC3, el warning de management key es genérico (`'Management key could not be issued. Contact support@wasiai.io'`). Para open registrations sin `creator_email`, sería UX más claro indicar que se puede reintentarlo incluyendo `creator_email`. No es un defecto funcional. |

---

## Veredicto

**PASS with findings**

Todos los ACs del SDD están implementados correctamente y la estructura del código sigue las instrucciones de Wave 1 y Wave 2. Los checks adicionales son conformes. Los dos findings son de severidad LOW/INFO y no bloquean el merge; el Finding #1 (paginación de listUsers) debe seguirse en backlog.
