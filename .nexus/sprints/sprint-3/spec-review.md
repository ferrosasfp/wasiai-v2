# Spec Review — Sprint 3
> Reviewer: NexusAgil Spec Reviewer v1.3
> Fecha: 2026-03-13
> SDDs revisados: SDD-206, SDD-SSRF002, SDD-SCOPE001, SDD-202

---

## SDD-206: IDOR fix — ownership check en WHERE clause

### Wave 0 — Pre-flight

| Check | Estado | Detalle |
|-------|--------|---------|
| 0.1 Fix ya existe | ✅ NO existe | `migrations/055_*.sql` absent; `compose/route.ts` aún usa `owned_by_key` check en TS → fix pendiente |
| 0.2 Archivos existen | ✅ OK | `052_pipeline_step_outputs.sql` ✅ · `compose/route.ts` ✅ · `doc/DB_SCHEMA.md` ✅ |
| 0.3a Tipos correctos | ✅ OK | `owned_by_key BOOLEAN` en RETURNS TABLE de 052 es correcto. Tras el fix se elimina → TS debe actualizarse |
| 0.3b Columnas DB | ✅ OK | `pipeline_executions.key_id` FK → `agent_keys.id` confirmado. `agent_keys.key_hash` existe. JOIN `ak.id = pe.key_id` en 052 es correcto |
| 0.3d DB Security | ✅ OK | 052 tiene `SECURITY DEFINER`, `SET search_path = public`, REVOKE PUBLIC, GRANT service_role. SDD exige mantenerlos en 055 |
| 0.4 Dependencias | ✅ OK | No depende de otras SDDs del sprint |
| 0.5 Completo | ⚠️ ISSUE | Ver Findings |

### Coherencia

| Aspecto | Estado | Detalle |
|---------|--------|---------|
| Trazabilidad AC → Wave | ⚠️ PARCIAL | AC-1/AC-2 → Wave 1. AC-3/AC-4 → Wave 2. Pero AC-4 no puede implementarse (ver Finding F1) |
| Build gates | ✅ OK | `tsc --noEmit` en Wave 1 y Wave 2 |
| Rollback ejecutable | ✅ OK | `DROP FUNCTION` + re-ejecutar 052 + `git revert` Wave 2 |
| ≥3 PROHIBIDO | ✅ OK | 5 directivas PROHIBIDO |

### Findings

| ID | Severidad | Área | Descripción |
|----|-----------|------|-------------|
| F1 | 🔴 CRÍTICO | AC-4 vs Sección 4 | **Contradicción interna irresoluble.** AC-4 dice "WHEN RPC returns 0 rows due to ownership mismatch THEN SHALL return `pipeline_access_denied` 403". Pero Sección 4 dice explícitamente "El compose devolverá 404 por defecto (no revelar existencia del pipeline a un atacante)". El nuevo SQL devuelve 0 filas en AMBOS casos (not found + access denied), así que TypeScript **no puede distinguirlos**. El código actual en `compose/route.ts` línea 346 (`if (!pipeline.owned_by_key)`) devuelve 403 usando la columna calculada — esa ruta desaparece con el fix. **El Builder no puede implementar simultáneamente AC-4 y la privacy goal de Sección 4.** |
| F2 | 🟡 MEDIO | AC-4 eliminable | La resolución más simple es **eliminar AC-4 del SDD** y que ambos casos (not found + access denied) devuelvan 404 `pipeline_not_found` (security by obscurity correcto). Si se quiere 403, se necesita un segundo RPC de EXISTS check — lo cual no está especificado. El SDD debe elegir y ser explícito. |
| F3 | 🟢 MENOR | DB_SCHEMA.md | La tabla `pipeline_executions` en la sección principal del doc solo tiene 4 columnas. Las columnas completas están en la sección "Actualización 2026-03-13". No hay error técnico pero puede confundir al Builder si lee solo la primera tabla. |

### Veredicto: ⚠️ NECESITA CORRECCIÓN

