## Spec Review — Sprint 4 (WAS-213, WAS-186, WAS-196, WAS-200)

> Revisado: 2026-03-14 | Reviewer: San (Spec Reviewer NexusAgil v1.3)
> Repo: `/home/ferdev/.openclaw/workspace/wasiai-v2`

---

### WAS-213 — performance_score basado en error_rate_7d

#### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| `get_agent_percentile_metrics` existe en `046_percentile_metrics.sql` | ✅ EXISTE | `CREATE OR REPLACE FUNCTION get_agent_percentile_metrics(p_agent_id UUID)` confirmado |
| Devuelve `error_rate_7d` | ✅ SÍ | Columna `error_rate_7d NUMERIC` en tipo retorno y en SELECT interno |
| `trg_update_agent_reputation` en `0011_agent_ratings.sql` | ✅ EXISTE (línea 71) | `CREATE TRIGGER trg_update_agent_reputation` — WAS-213 no lo toca |
| `?min_reputation` en `src/app/api/v1/agents/route.ts` | ✅ NO EXISTE | Grep sin resultados — correcto, WAS-213 lo añade |
| `performance_score` en alguna migración existente | ✅ NO EXISTE | Grep en todas las migraciones: sin resultados |
| Próximo número libre es 058 | ✅ CORRECTO | Última migración: `057_agents_health_check.sql` → 058 libre |

#### Coherencia

| Check | Estado | Detalle |
|-------|--------|---------|
| AC1 cubierto por wave | ✅ OK | Wave 1 crea migración 058 con `performance_score` |
| AC2 cubierto por wave | ✅ OK | Wave 1 incluye trigger `trg_update_agent_performance_score` |
| AC3 (NULL si <5 calls) | ✅ OK | Trigger solo actualiza si `error_rate_7d IS NOT NULL` (función retorna NULL cuando <5 calls) |
| AC4 (atomicidad) | ✅ OK | FOR EACH ROW — atómico por definición |
| AC5 cubierto por wave | ✅ OK | Wave 2 añade `?min_reputation` filter en `agents/route.ts` |
| AC6 cubierto por wave | ✅ OK | Wave 3 añade `performance_score` al SELECT + response de `[slug]/route.ts` |
| AC7 (EXCEPTION WHEN OTHERS) | ✅ OK | Trigger usa `EXCEPTION WHEN OTHERS THEN RAISE WARNING` |
| AC8 (seed script) | ✅ OK | Wave 4 crea `scripts/seed-performance-scores.ts` |
| Build gate en cada wave | ✅ OK | Todas las waves incluyen `npx tsc --noEmit` |
| Rollback ejecutable | ✅ OK | SQL de rollback completo: DROP TRIGGER, DROP FUNCTION, DROP COLUMN |
| Constraints OBLIGATORIO/PROHIBIDO | ✅ OK | 4 OBLIGATORIO + 2 PROHIBIDO presentes |

#### Findings

| # | Severidad | Detalle | Corrección |
|---|-----------|---------|------------|
| 1 | ⚠️ MENOR | El SDD dice que `?min_reputation` "solo está en agent-discovery.ts" pero el grep confirma que no está en `route.ts` — descripción imprecisa, no incorrecta | Clarificar en §4.2: "el parámetro no existe en ninguna ruta pública actual" |
| 2 | ⚠️ MENOR | El trigger no verifica el mínimo de 5 calls antes de recalcular; delega esa lógica a `get_agent_percentile_metrics` (que retorna NULL). Funciona correctamente pero el AC3 no es explícito en el trigger SQL | Añadir comentario en el trigger explicando que NULL de la función implica <5 calls |
| 3 | ℹ️ INFO | `?min_reputation` en AC5 filtra por `performance_score` (invocaciones), no por `reputation_score` (votos). El nombre puede confundir a consumidores de la API | Evaluar si renombrar a `?min_performance` o documentar la distinción en el response |

#### Veredicto: ✅ LISTO (con findings menores)

---

### WAS-186 — Key Scoping en invoke directo

#### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| Migración 053 existe | ✅ EXISTE | `053_agent_key_scoping.sql` confirmado |
| Tiene `allowed_slugs` | ✅ SÍ | `ADD COLUMN IF NOT EXISTS allowed_slugs TEXT[] DEFAULT NULL` |
| Tiene `allowed_categories` | ✅ SÍ | `ADD COLUMN IF NOT EXISTS allowed_categories TEXT[] DEFAULT NULL` |
| `isAgentInScope` en `src/lib/scope-check.ts` | ✅ EXISTE | `export function isAgentInScope(agentSlug: string, agentCategory: string, allowedSlugs: string[] \| null, allowedCategories: string[] \| null): boolean` |
| SELECT en `models/[slug]/invoke/route.ts` incluye `allowed_slugs, allowed_categories` | ✅ NO INCLUYE | `.select('id, key_hash, is_active, budget_usdc, spent_usdc')` — correctamente identificado como gap |
| `compose/route.ts` usa `scope_violation` actualmente | ✅ CONFIRMADO | Línea 269: `code: 'scope_violation'` — necesita cambiar a `agent_not_in_scope` |

#### Coherencia

| Check | Estado | Detalle |
|-------|--------|---------|
| AC1 cubierto por wave | ✅ OK | Wave 0 es verificación, no implementación |
| AC2 cubierto por wave | ✅ OK | Wave 1 + Wave 2 implementan scope check |
| AC3 (array vacío = sin acceso) | ✅ OK | Diseño §4.1 maneja `length === 0` con `__no_access__` |
| AC4 (null = acceso total) | ✅ OK | `isAgentInScope` ya maneja null correctamente |
| AC5 (OR logic) | ✅ OK | `isAgentInScope` implementa OR — slug en lista OR categoría en lista |
| AC6 (unificar error code) | ✅ OK | Wave 3 cambia `scope_violation` → `agent_not_in_scope` |
| AC7 (slug inexistente → 403, no 404) | ✅ OK | Scope check ocurre antes del 404 de modelo inexistente |
| Build gate en cada wave | ✅ OK | `npx tsc --noEmit` en waves 1–3 |
| Rollback ejecutable | ✅ OK | `git revert <commit>` — cambios aditivos en middleware |
| Constraints OBLIGATORIO/PROHIBIDO | ✅ OK | 3 OBLIGATORIO + 2 PROHIBIDO |

#### Findings

| # | Severidad | Detalle | Corrección |
|---|-----------|---------|------------|
| 1 | 🔴 CRÍTICO | El código `effectiveSlugs`/`effectiveCategories` con `__no_access__` es un hack frágil. Si `isAgentInScope` cambia su lógica interna, el hack puede romperse silenciosamente. La función acepta `null` para "sin restricción" pero no hay un valor canónico para "sin acceso" | Preferir lógica explícita: `if (Array.isArray(allowedSlugs) && allowedSlugs.length === 0) return false` directamente en el invoke, antes de llamar a `isAgentInScope` |
| 2 | ⚠️ MENOR | El SDD no menciona qué hacer con `errors.tsx` en el Wave Plan explícitamente (Wave 3 dice "compose/route.ts y errors.tsx" pero la verificación Wave 0 no cubre errors.tsx) | Añadir check: `grep 'scope_violation' src/features/docs/content/errors.tsx` |
| 3 | ℹ️ INFO | `compose/route.ts` ya importa `isAgentInScope` y `allowed_slugs/allowed_categories` en el SELECT (línea 191). El patrón ya existe y puede usarse como referencia exacta para el invoke | Documentar en §4.1 que compose es el "exemplar" |

#### Veredicto: ⚠️ NECESITA CORRECCIÓN — Finding #1 crítico (lógica array vacío)

---

### WAS-196 — Exponer sandbox_enabled en API

#### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| `sandbox_enabled` en SELECT de `GET /api/v1/agents/:slug` | ❌ NO ESTÁ | SELECT en `[slug]/route.ts` líneas 33-41: no incluye `sandbox_enabled`. No está en response object | 
| `sandbox_enabled` en SELECT de `GET /api/v1/agents` (list) | ⚠️ PARCIAL | Se usa en `.eq('sandbox_enabled', true)` para filtrar (líneas 97, 144) pero NO está en el SELECT ni en el response object de ningún path (slim ni full) |
| `sandbox_enabled` en columna `agents` (migración) | ✅ EXISTE | `051_sandbox_enabled.sql`: `ADD COLUMN IF NOT EXISTS sandbox_enabled BOOLEAN NOT NULL DEFAULT TRUE` |

