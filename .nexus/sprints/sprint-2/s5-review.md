# S5 Review — Sprint 2 WasiAI
**Revisión:** Logic Auditor + Security Reviewer + QA Verifier  
**Fecha:** 2026-03-13  
**Commits:** e997777..9fab18e  
**Reviewer:** NexusAgile v1.3 Subagent

---

## Logic Audit

| Issue | Finding | Severidad |
|-------|---------|-----------|
| WAS-204 | **Race condition: preflight de saldo pre-retry**. El check de saldo total (paso [4]) ocurre ANTES de procesar `start_from_step`. Si el usuario tiene saldo suficiente para los steps pendientes pero no para todos, el preflight rechaza con 402 aunque la retry sea válida. Debería calcularse solo el costo de steps >= `resumedFromStep`. | ALTA |
| WAS-204 | **Data leakage vía ordering de checks**. En retry mode, el código verifica `pipeline.status === 'success'` (409) ANTES que `!pipeline.owned_by_key` (403). Si un pipeline ajeno ya completó, se devuelve `pipeline_not_resumable` revelando que el pipeline existe y su status. Debería chequearse ownership primero. | MEDIA |
| WAS-187 | **Fallback slug no pre-cargado en agentMap**. Cuando `discoverAgent` falla y `fallback_slug` está presente, el código hace `agentMap.get(step.fallback_slug)`. Pero `fallback_slug` solo está en el map si coincide con algún `agent_slug` de otro step. Si es un slug exclusivo de fallback, el lookup retorna `undefined` y el 422 se dispara igualmente. El fallback no funciona cuando el slug no fue pre-cargado. | ALTA |
| WAS-204 | **Nuevo pipeline_id en retry, no el original**. Cada retry genera `randomUUID()` nuevo y lo inserta en `pipeline_executions`. El `step_outputs` del intento nuevo solo tiene los steps ejecutados en este intento. Si el nuevo intento falla y el usuario quiere reintentar de nuevo, debe usar el pipeline_id nuevo (correcto), pero los outputs previos del primer pipeline original no migran al nuevo. Comportamiento aceptable si está documentado, pero puede confundir. | BAJA |
| WAS-196 | **`validateInput` en sandbox permite bypass con body vacío**. La validación de schema se saltea si `body?.input` es falsy. Un atacante que envíe `{"input": ""}` o `{}` evita la validación de schema (que puede ser un requisito funcional del agente). Sin embargo, la llamada al agente externo sí se realiza con input vacío. | BAJA |
| WAS-186 | **`createAgentKey` no valida `allowed_categories`**. El servicio valida que los slugs existan en DB, pero no valida que las categorías enviadas en `allowed_categories` sean categorías válidas. Un cliente puede crear una key con categorías inexistentes (la key funcionaría pero nunca haría match). | BAJA |

---

## Security Review

| Issue | Finding | Severidad |
|-------|---------|-----------|
| WAS-204 | **Ownership check tardío = info leakage**. `get_pipeline_for_retry` retorna status del pipeline aunque `owned_by_key = false`. El código de aplicación debería devolver 403 inmediatamente sin revelar el status del pipeline ajeno. Actualmente, si un pipeline ajeno está en status `success`, el response es 409 `pipeline_not_resumable` — revela existencia y estado. | MEDIA |
| WAS-196 | **Auth opcional en sandbox (by design)**. Usuarios anónimos acceden sin autenticación y sin costo. El rate limiting por IP+UA es la única barrera. Si el sistema de fingerprinting falla (headers manipulados), el rate limit per-UA cae al bucket `no-ua:{ip}`. Aceptable si es diseño deliberado, pero documentar explícitamente. | BAJA |
| WAS-200 | **Prototype pollution potencial en AJV**. `ajv.compile(schema as object)` con un schema controlado por el usuario podría explotar vulnerabilidades de AJV si no está en la última versión. Verificar versión de `ajv` en package.json y mantener actualizado. | MEDIA |
| WAS-186 | **`/api/v1/agent-keys/me` no filtra por `is_active`**. El endpoint permite a keys inactivas consultar su propio estado y scope. No crítico (no ejecuta acciones) pero expone que la key existe y sus campos `allowed_slugs`/`allowed_categories`. | BAJA |
| WAS-187 | **`discoverAgent` usa `CONTAINS` en JSONB**. La query `contains('capabilities', JSON.stringify([{ name: capability }]))` busca objetos que contengan exactamente `{name: capability}`. Un capability con caracteres especiales (`'` o `"`) podría causar matches incorrectos, aunque Supabase usa parameterización, por lo que SQL injection no aplica. | INFO |
| General | **`validateEndpointUrl` protege contra SSRF** en compose y sandbox. ✅ Sin issues. | OK |
| General | **No hay SQL concatenation directa** en ninguno de los archivos revisados. Todas las queries usan el cliente Supabase con parámetros. ✅ | OK |
| General | **RLS**: Las funciones `get_pipeline_for_retry` y `append_step_output` son `SECURITY DEFINER` con `REVOKE FROM PUBLIC` y `GRANT TO service_role`. ✅ Correctamente restringidas. | OK |