**Acción requerida:** Resolver contradicción AC-4 vs Sección 4. Opciones: (a) eliminar AC-4 → siempre 404; (b) agregar un RPC EXISTS separado para detectar ownership mismatch sin exponer datos. Re-aprobar SDD antes de asignar al Builder.

---

## SDD-SSRF002: Bloquear file:// y ftp:// en $ref

### Wave 0 — Pre-flight

| Check | Estado | Detalle |
|-------|--------|---------|
| 0.1 Fix ya existe | ✅ NO existe | `schema-validator.ts::findExternalRefs` usa `startsWith('http://')` → blacklist parcial → fix pendiente |
| 0.2 Archivos existen | ✅ OK | `src/lib/schema-validator.ts` ✅ |
| 0.3a Tipos correctos | ✅ OK | La función retorna `string \| null`, sin cambios de tipo |
| 0.3b Columnas DB | N/A | No hay SQL |
| 0.3d DB Security | N/A | No hay SQL |
| 0.4 Dependencias | ✅ OK | Sin dependencias. Compatible con SDD-202 (ambas modifican schema-validator.ts pero en funciones distintas si 202 agrega algo) |
| 0.5 Completo | ✅ OK | Fix es 1 línea, unambiguous |

### Coherencia

| Aspecto | Estado | Detalle |
|---------|--------|---------|
| Trazabilidad AC → Wave | ✅ OK | AC-1 a AC-8 → Wave 1 |
| Build gates | ✅ OK | `tsc --noEmit` en Wave 1 |
| Rollback ejecutable | ✅ OK | `git revert` — diff de 1 línea |
| ≥3 PROHIBIDO | ✅ OK | 4 directivas PROHIBIDO |

### Findings

| ID | Severidad | Área | Descripción |
|----|-----------|------|-------------|
| F1 | 🟢 MENOR | Naming | SDD llama "whitelist" a la lógica, pero técnicamente sigue siendo una blacklist más amplia (`includes('://')`). No es error técnico — el comportamiento es correcto. Los fragmentos internos `#/...` no contienen `://`, los paths relativos tampoco. |
| F2 | 🟢 MENOR | AC-6 vs SDD-202 | AC-6 permite `./types.json` como path relativo. Pero en el contexto del producto, AJV no resuelve paths relativos desde un schema guardado en DB. Esto es correcto según el SDD ("AJV no lo resuelve pero es válido en schema estático") — no es un error pero el Builder debe entender que el path relativo no será funcional en runtime. Informativo, no bloqueante. |

### Veredicto: ✅ LISTO

Fix unambiguo, archivos confirmados, sin dependencias problemáticas.

---

## SDD-SCOPE001: Fix error code fallback_slug scope_violation

### Wave 0 — Pre-flight

| Check | Estado | Detalle |
|-------|--------|---------|
| 0.1 Fix ya existe | ✅ NO existe | Código actual en `compose/route.ts` líneas ~298-308: `if (fbAgent && isAgentInScope(...)) { continue }` → cae a `no_agent_match` sin distinción. Fix pendiente |
| 0.2 Archivos existen | ✅ OK | `compose/route.ts` ✅ · `src/lib/scope-check.ts` ✅ |
| 0.3a Tipos correctos | ✅ OK | `isAgentInScope` en `scope-check.ts` tiene firma exacta `(agentSlug, agentCategory, allowedSlugs, allowedCategories)` — coincide con el uso actual en compose |
| 0.3b Columnas DB | N/A | No hay SQL |
| 0.3d DB Security | N/A | No hay SQL |
| 0.4 Dependencias | ✅ OK | Sin dependencias de otras SDDs |
| 0.5 Completo | ⚠️ ISSUE | Ver Finding F1 |

### Coherencia

| Aspecto | Estado | Detalle |
|---------|--------|---------|
| Trazabilidad AC → Wave | ✅ OK | AC-1/AC-2 → Wave 1 |
| Build gates | ✅ OK | `tsc --noEmit` en Wave 1 |
| Rollback ejecutable | ✅ OK | `git revert` del commit |
| ≥3 PROHIBIDO | ✅ OK | 4 directivas PROHIBIDO |

