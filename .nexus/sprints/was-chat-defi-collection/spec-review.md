# Spec Review — SDD #092

**Reviewer:** Spec Reviewer (NexusAgile v1.3)
**Fecha:** 2026-03-21
**SDD:** Chat DeFi Collection — Planner Dinámico desde BD

---

## Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 — Fix ya existe | ✅ NO existe | `getCollectionAgents`, `buildPlannerPrompt`, `defi-chat` no aparecen en ningún archivo del codebase. El fix es genuinamente nuevo. |
| 0.2 — `chat/route.ts` | ✅ Existe | `/src/app/api/v1/chat/route.ts` confirmado |
| 0.2 — `admin/collections/route.ts` | ✅ Existe | Exemplar válido. Confirma patrón `createServiceClient()` síncrono. |
| 0.2 — `src/lib/supabase/server.ts` | ✅ Existe | `createServiceClient()` es **síncrono** (sin async/await). SDD correcto. |
| 0.2 — `src/lib/ratelimit.ts` | ✅ Existe | Patrón `let _x: T | null = null` + función lazy getter. SDD correcto. |
| 0.2 — `038_collections.sql` | ✅ Existe | Schema `collections` y `collection_agents` confirmado. |
| 0.2 — `074_defi_chat_collection.sql` | ✅ NO existe | Archivo nuevo. Correcto. |
| 0.3a — `createServiceClient()` síncrono | ✅ Correcto | Devuelve `SupabaseClient` directamente. SDD asume `const supabase = createServiceClient()` sin await. ✅ |
| 0.3a — Query FK anidada válida | ✅ Válida | FK `collection_agents.agent_id → agents.id` existe en 038. supabase-js soporta la query anidada. |
| 0.3a — Tipo retorno `.collection_agents[i].agents` | ⚠️ Ambigüedad | FK many-to-one: supabase-js devuelve `agents` como **objeto singular** (`AgentRow \| null`), NO como array. El SDD no documenta el tipo explícitamente — el Builder debe saberlo. |
| 0.3a — `callLLM` firma | ✅ Correcto | `callLLM(opts): Promise<LLMResult>` donde `LLMResult.result: string`. SDD usa `plannerResponse.result` correctamente. |
| 0.3b — `collections` columnas | ✅ Correcto | `id, slug, name, description, featured, sort_order` — todos presentes en 038. |
| 0.3b — `collection_agents` columnas | ✅ Correcto | `collection_id, agent_id, sort_order`, PK compuesta. |
| 0.3b — `agents.status` tipo | ✅ TEXT | `00000000000003_wasiai_core.sql` línea 16: `status TEXT NOT NULL DEFAULT 'active'`. SDD query `status='active'` es correcto. |
| 0.3b — `agents.input_schema` columna | ✅ Existe | `054_input_schema.sql`: `ADD COLUMN IF NOT EXISTS input_schema JSONB DEFAULT NULL`. |
| 0.4 — 5 slugs en BD | ⚠️ No verificable | Los slugs `wasi-chainlink-price`, `wasi-defi-sentiment`, `wasi-onchain-analyzer`, `wasi-contract-auditor`, `wasi-risk-report` no se pueden verificar sin acceso a BD prod. Wave 1 debe validarlos antes del DML. |
| 0.5 — Completitud | ⚠️ Ver Findings | Hay 2 ambigüedades que el Builder tendría que improvisar. |

---

## Coherencia

| Check | Resultado | Detalle |
|-------|-----------|---------|
| `ON CONFLICT DO NOTHING` en collection_agents | ✅ Válido | PK `(collection_id, agent_id)` es el constraint implícito. Sintaxis sin target column es válida en PG. |
| Número de migración 074 | ✅ Correcto | Última migración existente es `073_app_settings.sql`. 074 es el siguiente secuencial. |
| AC4 + AC8 = mismo HTTP 503 | ✅ Consistente | Ambos retornan 503 con `chat_unavailable`. Razonable colapsar en el mismo error path. |
| AC6 dice "post-LLM" pero debe ser pre-compose | ⚠️ Ambigüedad leve | El texto dice "validación post-LLM" pero la intención obvia es filtrar ANTES de llamar a compose (no tiene sentido pagar por steps inválidos). Necesita aclaración de placement en el flujo. |
| `steps` variable reusada en route.ts actual | ⚠️ Riesgo Builder | La variable `let steps` se reasigna al final del handler. El Builder debe insertar AC6 en el lugar correcto del flujo sin romper la reasignación final. Ver Finding #3. |
| RLS en `collections` y `collection_agents` | ✅ OK | Políticas son `FOR SELECT` públicas. `createServiceClient()` usa service role que bypasea RLS. La query en `getCollectionAgents` funcionará. |
| Cache module-level vs constraint "NO query BD en top-level" | ✅ No conflicto | La variable `let _collectionCache = null` es solo inicialización, no una query. ✅ |
| `array_position` retorna índice 1-based | ✅ Aceptable | sort_order 1-5 en collection_agents es perfectamente válido. |

