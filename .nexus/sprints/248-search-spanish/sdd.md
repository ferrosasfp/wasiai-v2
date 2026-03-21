# SDD — WAS-248

## Wave 0 — Pre-flight
- Leer `src/app/api/v1/agents/route.ts` — bloque del `if (q && q.length >= 2)` completo
- Confirmar que el cliente supabase soporta `.or()` con ilike
- Confirmar shape del response de search (agents array + total)

## Wave 1 — Añadir fallback ILIKE

**Archivo:** `src/app/api/v1/agents/route.ts`

En el bloque de búsqueda FTS (`if (q && q.length >= 2)`), después de obtener `agents` de `searchData`, añadir el fallback:

```typescript
// Si FTS retorna 0 resultados, intentar ILIKE fallback (soporta español y términos parciales)
let searchMethod = 'fts'
if (agents.length === 0) {
  searchMethod = 'fallback_ilike'
  const ilikeQ = q.replace(/[%_]/g, '\\$&') // escape de caracteres especiales
  const { data: ilikeData } = await supabase
    .from('agents')
    .select('id, slug, name, description, category, agent_type, price_per_call, is_featured, total_calls, performance_score, reputation_score, mcp_tool_name, sandbox_enabled, input_schema, output_schema, example_input')
    .eq('status', 'active')
    .or(`name.ilike.%${ilikeQ}%,description.ilike.%${ilikeQ}%`)
    .order('is_featured', { ascending: false })
    .order('total_calls', { ascending: false })
    .range(offset, offset + limit - 1)

  agents = (ilikeData ?? []) as Record<string, unknown>[]
}
```

En el return del bloque de búsqueda, añadir `search_method` al response:
```diff
  return NextResponse.json({
    schema: 'wasiai/agents/v1',
    total: agents.length,
    limit,
    offset,
+   search_method: searchMethod,
    agents: agents.map(...)
  }, { headers: { 'Access-Control-Allow-Origin': '*' } })
```

**IMPORTANTE:** El select del ILIKE debe incluir los MISMOS campos que el select del FTS existente para que el `.map()` posterior funcione igual.

**Build gate:** `npm run typecheck && npm run lint`

## Rollback
`git revert <commit>` — 1 archivo, sin migración DB, sin cambios en RPC.

## Constraint Directives
- OBLIGATORIO: Fallback SOLO cuando FTS retorna 0 resultados
- OBLIGATORIO: Escapar `q` antes de usarlo en ILIKE (evitar SQL injection vía `%`, `_`)
- OBLIGATORIO: Mismo select de campos que FTS para que el map() funcione
- PROHIBIDO: Modificar `search_agents` RPC ni migraciones
- PROHIBIDO: Reemplazar FTS — solo fallback adicional

## Commit
```
fix(WAS-248): add ILIKE fallback when FTS returns 0 — supports Spanish queries
```
