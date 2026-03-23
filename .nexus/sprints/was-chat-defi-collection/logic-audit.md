# Logic Audit — SDD #092 (commit `67b98bb34`)

**Auditor:** Logic Auditor (subagent)
**Fecha:** 2026-03-21
**Archivos revisados:**
- `src/app/api/v1/chat/route.ts`
- `supabase/migrations/074_defi_chat_collection.sql`

---

## AC Trazabilidad

| AC | Implementado | Archivo:línea | Status |
|----|-------------|---------------|--------|
| AC1 — Migración idempotente (colección + 5 agentes, ON CONFLICT, RAISE EXCEPTION, guard col_id) | Sí | `074_defi_chat_collection.sql:1-40` | ✅ PASS |
| AC2 — Planner dinámico con status='active' via JOIN | Parcial — prompt es dinámico pero NO filtra status='active' | `route.ts:38-49` | ❌ FAIL |
| AC3 — Prompt con slug + name/description (+ input_schema props) | Parcial — slug y description presentes, input_schema ausente | `route.ts:56-73` | ❌ FAIL |
| AC4 — 503 si colección vacía, BD caída, o todos sin input_schema | Parcial — BD caída y vacía cubiertas; "todos sin input_schema" nunca se evalúa (AC9 no implementado) | `route.ts:102-115` | ⚠️ PARTIAL |
| AC5 — Response shape sin cambios: {answer, steps, receipts, total_cost_usdc, pipeline_id} | Sí | `route.ts:189-195` | ✅ PASS |
| AC6 — Filtrar steps no en colección ANTES de compose. 0 steps → 422 | Sí | `route.ts:148-158` | ✅ PASS |
| AC7 — Cache in-memory 60s por instancia (best-effort) | No — TTL hardcodeado a 5 minutos (300 000 ms) en lugar de 60 000 ms | `route.ts:18` | ❌ FAIL |
| AC8 — BD timeout → 503 + console.error | Sí — error de Supabase hace throw, capturado en POST con console.error → 503 | `route.ts:97-107` | ✅ PASS |
| AC9 — input_schema null o {} → omitir. Todos omitidos → 503 | No — query no selecciona input_schema; extractAgent no lo valida; filtrado no existe | `route.ts:22-31, 38-51` | ❌ FAIL |

---

## Findings

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|---------------|
| F1 | 🔴 CRÍTICO | AC2 — Agentes inactivos | La query Supabase selecciona `agents(slug, name, description)` sin filtrar `status`. Tampoco hay condición `.eq('agents.status', 'active')` en el query builder. `extractAgent` no comprueba status. Resultado: agentes con `status='inactive'` o `status='deprecated'` ingresan al pool y el planner puede enrutarles llamadas. | `route.ts:38-51` |
| F2 | 🔴 CRÍTICO | AC9 — input_schema ignorado | `CollectionAgent` no incluye el campo `input_schema`. La query no lo selecciona. `extractAgent` no lo valida. El filtro "omitir si null o `{}`" nunca ocurre, violando AC9 completamente. Como consecuencia, el guard de AC4 ("todos omitidos → 503") es código muerto: nunca puede activarse. | `route.ts:8-11, 22-31, 38-51` |
| F3 | 🟡 MEDIO | AC7 — Cache TTL 5× mayor | `CACHE_TTL_MS = 5 * 60 * 1000` (300 000 ms = 5 min). SDD especifica 60 000 ms (60 s). En deployments con múltiples instancias esto puede enmascarar cambios de colección por hasta 5 minutos en lugar de 1. Desviación intencional según comentario del Builder, pero no autorizada en el SDD. | `route.ts:18` |
| F4 | 🟡 MEDIO | AC3 — Prompt sin propiedades de input_schema | `buildPlannerPrompt` genera líneas `- {slug}: {description \|\| name}`. El SDD exige incluir las propiedades del `input_schema` (ej: `"token": "string"`) para que el LLM conozca los parámetros esperados de cada agente. Sin esto el planner puede inferir keys incorrectas o incompletas, causando fallos en `compose`. | `route.ts:56-73` |
| F5 | 🟠 MENOR | AC4 — Rama "todos sin input_schema → 503" es dead code | Dado que F2 impide que se filtre por input_schema, la condición `agents.length === 0` post-filtrado de AC9 nunca puede activarse por esa razón. El check sí cubre el caso "colección sin agentes registrados", pero no el caso explícito de AC4. | `route.ts:109-115` |
| F6 | 🟢 INFO | AC1 — ON CONFLICT DO NOTHING en collection_agents | El INSERT usa `ON CONFLICT DO NOTHING` sin especificar columnas de conflicto. Si la tabla `collection_agents` tiene una constraint en `(collection_id, agent_id)` esto es correcto, pero si la constraint tiene nombre distinto o columnas adicionales puede silenciar duplicados inesperadamente. Revisar constraint DDL de la tabla. | `074_defi_chat_collection.sql:36` |

---

## Veredicto

**REQUIERE CORRECCIÓN**

Dos bugs críticos bloquean el cumplimiento del SDD:

1. **F1 (AC2):** Agentes inactivos pueden ser enrutados. Corrección: añadir `.eq('agents.status', 'active')` al query **o** seleccionar `status` y filtrar en JS.
2. **F2 (AC9):** `input_schema` nunca se evalúa. Corrección: seleccionar `input_schema` en la query, añadir campo a `CollectionAgent`, filtrar en `extractAgent` o post-map, y propagar el guard de AC4.
3. **F3 (AC7):** TTL debe ser `60 * 1000` según SDD. Requiere aprobación explícita si se quiere mantener 5 min.
4. **F4 (AC3):** El prompt del planner es funcionalmente débil sin los tipos de input_schema; el LLM operará con información incompleta.