#### Coherencia

| Check | Estado | Detalle |
|-------|--------|---------|
| AC1 cubierto por wave | ✅ OK | Wave 1 añade al slug route |
| AC2 cubierto por wave | ✅ OK | Wave 2 añade al list route |
| AC3 (regresión sandbox/invoke) | ✅ OK | SDD indica "ya implementado — regresión test" |
| AC4 (regresión sandbox habilitado) | ✅ OK | ídem |
| Build gate en cada wave | ✅ OK | `npx tsc --noEmit` en waves 1–2 |
| Rollback ejecutable | ✅ OK | `git revert` — solo campos aditivos |
| Constraints OBLIGATORIO/PROHIBIDO | ✅ OK | 2 OBLIGATORIO + 2 PROHIBIDO |

#### Findings

| # | Severidad | Detalle | Corrección |
|---|-----------|---------|------------|
| 1 | ⚠️ MENOR | El list route tiene DOS paths de respuesta: (a) slim path (líneas 88-117: SELECT sin `sandbox_enabled`) y (b) full path (líneas 122-175: SELECT sin `sandbox_enabled`). El SDD §4.2 solo muestra un path. Ambos deben actualizar SELECT + response | En Wave 2, actualizar AMBOS selectores (`slimQuery` y `query`) y AMBOS response mappers |
| 2 | ℹ️ INFO | El slim response omite `sandbox_enabled` pero ya lo usa para filtrar — consistente con el diseño slim, pero puede confundir: el cliente filtra por `?sandbox_only=true` pero no ve `sandbox_enabled` en los resultados del slim path | Confirmar si slim path debe exponer `sandbox_enabled` o dejar fuera por diseño |

#### Veredicto: ⚠️ NECESITA CORRECCIÓN — Finding #1: dos paths en list route, SDD solo cubre uno

---

### WAS-200 — Input Schema validation pre-cobro

#### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| Migración 054 existe con `input_schema JSONB` | ✅ EXISTE | `054_input_schema.sql`: `ADD COLUMN IF NOT EXISTS input_schema JSONB DEFAULT NULL` |
| `validateInput` en `src/lib/schema-validator.ts` | ✅ EXISTE | `export function validateInput(schema: unknown, input: unknown): string \| null` |
| `validateInput` importado en `models/[slug]/invoke/route.ts` | ✅ NO IMPORTADO | Grep sin resultados — gap confirmado, correcto |
| Body ya se lee antes del punto de inserción | ✅ CONFIRMADO | Línea 480: `body = await request.json()` — `request.clone()` ES necesario para no consumir el stream |
| `input_schema` en SELECT de `GET /api/v1/agents/:slug` | ✅ YA ESTÁ | SELECT línea 36: `input_schema, output_schema` — respuesta incluye `input_schema: agent.input_schema ?? null` |
| `input_schema` en SELECT de `GET /api/v1/agents` (list) | ✅ YA ESTÁ (full path) | SELECT full incluye `input_schema, output_schema` y response mapper expone `input_schema: agent.input_schema ?? null` |

#### Coherencia

| Check | Estado | Detalle |
|-------|--------|---------|
| AC1 cubierto por wave | ✅ OK | Wave 0 es verificación |
| AC2 cubierto por wave | ✅ OK | Wave 1 añade `validateInput` pre-cobro en invoke |
| AC3 (skip si null) | ✅ OK | `if (model.input_schema)` — skip correcto |
| AC4 (no re-validar SSRF) | ✅ OK | Constraint PROHIBIDO presente |
| AC5 cubierto por wave | ⚠️ REDUNDANTE | Wave 2 añade `input_schema` a slug route — pero **YA ESTÁ IMPLEMENTADO** |
| AC6 cubierto por wave | ⚠️ REDUNDANTE | Wave 3 añade `input_schema` a list route — full path ya lo expone |
| AC7 (AJV no crash) | ✅ OK | "ya manejado por AJV" — `validateInput` retorna `string \| null` |
| Build gate en cada wave | ✅ OK | `npx tsc --noEmit` en waves 1–3 |
| Rollback ejecutable | ✅ OK | `git revert` — cambios aditivos |
| Constraints OBLIGATORIO/PROHIBIDO | ✅ OK | 3 OBLIGATORIO + 3 PROHIBIDO |

