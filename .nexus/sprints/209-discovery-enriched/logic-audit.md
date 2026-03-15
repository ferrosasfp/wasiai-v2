# Logic Audit — WAS-209 (commit 2fe0e5f)

**Auditor:** NexusAgil v1.3 Logic Auditor
**Fecha:** 2026-03-14
**Archivo auditado:** `src/app/api/v1/capabilities/route.ts`

---

## AC Trazabilidad

| AC | Descripción | Archivo:línea | Status |
|----|-------------|---------------|--------|
| AC-1 | Sin filtros → activos, enriquecidos, DESC, limit=20 | route.ts:32-36 | ✅ OK |
| AC-2 | `?tag=oracle` → `.contains('tags', [tag])` case-insensitive; vacío → `{agents:[],total:0,next_cursor:null}` | route.ts:24 (lowercase), route.ts:45 (contains) | ⚠️ PARCIAL |
| AC-3 | `?category=defi` → `.eq('category', category)` | route.ts:42 | ✅ OK |
| AC-4 | Filtros combinados; `min_reputation=0.8` → `reputation_score >= 80` en DB | route.ts:44 | ✅ OK |
| AC-5 | Estructura enriquecida completa por agente | route.ts:68-90 | ✅ OK |
| AC-6 | Sin auth | route.ts (no middleware) | ✅ OK |
| AC-7 | Cursor base64(created_at\|id); inválido → 400 | route.ts:49-61 | ⚠️ PARCIAL |
| AC-8 | `Cache-Control: public, max-age=60` | route.ts:93 | ✅ OK |
| AC-9 | limit fuera [1,100] → 400 | route.ts:15-22 | ✅ OK |

---

## Findings

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|---------------|
| F-1 | 🔴 BLOQUEANTE | AC-2 / Tag filter | El código normaliza el input a lowercase (`tag.toLowerCase()`) pero **Supabase `.contains()` hace exact match**. Si los tags en DB están almacenados en mixed-case (`"Oracle"`, `"ORACLE"`), la query `contains('tags', ['oracle'])` no los encontrará. La SDD exige "case-insensitive" pero la implementación solo cubre el lado del cliente. Para ser verdaderamente case-insensitive se requiere o (a) garantizar que todos los tags en DB se guardan en lowercase (constraint/trigger), o (b) usar una query RPC/función SQL que normalice en DB (`lower(unnest(tags))`). Sin esta garantía el filtro falla silenciosamente devolviendo 0 resultados. | route.ts:24, route.ts:45 |
| F-2 | 🟡 MENOR | AC-7 / Cursor tiebreaker | El cursor tiebreaker usa `id.lt.${cursorId}`. Si los IDs son UUID v4 (no secuenciales), la comparación lexicográfica no refleja orden de inserción. Rows con mismo `created_at` pueden paginarse incorrectamente: algunos se saltan, otros se repiten. Solo es seguro si se usan UUIDs v1/v7 o IDs enteros. | route.ts:56 |
| F-3 | 🟡 MENOR | AC-1 / Campo `total` | `total: agents.length` retorna el tamaño de la página actual (máx `limit`), no el total de agentes que coinciden con los filtros. Puede confundir a clientes que interpreten `total` como el count absoluto. En cursor-based pagination es común, pero debería documentarse explícitamente o renombrarse `page_size`. | route.ts:92 |
| F-4 | 🟢 INFO | AC-7 / Base64 inválido silencioso | `Buffer.from(cursor, 'base64')` no lanza excepción en base64 malformado — lo ignora silenciosamente. La validación depende solo de que el resultado no tenga `|`. Un string base64 inválido que no contenga `|` tras decodificar pasará la guarda y generará SQL con `cursorTs` basura (sin error → resultados incorrectos en lugar de 400). Probabilidad baja pero existe. | route.ts:51-58 |
| F-5 | 🟢 INFO | AC-5 / invoke_url hardcoded path | `invoke_url` se construye como string relativo `/api/v1/agents/${a.slug}/invoke`. No incluye host/protocolo. Clientes externos que consuman la Discovery API necesitarán construir la URL completa. No es un bug lógico vs SDD pero puede sorprender a integradores. | route.ts:77 |

---

## Detalle F-1 (BLOQUEANTE)

```ts
// Línea 24 — solo normaliza el input, no el valor en DB
const tag = searchParams.get('tag')?.toLowerCase() ?? null

// Línea 45 — exact match; si DB tiene "Oracle" no matchea "oracle"
if (tag) query = query.contains('tags', [tag])
```

**Fix recomendado — opción A (preferida):** Agregar DB-level constraint que garantice tags en lowercase en el INSERT/UPDATE:
```sql
CREATE OR REPLACE FUNCTION normalize_tags()
RETURNS TRIGGER AS $$
BEGIN
  NEW.tags = ARRAY(SELECT lower(t) FROM unnest(NEW.tags) t);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER normalize_tags_trigger
BEFORE INSERT OR UPDATE ON agents
FOR EACH ROW EXECUTE FUNCTION normalize_tags();
```

**Fix opción B (sin migración DB):** Usar RPC/función SQL o `textSearch` con `ilike any`.

---

## Detalle F-2 (MENOR)

```ts
// Línea 56 — id lexicográfico no es equivalente a orden de inserción con UUID v4
query = query.or(`created_at.lt.${cursorTs},and(created_at.eq.${cursorTs},id.lt.${cursorId})`)
```

**Fix:** Confirmar que la tabla `agents` usa `uuid_generate_v7()` o IDs enteros autoincrement. Si es UUID v4, reemplazar tiebreaker con campo `sequence_number BIGSERIAL`.

---

## Veredicto

```
REQUIERE CORRECCIÓN
```

**Bloqueante:** F-1 — el filtro `?tag=` no es verdaderamente case-insensitive a menos que los tags en DB estén garantizados en lowercase. La SDD lo exige explícitamente. Sin un trigger/constraint o evidencia de que todos los tags se persisten en lowercase, este AC no se cumple.

**Recomendado corregir antes de merge:** F-2 (si UUIDs son v4).
**Post-merge:** F-3, F-4, F-5 (no bloquean funcionalidad core).
