## Logic Audit — WAS-248 (commit `319b852`)

**Auditor:** San (Subagent)  
**Fecha:** 2026-03-19  
**Archivo:** `src/app/api/v1/agents/route.ts`

---

### AC Trazabilidad

| AC | Implementado | Archivo:línea | Status |
|----|--------------|---------------|--------|
| AC-01: `q=precio` → retorna resultados con "price" via ILIKE | ✅ | route.ts:81-87 | **PASS** |
| AC-02: `q=riesgo` → retorna resultados con "risk" via ILIKE | ✅ | route.ts:81-87 | **PASS** |
| AC-03: `q=oracle` sigue funcionando (FTS primero) | ✅ | route.ts:54-64 | **PASS** |
| AC-04: `q=chainlink` sin cambios | ✅ | route.ts:54-64 | **PASS** |
| AC-05: Response incluye `search_method` | ✅ | route.ts:77,79,96 | **PASS** |
| AC-06: Fallback SOLO cuando FTS retorna 0 | ✅ | route.ts:78 | **PASS** |
| AC-07: Rate limit y paginación preservados | ✅ | route.ts:51,56-57,87 | **PASS** |

---

### Findings

| # | Severidad | Detalle | Archivo:línea |
|---|-----------|---------|---------------|
| 1 | **MEDIUM** | Campo `ts_rank` indefinido en resultados ILIKE. El `.map()` (L101) accede a `agent.rank`, pero el SELECT del fallback ILIKE (L81-82) no incluye un campo `rank`. FTS RPC retorna `rank` desde `ts_rank`, pero ILIKE no tiene equivalente. Resultado: `ts_rank: undefined` en respuestas de fallback, inconsistente con FTS. | route.ts:81-82, 101 |
| 2 | **LOW** | Paginación aplicada DESPUÉS del post-filter `min_performance` (L91-93). Si el filter descarta muchos resultados, el cliente puede recibir menos de `limit` items. Comportamiento técnicamente correcto pero podría ser inesperado. | route.ts:91-93 |

---

### Corrección lógica — Detalle

#### ✅ `searchMethod` scope correcto
- Línea 77: `let searchMethod = 'fts'` se declara ANTES del bloque `if (agents.length === 0)`
- Línea 96: `search_method: searchMethod` visible en el return
- **PASS**

#### ✅ Escape SQL wildcards correcto
- Línea 80: `const ilikeQ = q.replace(/[%_\\]/g, '\\$&')`
- Escapa `%`, `_`, y `\` correctamente
- **PASS**

#### ⚠️ SELECT del ILIKE incompleto
- SELECT (L81-82): `id, slug, name, description, category, agent_type, price_per_call, is_featured, total_calls, performance_score, reputation_score, mcp_tool_name, sandbox_enabled, input_schema, output_schema, example_input`
- Campos usados en `.map()` (L98-107): `slug, name, description, category, agent_type, rank, price_per_call, currency (hardcoded), invoke_url (computed), example_input`
- **ISSUE**: `agent.rank` (L101) no existe en resultados ILIKE
- **MEDIUM severity** — no rompe funcionalidad pero crea inconsistencia en respuestas

#### ✅ Cliente Supabase correcto
- Línea 81: usa `supabase` (anon client declarado en L38)
- Correcto para datos públicos de `agents`
- **PASS**

#### ✅ Reasignación de `agents` correcta
- Línea 88: `agents = (ilikeData ?? []) as Record<string, unknown>[]`
- **PASS**

#### ✅ `search_method` en return
- Línea 96: incluido correctamente
- **PASS**

---

### Edge Cases

#### ✅ `q` contiene wildcards SQL (`%`, `_`, `\`)
- Línea 80: escapados correctamente con `q.replace(/[%_\\]/g, '\\$&')`
- Ejemplo: `q="test_100%"` → `ilikeQ="test\\_100\\%"`
- **PASS**

#### ✅ ILIKE también retorna 0 resultados
- Response: `{ agents: [], search_method: "fallback_ilike", total: 0, ... }`
- Comportamiento correcto
- **PASS**

#### ⚠️ Filtro `min_performance` post-search
- Líneas 91-93: `agents = agents.filter(a => ((a.performance_score as number) ?? 0) >= minPerformance!)`
- Se aplica DESPUÉS de la búsqueda (FTS o ILIKE)
- **Consecuencia**: Si muchos agentes se filtran, el cliente recibe menos de `limit` items
- Técnicamente correcto (el SDD S7-02 dice "post-filter"), pero podría ser inesperado
- **LOW severity** — comportamiento intencionado pero documentar

---

### Scope Creep

#### ✅ Sin cambios fuera del bloque de búsqueda
- Revisión completa del archivo: solo el bloque `if (q && q.length >= 2)` (L48-108) contiene cambios WAS-248
- Otros bloques (slim mode, query builder, pagination) intactos
- **PASS**

---

### Veredicto: **REQUIERE CORRECCIÓN MENOR**

**Razón:** Finding #1 (campo `ts_rank` indefinido en ILIKE) rompe consistencia de respuestas.

**Recomendaciones:**

1. **FIX OBLIGATORIO (Finding #1):**
   ```typescript
   // Línea 81-88: agregar un rank sintético para ILIKE
   const { data: ilikeData } = await supabase
     .from('agents')
     .select('id, slug, name, description, category, agent_type, price_per_call, is_featured, total_calls, performance_score, reputation_score, mcp_tool_name, sandbox_enabled, input_schema, output_schema, example_input')
     .eq('status', 'active')
     .or(`name.ilike.%${ilikeQ}%,description.ilike.%${ilikeQ}%`)
     .order('is_featured', { ascending: false })
     .order('total_calls', { ascending: false })
     .range(offset, offset + limit - 1)
   
   // Agregar rank sintético basado en relevancia (nombre > descripción)
   agents = (ilikeData ?? []).map((a, idx) => ({
     ...a,
     rank: a.name.toLowerCase().includes(q.toLowerCase()) ? 0.8 : 0.4
   })) as Record<string, unknown>[]
   ```
   
   **Alternativa más simple:** Asignar `rank: null` para ILIKE y documentar que `ts_rank` solo aplica a FTS.

2. **DOCUMENTAR (Finding #2):**
   - En el SDD o comentario inline: "min_performance post-filter puede retornar < limit items"
   - Agregar a response metadata: `filtered_count` si aplica

3. **Test cases a ejecutar post-fix:**
   - `GET /api/v1/agents?q=precio` → verificar que `ts_rank` no sea `undefined`
   - `GET /api/v1/agents?q=oracle` → verificar que siga usando FTS (search_method="fts")
   - `GET /api/v1/agents?q=ñoño&min_performance=80` → verificar post-filter + ILIKE

---

**Timestamp:** 2026-03-19T16:54:00-06:00  
**Next step:** Implementar fix para Finding #1 → re-audit → QA