### Findings

| ID | Severidad | Área | Descripción |
|----|-----------|------|-------------|
| F1 | 🟡 MEDIO | Scoping de variable | El pseudocódigo en Sección 5 muestra `let fallbackOutOfScope = false` pero no especifica **dónde** en el loop se declara. El loop itera sobre steps (`for i in steps`). Si el Builder declara `fallbackOutOfScope` fuera del loop, el valor puede contaminar iteraciones posteriores si hay múltiples steps con capability. Debe declararse **dentro** del bloque del step (`else if (step.capability) { ... }`), antes del bloque `if (step.fallback_slug)`. El SDD debería especificarlo explícitamente. |
| F2 | 🟢 MENOR | AC-2 implicit | AC-2 dice "capability solo (sin fallback) y no match → `no_agent_match`". Esto ya funciona hoy. El SDD no necesita cambiar ese path, pero no especifica que el Builder NO debe tocar el `discovered` path del discovery. Podría causar confusion si el Builder intenta también manejar el caso `!discovered && !step.fallback_slug`. Recomendación: añadir PROHIBIDO "NO cambiar el path de discovery sin fallback_slug". |

### Veredicto: ⚠️ NECESITA CORRECCIÓN MENOR

**Acción requerida:** Especificar que `let fallbackOutOfScope = false` se declara dentro del bloque `else if (step.capability)`, antes del `if (step.fallback_slug)`. Una sola línea de aclaración en Sección 5 es suficiente.

---

## SDD-202: Output Schema Validation antes de settlement

### Wave 0 — Pre-flight

| Check | Estado | Detalle |
|-------|--------|---------|
| 0.1 Fix ya existe | ✅ NO existe | `agents.output_schema` absent en DB_SCHEMA.md ✅ · `agent_calls.result_type` absent en DB_SCHEMA.md ✅ · No hay output validation en sandbox ni compose |
| 0.2 Archivos existen | ✅ OK | Todos los archivos referenciados existen. `054_input_schema.sql` ✅ como template |
| 0.3a Tipos correctos | ✅ OK | `input_schema: z.record(z.string(), z.unknown()).optional().nullable()` en model.schema.ts — patrón a duplicar para `output_schema` es correcto |
| 0.3b Columnas DB | ✅ OK | `agent_calls` no tiene `result_type` → add needed. `agents` no tiene `output_schema` → add needed. `agent_calls.called_at` (no `created_at`) anotado en SDD |
| 0.3d DB Security | ✅ OK | Migración es solo ALTER TABLE (ADD COLUMN), no RPC nueva → sin issues de SECURITY DEFINER |
| 0.4 Dependencias | 🔴 CRÍTICO | Ver Finding F1 — collision de número de migración con SDD-206 |
| 0.5 Completo | ⚠️ ISSUE | Ver Findings |

### Coherencia

| Aspecto | Estado | Detalle |
|---------|--------|---------|
| Trazabilidad AC → Wave | ✅ OK | AC-1/AC-2/AC-4 → Wave 2. AC-3 → implícito en lógica. AC-5/AC-6 → Wave 3. AC-7 → build gates |
| Build gates | ✅ OK | `tsc --noEmit` en Wave 1, 2 y 3 |
| Rollback ejecutable | ✅ OK | DROP COLUMN en agents + agent_calls + `git revert`. Puede ejecutarse sin downtime (nullable columns) |
| ≥3 PROHIBIDO | ✅ OK | 7 directivas PROHIBIDO |

### Findings

