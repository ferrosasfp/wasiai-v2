## QA Verification — Sprint 2 WasiAI

_Verificado: 2026-03-13 | Modelo: claude-sonnet-4-6 | Modo: subagent QA Verifier_

| AC | Issue | Estado | Evidencia |
|----|-------|--------|-----------|
| `allowed_slugs` en tabla `agent_keys` | WAS-186 | ✅ | migration 053, línea 5 |
| `allowed_categories` en tabla `agent_keys` | WAS-186 | ✅ | migration 053, línea 6 |
| `isAgentInScope` en `src/lib/scope-check.ts` | WAS-186 | ✅ | scope-check.ts, función exportada con lógica OR |
| compose valida scope para agentes estáticos | WAS-186 | ✅ | compose/route.ts — bloque "Scope check estático (WAS-186)" |
| Nuevo campo `allowed_slugs`/`allowed_categories` en `createAgentKey` | WAS-186 | ✅ | agent-keys.service.ts, líneas 15-16, 42-79 |
| Columna `sandbox_enabled` en tabla `agents` | WAS-196 | ✅ | migration 051, `ADD COLUMN sandbox_enabled BOOLEAN NOT NULL DEFAULT TRUE` |
| Sandbox route retorna 403 con `code: "sandbox_disabled"` | WAS-196 | ✅ | sandbox/invoke/[slug]/route.ts — bloque WAS-196 |
| UI tiene checkbox `sandbox_enabled` | WAS-196 | ✅ | `EditAgentForm.tsx` línea 368 (toggle switch) + `Step3Technical.tsx` línea 188 (publish flow) |
| Columna `step_outputs JSONB` en `pipeline_executions` | WAS-204 | ✅ | migration 052, `ADD COLUMN step_outputs JSONB DEFAULT '[]'` |
| RPC `get_pipeline_for_retry` existe | WAS-204 | ✅ | migration 052, `CREATE OR REPLACE FUNCTION get_pipeline_for_retry` |
| RPC `append_step_output` existe | WAS-204 | ✅ | migration 052, `CREATE OR REPLACE FUNCTION append_step_output` |
| compose acepta `pipeline_id` + `start_from_step` opcionales | WAS-204 | ✅ | compose/route.ts — interfaz `ComposeRequest` + bloque RETRY MODE |
| Steps antes de `start_from_step` se saltan | WAS-204 | ✅ | compose/route.ts — `if (resumedFromStep !== undefined && globalStepIndex < resumedFromStep) { globalStepIndex++; continue }` |
| Columna `input_schema JSONB` en tabla `agents` | WAS-200 | ✅ | migration 054, `ADD COLUMN input_schema JSONB DEFAULT NULL` |
| `src/lib/schema-validator.ts` con `metaValidateSchema` y `validateInput` | WAS-200 | ✅ | schema-validator.ts — ambas funciones exportadas |
| register/route.ts valida schema antes de guardar | WAS-200 | ✅ | register/route.ts líneas 159-163, `metaValidateSchema(data.input_schema)` |
| compose valida input ANTES de cobrar | WAS-200 | ✅ | compose/route.ts — validación antes de `executeStep` (donde ocurre deducción) |
| sandbox/invoke valida input ANTES de cobrar | WAS-200 | ✅ | sandbox/invoke/[slug]/route.ts — bloque WAS-200 antes del balance check |
| UI muestra `input_schema` en ficha del agente si existe | WAS-200 | ✅ | models/[slug]/page.tsx líneas 166-173, `{model.input_schema && (...)}` |
| `src/lib/agent-discovery.ts` existe con `discoverAgent` | WAS-187 | ✅ | agent-discovery.ts — función `discoverAgent` exportada |
| compose acepta `capability` en lugar de `agent_slug` | WAS-187 | ✅ | compose/route.ts — interfaz `ComposeStep.capability?` + bloque discovery dinámico |
| `capability` + `agent_slug` juntos → error | WAS-187 | ✅ | compose/route.ts `validateSteps` — `if (s.capability && s.agent_slug) return \`Step ${i}: capability and agent_slug are mutually exclusive\`` |
| `fallback_slug` funciona si no hay match | WAS-187 | ✅ | compose/route.ts — bloque `if (step.fallback_slug)` con lookup en agentMap |
| `resolved_slug` en StepReceipt | WAS-187 | ✅ | compose/route.ts — `if (resolvedSlugs.has(globalStepIndex)) { pushedReceipt.resolved_slug = ... }` |

---

### Issues pendientes

_Ninguno._

---

### Veredicto: SPRINT COMPLETO ✅

**24/24 ACs verificados ✅** — Todos los ACs de WAS-186, WAS-196, WAS-204, WAS-200 y WAS-187 están implementados. Migraciones, lógica de negocio y UI completos.