---

## QA Verification

| AC | Status | Evidencia |
|----|--------|-----------|
| **WAS-196** | | |
| AC-1: `sandbox_enabled BOOLEAN NOT NULL DEFAULT TRUE` | ✅ CUMPLE | `051_sandbox_enabled.sql`: `ADD COLUMN IF NOT EXISTS sandbox_enabled BOOLEAN NOT NULL DEFAULT TRUE` |
| AC-2: UI checkbox en formulario edición agente | ✅ CUMPLE | `EditAgentForm.tsx:368-371` — toggle que llama `handleChange('sandbox_enabled', ...)` |
| AC-3: Sandbox route HTTP 403 `{code: "sandbox_disabled"}` | ✅ CUMPLE | `sandbox/invoke/[slug]/route.ts:~110` — `if (agent.sandbox_enabled === false) { return 403 { error: 'Sandbox disabled by creator', code: 'sandbox_disabled' } }` |
| AC-4: Frontend muestra mensaje si `code === 'sandbox_disabled'` | ✅ CUMPLE | `SandboxClient.tsx:124-125` — `if (res.status === 403 && errData.code === 'sandbox_disabled') setErrorMsg('sandbox_disabled')` + render en línea 274 |
| AC-5: Agente visible en listing cuando `sandbox_enabled=false` | ✅ CUMPLE | Campo controla solo el endpoint sandbox; queries de listing no filtran por él |
| AC-6: Migrations aplicadas en prod + testnet | ⚠️ PARCIAL | Migration existe en repo (`051_sandbox_enabled.sql`). No verificable desde código si fue ejecutada en prod/testnet. |
| **WAS-204** | | |
| AC-1: Response incluye `pipeline_id` UUID | ✅ CUMPLE | `ComposeResponse.pipeline_id: string` + `const pipelineId = randomUUID()` en respuesta final |
| AC-2: `step_outputs JSONB` en `pipeline_executions` | ✅ CUMPLE | `052_pipeline_step_outputs.sql` + RPC `append_step_output` |
| AC-3: `start_from_step: N` + ownership check por `key_hash` | ✅ CUMPLE | `get_pipeline_for_retry` RPC verifica `ak.key_hash = p_key_hash` |
| AC-4: HTTP 403 `{code: "pipeline_access_denied"}` | ✅ CUMPLE | `compose/route.ts` — `if (!pipeline.owned_by_key) { return 403 { code: 'pipeline_access_denied' } }` |
| AC-5: Cobrar solo steps desde N en adelante | ✅ CUMPLE | `if (resumedFromStep !== undefined && globalStepIndex < resumedFromStep) { skip + continue }` — no llama `executeStep` |
| AC-6: `initial_input` opcional para encadenar output previo | ✅ CUMPLE | `if (body.initial_input !== undefined) { retryLastOutput = body.initial_input } else { usar step_outputs previos }` |
| AC-7: Response incluye `resumed_from_step: N` | ✅ CUMPLE | `...(resumedFromStep !== undefined && { resumed_from_step: resumedFromStep })` en response final |
| AC-8: `{code: "pipeline_not_resumable"}` si no existe/completó/no pertenece | ✅ CUMPLE | 404 para no encontrado, 409 para `status=success`, ambos con `code: 'pipeline_not_resumable'` |
| AC-9: DB lock `SELECT FOR UPDATE` para concurrencia | ✅ CUMPLE | `052_pipeline_step_outputs.sql` — `get_pipeline_for_retry` usa `FOR UPDATE` |
| **WAS-186** | | |
| AC-1: `allowed_slugs TEXT[]` y `allowed_categories TEXT[]` nullable | ✅ CUMPLE | `053_agent_key_scoping.sql` — `ADD COLUMN IF NOT EXISTS allowed_slugs TEXT[] DEFAULT NULL` |
| AC-2: Validar slugs al crear key → 422 si no existen | ✅ CUMPLE | `agent-keys.service.ts` — busca slugs en DB y arroja error con `{ code: 'invalid_slugs', status: 422 }` |
| AC-3: Lógica OR entre slugs y categories | ✅ CUMPLE | `scope-check.ts` — `if (allowedSlugs && ...) return true; if (allowedCategories && ...) return true` |
| AC-4: HTTP 403 `{code: "scope_violation"}` | ✅ CUMPLE | `compose/route.ts` — `{ error: 'Agent not in key scope', code: 'scope_violation', slug: ... }` status 403 |
| AC-5: Key sin scope = acceso total | ✅ CUMPLE | `scope-check.ts` — `if (!allowedSlugs && !allowedCategories) return true` |
| AC-6: Dashboard muestra scope | ✅ CUMPLE | `agent-keys/page.tsx:793-800` — muestra "Full access" o lista de slugs/categorías |
| AC-7: `GET /api/v1/agent-keys/me` incluye `allowed_slugs` y `allowed_categories` | ⚠️ PARCIAL | El endpoint selecciona `allowed_slugs, allowed_categories` en el query, PERO no los incluye en el response JSON (solo retorna `name, is_active, budget_usdc, spent_usdc, remaining_usdc, usage_pct, last_used_at, created_at, identity, status`). **Los campos no se exponen en el response.** |
| **WAS-187** | | |
| AC-1: `capabilities` ya existe, no migration nueva | ✅ CUMPLE | No hay migration para `capabilities` en sprint 2; columna preexistente |
| AC-2: Step acepta `capability` + constraints sin `agent_slug` | ✅ CUMPLE | `ComposeStep.capability?: string` + `ComposeStep.constraints?` en interface |
| AC-3: `capability` + `agent_slug` → HTTP 400 `{code: "ambiguous_step"}` | ❌ NO CUMPLE | `validateSteps()` retorna error string `"Step ${i}: capability and agent_slug are mutually exclusive"` con `code: 'validation_error'` (400), **NO** `{code: "ambiguous_step"}`. El código de error requerido por el AC no está implementado. |
| AC-4: Sin match → HTTP 422 `{code: "no_agent_match"}` | ✅ CUMPLE | `{ error: ..., code: 'no_agent_match', step: i }` status 422 |
| AC-5: Receipt incluye `resolved_slug` | ✅ CUMPLE | `if (resolvedSlugs.has(globalStepIndex)) { pushedReceipt.resolved_slug = resolvedSlugs.get(...) }` |
| AC-6: `fallback_slug` opcional | ⚠️ PARCIAL | Campo presente en interface, pero **la lógica de fallback está rota**: solo funciona si `fallback_slug` coincide con un `agent_slug` de otro step (ya en `agentMap`). Si es un slug exclusivo de fallback, `agentMap.get(step.fallback_slug)` retorna `undefined` y el 422 se dispara. |
| AC-7: Agente resuelto dentro del scope de la key | ✅ CUMPLE | `discoverAgent` filtra por scope internamente con `isAgentInScope` |
| **WAS-200** | | |
| AC-1: `input_schema JSONB` nullable en `agents` | ✅ CUMPLE | `054_input_schema.sql` — `ADD COLUMN IF NOT EXISTS input_schema JSONB DEFAULT NULL` |
| AC-2: Meta-validar JSON Schema al guardar | ✅ CUMPLE | `register/route.ts` — `metaValidateSchema(data.input_schema)` antes de insertar |
| AC-3: Bloquear `$ref` con URL → 422 `{code: "schema_ssrf_blocked"}` | ✅ CUMPLE | `schema-validator.ts` — `findExternalRefs` detecta `http://`/`https://`; register route devuelve `code: 'schema_ssrf_blocked'` cuando `error?.includes('External $ref blocked')` |
| AC-4: `POST /api/v1/agents/register` acepta `input_schema` | ✅ CUMPLE | Zod schema incluye `input_schema: z.unknown().optional().nullable()` + se inserta en DB |
| AC-5: `GET /api/v1/agents/:slug` expone `input_schema` | ✅ CUMPLE | `agents/[slug]/route.ts` — select incluye `input_schema` en la query |
| AC-6: Compose + invoke validan input ANTES de cobrar → 422 sin cargo | ✅ CUMPLE | Compose valida ANTES de llamar `executeStep` (que deduce). Sandbox valida ANTES de llamar al agente externo (después de deducir pero antes de consumir — hay reembolso si agente falla). ⚠️ En sandbox: la validación de schema ocurre DESPUÉS de la deducción de sandbox_credits. Si el schema falla, no hay reembolso. |
| AC-7: `input_schema null` → sin cambio de comportamiento | ✅ CUMPLE | `validateInput(null, ...)` retorna `null` inmediatamente |
| AC-8: UI muestra schema + ejemplos | ⚠️ PARCIAL | `TryIt.tsx` y `PublishPreview.tsx` referencian `input_schema`, pero no se verificó si hay UI de ejemplos completa. Requiere revisión de UI manual. |