---

## Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| F-1 | 🔴 BLOCKER | **Notación de query incompleta en diseño técnico.** El SDD escribe `collections.select(...)` sin el prefijo `supabase.from(...)`. Si el Builder copia el snippet literal, el código no compilará (`collections` no está definido). | Cambiar a: `const supabase = createServiceClient(); const { data, error } = await supabase.from('collections').select(...)` |
| F-2 | 🟡 MEDIUM | **Tipo de `.agents` en nested query no documentado.** supabase-js devuelve la FK `collection_agents → agents` como **objeto singular** (`agents: AgentRow \| null`), no como array. Si el Builder infiere array, el acceso `.agents.slug` vs `.agents[0].slug` causaría un runtime error silencioso. | Añadir al diseño técnico: `// agents es un objeto singular (FK many-to-one), puede ser null. Filtrar con: ca.agents && ca.agents.status === 'active'` |
| F-3 | 🟡 MEDIUM | **Placement de AC6 ambiguo en el flujo del handler.** El SDD dice "Validación post-LLM" pero no especifica que el filtrado de `filteredSteps` debe ocurrir ANTES de la llamada a compose. El route.ts actual reasigna `steps` al final del handler; el Builder debe insertar el filtro exactamente después del parse del LLM y antes del `fetch(composeUrl, ...)`. Sin esta precisión el Builder podría insertarlo después de compose (inútil). | Añadir al SDD en la sección de flujo: "**Filtrar con validSlugs ANTES de llamar a compose.** Si `filteredSteps.length === 0` → retornar 422 `no_agents_matched` sin llamar a compose." |
| F-4 | 🟡 MEDIUM | **col_id puede ser NULL si concurrent race.** En el DO $$ block, después del `INSERT INTO collections ... ON CONFLICT DO NOTHING`, el `SELECT id INTO col_id` funcionará correctamente en secuencia normal. Pero si `col_id` queda NULL (edge case extremo), el FOREACH loop insertará `(NULL, agent_id, ...)` violando el FK constraint con un error críptico. | Añadir guard: `IF col_id IS NULL THEN RAISE EXCEPTION 'defi-chat collection not found after insert'; END IF;` |
| F-5 | 🟠 LOW | **Timeout de BD no definido en el SDD.** AC8 menciona "BD timeout → 503" pero no especifica cuál es el timeout a configurar en la query de Supabase. El cliente supabase-js no tiene timeout nativo por defecto — en serverless, la función expira (maxDuration=60s) antes. El Builder deberá implementar un `Promise.race()` o aceptar que el timeout de la función serverless es el único mecanismo. | Aclarar en AC8: "Usar `Promise.race([queryPromise, delay(5000)])` con 5s de timeout, o documentar explícitamente que el timeout es el de la función serverless (60s)." |
| F-6 | 🟠 LOW | **`input_schema` con props vacías: definición imprecisa.** AC9 y el SDD dicen `input_schema null o {}` → omitir. La condición "tiene props" no está definida exactamente. ¿`{ "token": "SYMBOL" }` cuenta? ¿`{ }` no? ¿`null`? El Builder necesita una función de validación. | Especificar: `function hasValidSchema(s: unknown): boolean { return s !== null && typeof s === 'object' && Object.keys(s).length > 0 }` |

---

## Veredicto

**NECESITA CORRECCIÓN** — 1 bloqueante, 2 issues medium que causarían bugs silenciosos:

1. **F-1 🔴**: Query snippet usa `collections.select(...)` sin `supabase.from(...)` — el Builder copiaría código que no compila.
2. **F-2 🟡**: Tipo de `.agents` (singular vs array) no documentado — riesgo de runtime error silencioso en el filtrado.
3. **F-3 🟡**: Placement de AC6 no precisa en el flujo — podría filtrarse después de compose en vez de antes.

Los issues F-4, F-5, F-6 son mejoras de robustez pero no bloquean la implementación correcta del happy path.
