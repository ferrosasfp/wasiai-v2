## QA Report — SDD #092 (commits `67b98bb34` + `369de6e6f`)

Fecha: 2026-03-21 | Verificado por: QA Verifier (subagente NexusAgile v1.3)

---

### Drift Detection

| Dimensión | Esperado | Real | Status |
|---|---|---|---|
| Migración SQL | Idempotente, 5 agentes, falla si slug missing | ON CONFLICT DO NOTHING + RAISE EXCEPTION con mensaje | ✅ MATCH |
| PLANNER_SYSTEM hardcodeado | Eliminado | No existe en route.ts | ✅ MATCH |
| Cache TTL | 60_000ms | `CACHE_TTL_MS = 60_000` (línea 18) | ✅ MATCH |
| Response shape | `{ answer, steps, receipts, total_cost_usdc, pipeline_id }` | Líneas 233-239 | ✅ MATCH |
| Filtrado por validSlugs | Antes de compose | Líneas 190-198, previo al fetch compose | ✅ MATCH |

---

### AC Verification

| AC | Status | Evidencia | Notas |
|---|---|---|---|
| AC1 | ✅ CUMPLE | SQL líneas 5-8: INSERT collections ON CONFLICT (slug) DO NOTHING. Líneas 11-33: FOREACH sobre 5 slugs exactos, INSERT collection_agents ON CONFLICT DO NOTHING. RAISE EXCEPTION 'Agent slug not found in agents table: %' si slug no existe. | Idempotente. Falla descriptiva garantizada. |
| AC2 | ✅ CUMPLE | route.ts líneas 52-61: query `collection_agents` con join `collections!inner(slug)` + `.eq('collections.slug', 'defi-chat')` + `.eq('agents.status', 'active')`. No existe ninguna constante `PLANNER_SYSTEM` en el archivo. | `PLANNER_SYSTEM` eliminado; prompt es dinámico via `buildPlannerPrompt()`. |
| AC3 | ✅ CUMPLE | route.ts líneas 70-82 (`buildPlannerPrompt`): cada agente imprime `${a.slug}: ${a.description ?? a.name} (input: {${propList}})` donde `propList` itera `schema.properties` con tipo. | slug + name/description + input_schema props/types. |
| AC4 | ✅ CUMPLE | route.ts líneas 122-128: catch en getCollectionAgents → 503 `chat_unavailable`. Líneas 130-134: `if (agents.length === 0)` → 503 `chat_unavailable`. | Cubre colección inexistente (error) y 0 agentes activos/válidos. |
| AC5 | ✅ CUMPLE | route.ts líneas 233-239: `return NextResponse.json({ answer, steps, receipts, total_cost_usdc, pipeline_id })`. Shape idéntica al contrato. | — |
| AC6 | ✅ CUMPLE | route.ts líneas 190-198: `validSlugs = new Set(agents.map(a => a.slug))`, `filteredSteps = normalizedSteps.filter(...)`. Si `filteredSteps.length === 0` → 422 `no_agents_matched` (líneas 199-205). Filtrado ocurre ANTES del fetch a compose (línea 207+). | — |
| AC7 | ✅ CUMPLE | route.ts líneas 15-18: `let cachedAgents`, `let cacheExpiresAt = 0`, `CACHE_TTL_MS = 60_000`. Línea 47: `if (cachedAgents && now < cacheExpiresAt) return cachedAgents`. Cache miss → query. Cache hit → return inmediato. | TTL exacto 60 000ms. |
| AC8 | ✅ CUMPLE | route.ts líneas 122-128: `catch (err) { console.error('[chat] getCollectionAgents error:', err); return NextResponse.json({ error: 'Chat service temporarily unavailable', code: 'chat_unavailable' }, { status: 503 }) }` | Prefijo `[chat]` presente. |
| AC9 | ✅ CUMPLE | route.ts líneas 32-36 (`extractAgent`): `const hasSchema = schema !== null && typeof schema === 'object' && !Array.isArray(schema) && Object.keys(schema).length > 0; if (!hasSchema) return null`. Agente omitido si schema null o `{}`. Si todos omitidos → `agents.length === 0` → 503 (líneas 130-134). | — |

---

### Build & BD

| Check | Result | Detail |
|---|---|---|
| `npx tsc --noEmit` | ✅ PASS | Sin errores ni warnings. Output vacío. |
| BD: colección `defi-chat` | ✅ EXISTE | `id: 0242115d-be10-415d-9113-88a563c11cd0`, `slug: defi-chat`, `name: DeFi Chat` |
| BD: collection_agents count | ✅ 5 FILAS | sort_order 1-5, 5 agent_ids distintos |

---

### Veredicto

**QA PASS** — Todos los ACs (AC1–AC9) se cumplen con evidencia línea por línea. Build TypeScript limpio. BD en producción refleja la migración correctamente con 5 agentes asociados a la colección `defi-chat`.
