# Logic Audit — SDD #261 + #262

**Auditor:** Logic Auditor (subagent)  
**Branch:** `improvement/261-262-onboard-input-schema-multi-agent`  
**Commit:** `c5fea4a35`  
**Date:** 2026-03-20  

---

## SDD #261 — input_schema en onboarding wizard

| AC | Descripción | Veredicto | Notas |
|----|-------------|-----------|-------|
| AC1 | Step 6 → step 7 asks for input_schema | ✅ PASS | `QUESTIONS[7]` pide input schema. Case 6 avanza a step 7 normalmente. |
| AC2 | Invalid JSON → 400 | ✅ PASS | Case 7: `JSON.parse` en try/catch, retorna 400 con "must be valid JSON". |
| AC3 | Zero properties → 400 | ✅ PASS | `!hasProps` → 400 "Schema must have at least one property". |
| AC4 | Property check failure → 400 | ✅ PASS | Misma lógica `hasProps` cubre este caso. |
| AC5 | Valid schema stored in session | ✅ PASS | `data.input_schema = parsed` antes del advance-step update. |
| AC6 | Step 8 uses buildExampleFromSchema | ✅ PASS | Case 8 insert: `example_input: data.input_schema ? (buildExampleFromSchema(...) ?? '{}') : '{}'`. |
| AC7 | buildExampleFromSchema null → '{}' | ✅ PASS | Nullish coalescing `?? '{}'` en ambos flows (case 7 agent-key y case 8). |
| AC8 | start/route.ts total_steps=8 for new creators | ✅ PASS | `total_steps: ownerIdFromKey ? 7 : 8`. Sin agent-key → 8. |
| AC9 | register API auto-infers example_input | ✅ PASS | `agentPayload.example_input = data.input_schema ? (buildExampleFromSchema(...) ?? null) : null`. |
| AC10 | register API input_schema optional | ✅ PASS | Zod schema: `z.unknown().optional().nullable()`. |

### ⚠️ Observación AC9 — fallback inconsistente

En register/route.ts, cuando `buildExampleFromSchema` retorna `null`, `example_input` queda `null`. En step/route.ts queda `'{}'`. **Inconsistencia de fallback.** Si la columna DB es NOT NULL, el register API fallará. Si es nullable, habrá datos inconsistentes entre los dos flows.

**Severidad:** MEDIUM  
**Recomendación:** Unificar fallback. Usar `?? '{}'` en register/route.ts también, o documentar que `null` es intencional para register.

---

## SDD #262 — agent-key flow (multi-agent onboarding)

| AC | Descripción | Veredicto | Notas |
|----|-------------|-----------|-------|
| AC1 | Valid x-agent-key → store owner_id | ✅ PASS | `sessionData = ownerIdFromKey ? { owner_id: ownerIdFromKey } : null`. |
| AC2 | Valid x-agent-key → total_steps=7 | ✅ PASS | `total_steps: ownerIdFromKey ? 7 : 8`. |
| AC3 | No x-agent-key → identical behavior | ✅ PASS | `ownerIdFromKey` stays null, sessionData null, total_steps 8. |
| AC4 | Session with owner_id → step 7 inserts agent | ✅ PASS | Case 7: `isAgentKeyFlow` detected → full insert + completion. |
| AC5 | creator_id = session.data.owner_id | ✅ PASS | Insert uses `creator_id: data.owner_id as string`. |
| AC6 | Generate new API key with name=slug | ✅ PASS | `agent_keys.insert({ name: slug, ... })`. |
| AC7 | Rollback only deletes key, NEVER deleteUser | ✅ PASS | Agent-key flow rollback: only `agent_keys.delete().eq('key_hash', hash)`. No `deleteUser`. |
| AC8 | Invalid x-agent-key → 401 | ✅ PASS | `if (!keyRow) return ... 401`. Query filters `is_active: true`, so invalid key → no row → 401. |
| AC9 | Inactive x-agent-key → 401 | ✅ PASS | `.eq('is_active', true)` in query. Inactive key → no row → 401. |

---

## Checklist Lógico Crítico

### 1. keyError antes del insert — ¿rollback correcto?

**Hallazgo:** Si `keyError` ocurre (la key NO se insertó), el código retorna 500 sin rollback. Esto es **correcto**: no hay key que borrar, no hay agente que borrar. El estado es limpio.

**Veredicto:** ✅ CORRECTO — no se requiere rollback en este path.

### 2. `hasProps` acepta objetos flat como `{"a":1}`

**Hallazgo:** La condición `(!parsed.type && !parsed.properties && Object.keys(parsed).length > 0)` acepta **cualquier** objeto no vacío sin `type` ni `properties` como schema válido. Ejemplo: `{"a": 1}` pasa validación.

Esto es **intencional por diseño** — permite schemas "shorthand" donde las keys son implícitamente properties. Sin embargo:

- `buildExampleFromSchema` con `{"a":1}` retorna `null` (no tiene `.properties`), así que `example_input` será `'{}'`.
- El schema se almacena tal cual, sin normalización.
- No hay validación `metaValidateSchema` en el wizard (sí existe en register/route.ts).

**Veredicto:** ⚠️ WARNING — Funciona pero es laxo. Un schema como `{"foo": "bar"}` se almacena sin beneficio real (buildExampleFromSchema no puede inferir nada de él). Considerar:
1. Añadir `metaValidateSchema` en case 7 del wizard, o
2. Documentar explícitamente que schemas shorthand son aceptados.

**Severidad:** LOW

### 3. owner_id sin validación de formato UUID

**Hallazgo:** `data.owner_id` viene de `agent_keys.owner_id` en la DB, que es un FK a `auth.users.id` (UUID). Por lo tanto el valor ya es un UUID válido por construcción — no puede ser un string arbitrario.

**Veredicto:** ✅ NO ISSUE — el valor viene de la DB, no de user input. La integridad referencial de Postgres garantiza el formato.

---

## Hallazgos Adicionales

### F1: Race condition en slug check (case 7 agent-key flow)

El check `select('id').eq('slug', slug).single()` seguido de insert no es atómico. Dos sesiones concurrentes podrían obtener el mismo slug libre y una fallaría en insert. El case 8 tiene el mismo patrón. Mitigación existente: suffix aleatorio. Pero si el slug sin suffix está disponible, ambas sesiones lo intentan.

**Severidad:** LOW — Postgres unique constraint protege contra duplicados; el error retornaría 500 en vez de un retry con suffix.  
**Recomendación:** Wrap insert en try/catch y retry con suffix on unique violation, o usar `ON CONFLICT`.

### F2: `metadata.registered_via` diferente entre flows

- Agent-key flow: `'onboarding_wizard_agent_key'`
- Normal flow: `'onboarding_wizard'`
- Register API: `authMethod` string

✅ Correcto — permite distinguir el origen del agente.

---

## Resumen

| Categoría | Total | Pass | Warn | Fail |
|-----------|-------|------|------|------|
| SDD #261 ACs | 10 | 10 | 0 | 0 |
| SDD #262 ACs | 9 | 9 | 0 | 0 |
| Critical checklist | 3 | 2 | 1 | 0 |

**Resultado global: ✅ PASS con observaciones**

### Observaciones a resolver antes de merge:
1. **MEDIUM** — Fallback inconsistente de `example_input` entre wizard (`'{}'`) y register API (`null`). Unificar.
2. **LOW** — `hasProps` acepta schemas sin `properties` ni `type`; considerar añadir `metaValidateSchema` al wizard.
3. **LOW** — Race condition en slug; considerar retry on unique violation.
