# Requirements Review — WAS-258: Wizard onboarding — example_input e input_schema obligatorios

**Reviewer:** Requirements Reviewer (NexusAgil v1.3)  
**Fecha:** 2026-03-20  
**Work Item:** #261 / Sprint 261

---

### Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| F1 | 🔴 Gap crítico | ALTA | No hay AC sobre migración de DB. Las columnas `example_input` e `input_schema` no están en el insert actual (`route.ts` línea ~175). Si no existen en la tabla `agents`, el deploy rompe en producción sin migration previa. El WI no menciona si las columnas ya existen. | AC-NEW-1 |
| F2 | 🔴 Gap crítico | ALTA | El rollback actual en step 7 hace `deleteUser` si el agent insert falla. Al mover el insert al step 9, el rollback debe también borrar la API key generada en step 7. El WI no describe el estado transaccional entre steps 7-9 ni cómo se hace rollback si step 9 falla. | AC-NEW-2 |
| F3 | 🟠 Gap funcional | MEDIA | AC2 dice rechazar si `example_input` equals `{"input":""}` pero no especifica el mecanismo de comparación: ¿string literal? ¿parsed JSON deep-equal? El hint del WI usa `{"input": ""}` con espacio — ¿son equivalentes? Necesita especificar comparación semántica (parsed), no string. | AC mejorar AC2 |
| F4 | 🟠 Gap funcional | MEDIA | No hay AC para `{}` (objeto vacío) ni `null` como `example_input`. Son JSON válidos pero semánticamente inútiles. ¿Se aceptan? | AC-NEW-3 |
| F5 | 🟠 Gap funcional | MEDIA | AC4 dice que step 9 es skippable con "skip", pero no hay AC explícito que diga que el valor guardado cuando se skipea es `null`. Necesita: "WHEN answer is 'skip', SHALL store `input_schema: null`". | AC-NEW-4 |
| F6 | 🟠 Gap funcional | MEDIA | Step 8 se describe como "obligatorio" pero no hay AC que diga explícitamente "SHALL NOT accept 'skip' as answer for step 8". Sin esto un implementador podría dejarlo skippable. | AC-NEW-5 |
| F7 | 🟡 Gap menor | BAJA | AC7 "TypeScript build SHALL pass" no es un Acceptance Criterion — es una condición de definition of done, no testeable como AC de negocio. Moverlo a DoD. | Eliminar AC7 como AC |
| F8 | 🟡 Gap menor | BAJA | El `QUESTIONS` dict en `route.ts` necesita actualizarse con las entradas 8 y 9. El WI menciona las preguntas/hints en prosa pero no hay AC que diga "SHALL update QUESTIONS dict entries 8 and 9 with the specified text". Sin esto el implementador podría usar texto diferente. | AC-NEW-6 |
| F9 | 🟡 Gap menor | BAJA | No hay AC sobre qué pasa con sesiones de onboarding activas al momento del deploy (sessions que tengan `current_step: 7` antes del deploy). Con el nuevo código, su step 7 sería email pero el total_steps habrá cambiado a 9 — experiencia inconsistente. ¿Se invalidan sesiones viejas? | AC-NEW-7 |
| F10 | 🟡 Gap menor | BAJA | No hay AC sobre el mensaje de error específico cuando `example_input` no es JSON válido. Solo dice "reject with 400". ¿Cuál es el mensaje? Importante para callers que parseen errores. | AC mejorar AC3 |
| F11 | ℹ️ Info | INFO | Código actual (step 7): el agent insert ya no incluirá `example_input`/`input_schema` porque esos datos se recolectan después. El insert se mueve a step 9. El WI lo menciona correctamente pero no describe explícitamente qué campos adicionales del `data` object estarán disponibles en step 9 vs step 7. | Clarificación en WI |

---

### ACs sugeridos (agregar)

**AC-NEW-1 — Migración de DB:**
> IF columns `example_input` and `input_schema` do not exist in `agents` table, THEN a DB migration SHALL be created and applied before deployment. The migration SHALL NOT set NOT NULL constraint on `input_schema`.

**AC-NEW-2 — Estado transaccional steps 7-9:**
> WHEN step 7 completes (user + API key created), session data SHALL store `creator_id` and `key_hash`. IF agent insert in step 9 fails, SHALL rollback by deleting the API key (by `key_hash`) and the newly created user (by `creator_id`). SHALL NOT leave zombie users or orphan keys.

**AC-NEW-3 — JSON semánticamente vacío:**
> IF `example_input` parses to an empty object `{}` or `null`, SHALL reject with 400 and error message "example_input must contain at least one field".

**AC-NEW-4 — input_schema skip:**
> WHEN step 9 answer is exactly "skip" (case-insensitive), SHALL store `input_schema: null` in session data and proceed to agent insert.

**AC-NEW-5 — example_input no skippable:**
> WHEN step 8 answer is "skip" or empty string, SHALL reject with 400 and error "example_input is required and cannot be skipped".

**AC-NEW-6 — QUESTIONS dict:**
> SHALL add entries to QUESTIONS dict: `8: { question: "Give an example of a valid input for your agent (JSON format)", hint: "e.g. {\"query\": \"What is the price of AVAX?\"}" }` and `9: { question: "Describe your agent's input schema (optional). Type \"skip\" to continue.", hint: "e.g. {\"query\": \"string — your question\"}" }`.

**AC-NEW-7 — Sesiones legacy:**
> WHEN a session with `current_step <= 7` exists at deploy time AND `total_steps` changes to 9, the session SHALL continue normally (steps 1-7 unaffected, steps 8-9 added after).

---

### ACs existentes — mejoras de redacción

**AC2 mejorado:**
> IF `example_input`, when parsed as JSON, deep-equals `{"input":""}` (semantic comparison, whitespace-insensitive) OR is empty string, SHALL reject with 400 and error "example_input cannot be the default placeholder".

**AC3 mejorado:**
> IF `example_input` cannot be parsed as valid JSON, SHALL reject with 400 and error "example_input must be valid JSON".

---

### Veredicto

**NECESITA CAMBIOS**

Gaps críticos (F1, F2) bloquean el merge: falta definición de migración DB y el rollback transaccional entre steps 7-9 no está especificado. Si el WI se implementa sin estos, hay riesgo de zombie users/orphan keys en producción y posible crash de deploy si las columnas no existen.

Gaps funcionales (F3-F6) deben resolverse antes de que QA pueda generar casos de prueba deterministas.