| ID | Severidad | Área | Descripción |
|----|-----------|------|-------------|
| F1 | 🔴 CRÍTICO | Collision migración | **SDD-206 propone `055_idor_pipeline_ownership.sql`. SDD-202 propone `055_output_schema.sql`. Mismo número, dos archivos distintos.** Supabase aplica migraciones en orden lexicográfico — dos archivos con prefijo `055_` provocarán conflicto. SDD-202 debe usar **`056_output_schema.sql`** (o SDD-206 debe ceder el 055, dependiendo de orden de aplicación). |
| F2 | 🟡 MEDIO | Wave 2 tarea incompleta | W2.3 dice "agents/[slug]/route.ts + agents/route.ts — incluir output_schema en responses" pero no especifica qué línea/columna modificar. Para `agents/route.ts` el SELECT probablemente usa `.select('*')` o lista explícita — el Builder necesita saber cuál. Recomendación: especificar si usar `.select('... output_schema')` o si el wildcard ya lo cubre. |
| F3 | 🟡 MEDIO | Wave 3 scope incompleto | SDD menciona `PublishForm.tsx` en sección 4.1 pero Wave 3 no tiene un task explícito para verificar que `output_schema` se incluye en el `PATCH /api/v1/agents/[slug]` payload. W3.3 menciona "incluir output_schema en PATCH" pero sin referencia a la API route handler — el Builder podría olvidar actualizar el server-side PATCH handler si está en `agents/[slug]/route.ts`. |
| F4 | 🟡 MEDIO | Ambigüedad refund en compose | Sección 4.4 dice "if invalid → refund → insert agent_calls(result_type: schema_violation) → fail step" pero no especifica si el step fallido detiene el pipeline entero o si el pipeline continúa con `status: 'partial'`. La lógica de "fail step" en compose tiene comportamientos diferentes (continuar vs abortar). El Builder debe saber el comportamiento esperado. |
| F5 | 🟢 MENOR | `agent_calls.result_type` + `status` | La tabla ya tiene columna `status TEXT` con valores `'success' \| 'error'`. El SDD agrega `result_type` con `'success' \| 'schema_violation' \| 'agent_error'`. Hay cierta redundancia con `status`. No es un error pero el Builder podría preguntar si `status` debe actualizarse también cuando `result_type = 'schema_violation'` (¿`status: 'error'`?). SDD debería clarificarlo. |

### Veredicto: ⚠️ NECESITA CORRECCIÓN

**Acciones requeridas (en orden de prioridad):**
1. **F1 CRÍTICO:** Renombrar migración de `055_` a `056_output_schema.sql` en todo el SDD.
2. **F4 MEDIO:** Especificar si output schema violation en compose detiene el pipeline entero o produce `status: 'partial'`.
3. **F2/F3 MEDIO:** Agregar tarea explícita en Wave 2 para verificar el SELECT en `agents/route.ts`, y en Wave 3 confirmar el PATCH handler server-side.

---

## Resumen Ejecutivo

| SDD | Tipo | Veredicto | Bloqueante |
|-----|------|-----------|-----------|
| SDD-206 | BUGFIX/SECURITY | ⚠️ NECESITA CORRECCIÓN | AC-4 vs Sección 4 — contradicción irresoluble sobre 403 vs 404 |
| SDD-SSRF002 | MINI/SECURITY | ✅ LISTO | — |
| SDD-SCOPE001 | MINI | ⚠️ NECESITA CORRECCIÓN MENOR | Scoping de `fallbackOutOfScope` — 1 línea de aclaración |
| SDD-202 | FULL/QUALITY | ⚠️ NECESITA CORRECCIÓN | Collision migración 055 con SDD-206; ambigüedad comportamiento pipeline en schema violation |

### SDDs LISTOS para Builder
- **SDD-SSRF002** — puede asignarse inmediatamente.

### SDDs que NECESITAN CORRECCIÓN antes de Builder
- **SDD-206** — resolver contradicción AC-4 (decisión de producto: ¿403 o 404?).
- **SDD-SCOPE001** — aclaración de scoping de variable (corrección de 5 minutos).
- **SDD-202** — renombrar migración a 056, especificar comportamiento pipeline en violation, clarificar Wave 2/3 tasks de API routes.

### Orden recomendado de aplicación (una vez corregidos)
1. SDD-SSRF002 (independiente, seguridad)
2. SDD-206 (independiente, seguridad)  
3. SDD-SCOPE001 (independiente, error code)
4. SDD-202 después de SDD-206 (para reservar migración 055 a IDOR, 056 a output_schema)