#### Findings

| # | Severidad | Detalle | Corrección |
|---|-----------|---------|------------|
| 1 | ⚠️ MENOR | **AC5 ya está implementado**: `GET /api/v1/agents/:slug` ya expone `input_schema` en SELECT y response. Wave 2 sería un no-op que confunde al implementador | Eliminar Wave 2 del plan. Añadir nota: "AC5 ya cumplido — verificado en Wave 0" |
| 2 | ⚠️ MENOR | **AC6 parcialmente ya implementado**: El full path del list route ya expone `input_schema`. Solo el slim path (líneas 88-117) no lo incluye — pero ese path es intencional (metadata reducida). Wave 3 debe aclarar si aplica al slim path o no | Aclarar en §4.3 si el slim path debe o no exponer `input_schema` |
| 3 | 🔴 CRÍTICO | El SDD dice que `invoke/route.ts` (`models/[slug]/invoke`) hace `supabase.from('agents').select('*')` — confirmado (línea 159: `.select('*')`), por lo que `input_schema` llega en `model`. Pero el diseño propone leer el body con `request.clone().json()` ANTES del punto donde ya se hace `body = await request.json()` (línea 480). Si el `request.clone()` falla o genera inconsistencias de tipo, la validación fallará silenciosamente | Verificar el orden exacto en el handler: si `request.clone().json()` se llama en el bloque de validación (antes de línea 480) y luego `request.json()` se llama de nuevo en línea 480 sin clone → error de stream ya consumido. El SDD ya advierte usar `request.clone()` pero no especifica si el `request.json()` de línea 480 también necesita ajuste (debería usar la variable `body` ya leída en validación) |
| 4 | ℹ️ INFO | `validateInput` retorna `string \| null` (un mensaje de error o null). El SDD propone `details: validErr` pero `validErr` sería un string, no un array. El AC2 dice `details: [...]` sugiriendo array | Confirmar tipo de retorno de `validateInput`; si es string, cambiar `details: validErr` a `details: [validErr]` para consistencia con el AC |

#### Veredicto: ⚠️ NECESITA CORRECCIÓN — Finding #3 crítico (stream body ya consumido), Finding #4 type mismatch en details

---

### Resumen

| Issue | SDD | Veredicto |
|-------|-----|-----------|
| WAS-213: performance_score + trigger + filter | WAS-213 | ✅ LISTO |
| WAS-186: scope check en invoke directo | WAS-186 | ⚠️ NECESITA CORRECCIÓN |
| WAS-196: exponer sandbox_enabled en API | WAS-196 | ⚠️ NECESITA CORRECCIÓN |
| WAS-200: validateInput pre-cobro | WAS-200 | ⚠️ NECESITA CORRECCIÓN |

#### Acciones Requeridas

| # | SDD | Finding | Acción |
|---|-----|---------|--------|
| 1 | WAS-186 | Array vacío hack frágil | Reemplazar lógica `__no_access__` con early return explícito en invoke |
| 2 | WAS-196 | Dos paths en list route | Actualizar §4.2 para cubrir slim path y full path explícitamente |
| 3 | WAS-200 | Body stream ya consumido | Aclarar que validación usa `request.clone()` y que la lectura posterior en línea 480 debe usar la variable `body` ya leída (no llamar `request.json()` dos veces) |
| 4 | WAS-200 | `details` type mismatch | Cambiar `details: validErr` → `details: [validErr]` o ajustar AC2 |
| 5 | WAS-200 | Waves 2 & 3 redundantes | Marcar AC5 y AC6 como ya implementados; simplificar Wave Plan |