---

## Veredicto

### BLOQUEANTES

1. **WAS-187 AC-3**: El código de error para `capability + agent_slug` es `validation_error`, no `ambiguous_step`. Rompe la especificación del contrato de API.

2. **WAS-187 AC-6**: `fallback_slug` no funciona cuando el slug no fue pre-cargado en `agentMap`. La lógica de fallback está efectivamente rota en el caso más común (slug exclusivo de fallback).

3. **WAS-204 Preflight Bug**: En retry mode, el preflight verifica el costo TOTAL de todos los steps, no solo los pendientes. Un retry válido puede ser rechazado con 402 cuando el saldo es suficiente para los steps restantes.

4. **WAS-186 AC-7**: `GET /api/v1/agent-keys/me` NO expone `allowed_slugs` ni `allowed_categories` en el response JSON aunque los selecciona de la DB. El AC queda incumplido.

### Recomendaciones

1. **WAS-187**: Cambiar `validateSteps()` para que retorne `{ error: '...', code: 'ambiguous_step' }` cuando `capability && agent_slug`, y asegurarse de que el handler devuelva ese código exacto con HTTP 400.

2. **WAS-187 fallback**: Pre-cargar `fallback_slug` en `staticSlugs` junto con los `agent_slug` explícitos. Agregar en la fase de resolución de agentes estáticos.

3. **WAS-204 preflight**: Calcular `totalRequired` solo para steps `>= (body.start_from_step ?? 0)` cuando se está en retry mode.

4. **WAS-186 /me endpoint**: Agregar `allowed_slugs` y `allowed_categories` al objeto de respuesta en `/api/v1/agent-keys/me/route.ts`.

5. **WAS-204 info leakage**: Invertir el orden de checks en retry mode — verificar `owned_by_key` ANTES de verificar `status === 'success'` para evitar revelar estado de pipelines ajenos.

6. **WAS-200 sandbox timing**: La validación de `input_schema` en sandbox ocurre DESPUÉS de deducir el balance. Mover la validación ANTES de `deduct_sandbox_balance` para cumplir el AC-6 de forma estricta (422 sin cargo).

7. **WAS-186 categories validation**: Validar que `allowed_categories` contenga solo valores del enum `('nlp', 'vision', 'audio', 'code', 'multimodal', 'data')` al crear la key.

8. **AJV versión**: Verificar y fijar versión de `ajv` en package.json para evitar prototype pollution en schemas controlados por usuarios.

---

*Reporte generado por NexusAgile S5 Review — Sprint 2 — 2026-03-13*
