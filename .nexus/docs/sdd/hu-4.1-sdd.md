# S1 — SDD: HU-4.1 Búsqueda semántica en el catálogo de agentes

**Estado:** DRAFT · **Autor:** PM San · **Fecha:** 2026-02-27  
**HU:** HU-4.1 · **Epic:** EP-4 — Marketplace Discovery  
**Gate:** Pendiente SPEC_APPROVED de Fer  
**Referencia S0:** `.nexus/docs/prd/hu-4.1-s0.md`

---

## 0. Resumen ejecutivo

Añadir búsqueda full-text al catálogo de agentes usando PostgreSQL `tsvector/tsquery` con índice GIN.  
El endpoint `/api/v1/agents?q=` ya existe; actualmente usa `ilike` — se migra a tsvector para ranking real por relevancia.  
El frontend usa Server Components con form GET (ya implementado parcialmente en `SearchInput`), complementado con un hook `useAgentSearch` para el caso reactivo/client.

**Próxima migration disponible: `019`** (018 ya aplicada: `018_free_trial_creator_control.sql`)

---

## 1. Contexto técnico actual

| Elemento | Estado actual |
|----------|--------------|
| `GET /api/v1/agents?q=` | ✅ existe, usa `ilike` — sin ranking |
| `SearchInput` en `/[locale]/page.tsx` | ✅ existe (form GET, server-side) |
| `CategoryFilter` | ✅ existe, compatible |
| `tags` en tabla `agents` | ❌ no existe — se agrega en esta migration |
| `search_vector` (tsvector) | ❌ no existe — se crea en esta migration |
| Índice GIN | ❌ no existe |
| Rate limit en `/api/v1/agents` | ❌ no aplicado aún |
| `src/lib/ratelimit.ts` | ✅ patrón lazy singleton con Upstash Redis |

---

## 2. Migration SQL — `019_search_vector_agents.sql`

**Path:** `supabase/migrations/019_search_vector_agents.sql`

```sql
-- ============================================================
-- 019_search_vector_agents.sql
-- HU-4.1: Full-text search con tsvector + índice GIN en agents
-- ============================================================

-- 1. Agregar columna tags (array de texto) si no existe
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';

-- 2. Agregar columna search_vector
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 3. Índice GIN sobre search_vector (performance O(log n))
CREATE INDEX IF NOT EXISTS idx_agents_search_vector
  ON agents USING GIN (search_vector);

-- 4. Índice GIN sobre tags para filtros futuros
CREATE INDEX IF NOT EXISTS idx_agents_tags
  ON agents USING GIN (tags);

-- 5. Función para calcular search_vector con weights:
--    A = name (peso más alto)
--    B = tags
--    C = description
CREATE OR REPLACE FUNCTION agents_search_vector_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(array_to_string(NEW.tags, ' '), '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.description, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Trigger en INSERT y UPDATE
DROP TRIGGER IF EXISTS trg_agents_search_vector ON agents;
CREATE TRIGGER trg_agents_search_vector
  BEFORE INSERT OR UPDATE OF name, description, tags
  ON agents
  FOR EACH ROW
  EXECUTE FUNCTION agents_search_vector_update();

-- 7. Backfill: actualizar todos los agentes existentes
UPDATE agents SET
  search_vector =
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(array_to_string(tags, ' '), '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'C');

-- Nota: usamos 'simple' (idioma-agnóstico) para MVP.
-- Si el catálogo crece con mayoría en un idioma, evaluar 'spanish' o 'english'.
```

---

## 3. Modificación del endpoint `GET /api/v1/agents`

### 3.1 Cambio en la lógica de búsqueda

**Archivo:** `src/app/api/v1/agents/route.ts`

**Estado actual** (líneas ~`if (q)`):
```typescript
if (q) query = query.or(`name.ilike.%${q}%,description.ilike.%${q}%`)
```

**Estado deseado** — usar RPC `agents_search` (ver 3.2) cuando `q` está presente:

```typescript
// Reemplazar el bloque de query actual cuando q existe
// Pasar a función RPC que hace ts_rank + tsquery
if (q && q.trim().length >= 2) {
  // Delegamos a Postgres function para ranking real
  // Ver sección 3.2 — función SQL search_agents()
  const tsQuery = q.trim().split(/\s+/).join(':* & ') + ':*' // prefix search
  query = query
    .textSearch('search_vector', tsQuery, { type: 'websearch', config: 'simple' })
    // .order no aplica aquí — el ranking se hace via RPC; ver nota abajo
}
```

> **Nota de implementación:** Supabase PostgREST soporta `textSearch()` directamente en el query builder. El ranking (`ts_rank`) no está disponible nativamente en el query builder — para el ranking real se necesita una función RPC. En el MVP, `textSearch` con GIN es suficiente para filtrar; el ranking por `ts_rank` se agrega en la función RPC opcional (ver 3.2). El Dev decidirá si el MVP usa solo `textSearch` o la RPC completa.

### 3.2 Función SQL para búsqueda rankeada (RPC opcional para ranking)

Agregar a la migration `019` o en un archivo separado de funciones:

```sql
CREATE OR REPLACE FUNCTION search_agents(
  search_query text,
  filter_category text DEFAULT NULL,
  filter_agent_type text DEFAULT NULL,
  result_limit int DEFAULT 20,
  result_offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  slug text,
  name text,
  description text,
  category text,
  agent_type text,
  price_per_call numeric,
  is_featured boolean,
  total_calls bigint,
  rank float4
) LANGUAGE sql STABLE AS $$
  SELECT
    a.id, a.slug, a.name, a.description,
    a.category, a.agent_type, a.price_per_call,
    a.is_featured, a.total_calls,
    ts_rank(a.search_vector, websearch_to_tsquery('simple', search_query)) AS rank
  FROM agents a
  WHERE
    a.status = 'active'
    AND a.search_vector @@ websearch_to_tsquery('simple', search_query)
    AND (filter_category IS NULL OR a.category = filter_category)
    AND (filter_agent_type IS NULL OR a.agent_type = filter_agent_type)
  ORDER BY rank DESC, a.is_featured DESC, a.total_calls DESC
  LIMIT result_limit
  OFFSET result_offset;
$$;

-- RLS: la función hereda RLS de la tabla agents
-- Solo exponer via service_role si se llama desde el server
GRANT EXECUTE ON FUNCTION search_agents TO authenticated, anon;
```

**Llamada desde el endpoint:**
```typescript
if (q && q.trim().length >= 2) {
  const { data, error } = await supabase.rpc('search_agents', {
    search_query:      q.trim(),
    filter_category:   category ?? null,
    filter_agent_type: agentType ?? null,
    result_limit:      limit,
    result_offset:     offset,
  })
  // retornar directamente sin el query builder normal
}
```

### 3.3 Rate limiting en el endpoint

Agregar al inicio del handler `GET`, antes de cualquier query:

```typescript
import { getIdentifier, checkRateLimit } from '@/lib/ratelimit'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// Lazy singleton para búsqueda — 30 req/min por IP (protege cuota de Supabase)
let _search: Ratelimit | null = null
function getSearchLimit() {
  return _search ??= new Ratelimit({
    redis: new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    }),
    limiter: Ratelimit.slidingWindow(30, '1 m'),
    prefix: 'rl:search',
  })
}

// En el handler GET:
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const q = searchParams.get('q')

  // Rate limit solo cuando hay query de búsqueda (no para listado simple)
  if (q) {
    const identifier = getIdentifier(request)
    const rateLimitResponse = await checkRateLimit(getSearchLimit(), identifier)
    if (rateLimitResponse) return rateLimitResponse
  }
  // ... resto del handler
}
```

> **Alternativa más simple:** Usar `getApiLimit()` (100 req/min) ya existente en `ratelimit.ts`. Si se considera suficiente, no crear un limiter nuevo — simplemente importar el general. El Dev decide.

---

## 4. Frontend — Hook `useAgentSearch`

**Archivo nuevo:** `src/features/models/hooks/useAgentSearch.ts`

```typescript
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface AgentSearchResult {
  slug: string
  name: string
  description: string
  category: string
  agent_type: string
  price_per_call: number
  featured: boolean
}

interface UseAgentSearchOptions {
  debounceMs?: number      // default: 300
  minChars?: number        // default: 2
  category?: string
  agentType?: string
}

interface UseAgentSearchReturn {
  results: AgentSearchResult[]
  isLoading: boolean
  error: string | null
  query: string
  setQuery: (q: string) => void
  clear: () => void
}

export function useAgentSearch(options: UseAgentSearchOptions = {}): UseAgentSearchReturn {
  const { debounceMs = 300, minChars = 2, category, agentType } = options

  const [query, setQueryState]   = useState('')
  const [results, setResults]    = useState<AgentSearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError]        = useState<string | null>(null)
  const timerRef                 = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef                 = useRef<AbortController | null>(null)

  const search = useCallback(async (q: string) => {
    if (q.trim().length < minChars) {
      setResults([])
      return
    }

    // Cancelar request previo
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setIsLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({ q: q.trim(), slim: 'true', limit: '20' })
      if (category)  params.set('category',   category)
      if (agentType) params.set('agent_type', agentType)

      const res = await fetch(`/api/v1/agents?${params}`, {
        signal: abortRef.current.signal,
      })

      if (!res.ok) {
        if (res.status === 429) throw new Error('Demasiadas búsquedas. Intenta en un momento.')
        throw new Error(`Error ${res.status}`)
      }

      const json = await res.json()
      setResults(json.agents ?? [])
    } catch (err) {
      if ((err as Error).name === 'AbortError') return // cancelado intencionalmente
      setError((err as Error).message)
      setResults([])
    } finally {
      setIsLoading(false)
    }
  }, [minChars, category, agentType])

  const setQuery = useCallback((q: string) => {
    setQueryState(q)

    // Limpiar timer anterior
    if (timerRef.current) clearTimeout(timerRef.current)

    if (q.trim().length < minChars) {
      setResults([])
      setIsLoading(false)
      return
    }

    // Debounce 300ms
    timerRef.current = setTimeout(() => {
      search(q)
    }, debounceMs)
  }, [search, debounceMs, minChars])

  const clear = useCallback(() => {
    setQueryState('')
    setResults([])
    setError(null)
    setIsLoading(false)
    if (timerRef.current) clearTimeout(timerRef.current)
    abortRef.current?.abort()
  }, [])

  // Cleanup al desmontar
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      abortRef.current?.abort()
    }
  }, [])

  return { results, isLoading, error, query, setQuery, clear }
}
```

---

## 5. Componente `SearchBar` e integración en el marketplace

### 5.1 Componente SearchBar

**Archivo nuevo:** `src/features/models/components/SearchBar.tsx`

```typescript
'use client'

import { useRef } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useAgentSearch } from '../hooks/useAgentSearch'

interface SearchBarProps {
  defaultValue?: string
  category?: string
  placeholder?: string
  /** 
   * mode='server': usa form GET para navegación SSR (default en la homepage)
   * mode='client': usa useAgentSearch para resultados reactivos en SPA
   */
  mode?: 'server' | 'client'
  onResults?: (results: ReturnType<typeof useAgentSearch>['results']) => void
}

export function SearchBar({
  defaultValue = '',
  category,
  placeholder = 'Busca agentes por función, tecnología...',
  mode = 'server',
  onResults,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  // Client mode
  const { query, setQuery, isLoading, error, clear } = useAgentSearch({ category })

  if (mode === 'server') {
    // Comportamiento actual: form GET → recarga SSR
    return (
      <form method="GET" className="flex items-center gap-2">
        {category && <input type="hidden" name="category" value={category} />}
        <div className="relative">
          <input
            ref={inputRef}
            type="search"
            name="search"
            defaultValue={defaultValue}
            placeholder={placeholder}
            aria-label="Buscar agentes"
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2 pr-10 text-sm
                       focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100
                       sm:w-64"
          />
          <button
            type="submit"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label="Buscar"
          >
            🔍
          </button>
        </div>
      </form>
    )
  }

  // Client mode — reactivo
  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={e => {
            setQuery(e.target.value)
          }}
          placeholder={placeholder}
          aria-label="Buscar agentes"
          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2 pr-10 text-sm
                     focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100
                     sm:w-64"
        />
        {query && (
          <button
            type="button"
            onClick={clear}
            className="text-gray-400 hover:text-gray-600 text-sm"
            aria-label="Limpiar búsqueda"
          >
            ✕
          </button>
        )}
        {isLoading && (
          <span className="text-xs text-gray-400 animate-pulse">buscando…</span>
        )}
      </div>
      {error && (
        <p className="mt-1 text-xs text-red-500">{error}</p>
      )}
    </div>
  )
}
```

### 5.2 Integración en el marketplace

**Archivo:** `src/app/[locale]/page.tsx`

La página ya tiene `SearchInput` (server component). Se reemplaza por `SearchBar` con `mode='server'` para mantener SSR y SEO.

**Cambio mínimo:**
```typescript
// Antes (SearchInput local al final del archivo):
function SearchInput({ defaultValue, category, placeholder }) { ... }

// Después — importar SearchBar:
import { SearchBar } from '@/features/models/components/SearchBar'

// En JSX (misma posición):
<SearchBar
  defaultValue={search}
  category={category}
  placeholder={tc('search')}
  mode="server"
/>
```

**Para el servicio de búsqueda en `getModels`:** El parámetro `search` ya existe en `getModels()` — se actualiza para usar `textSearch` con la columna `search_vector` en vez de `ilike`.

**Archivo:** `src/features/models/services/models.service.ts` ← verificar que el query de `search` use `textSearch('search_vector', ...)` tras la migration.

---

## 6. Rate limiting — resumen de configuración

| Limiter | Prefix | Ventana | Requests | Activación |
|---------|--------|---------|----------|------------|
| `rl:search` | `wasiai:search` | 1 min sliding | 30 req/IP | Solo cuando `?q=` presente |
| `rl:api` (existente) | `rl:api` | — | — | Usar si 30 req/min es demasiado restrictivo |

**Implementación en `src/lib/ratelimit.ts`** — agregar:
```typescript
let _search: Ratelimit | null = null
export function getSearchLimit() {
  return _search ??= new Ratelimit({
    redis: makeRedis(),
    limiter: Ratelimit.slidingWindow(30, '1 m'),
    prefix: 'rl:search',
  })
}
```

---

## 7. Flujo end-to-end

```
Usuario escribe "solidity audit"
  │
  ▼
SearchBar (mode=server) → form GET → /[locale]?search=solidity+audit
  │
  ▼
page.tsx (Server Component)
  └─ getModels({ search: "solidity audit" })
       └─ supabase.from('agents').textSearch('search_vector', 'solidity:* & audit:*', { config: 'simple' })
            └─ PostgreSQL: GIN index lookup → ts_rank → resultados ordenados
  │
  ▼
ModelCard[] renderizados con SSR

────── Para agentes autónomos (API) ──────

GET /api/v1/agents?q=solidity+audit
  │
  ├─ Rate limit check (rl:search, 30 req/min/IP)
  │   └─ 429 si excede
  │
  ├─ supabase.rpc('search_agents', { search_query: 'solidity audit', ... })
  │   └─ tsvector @@ websearch_to_tsquery → ts_rank → TOP 20
  │
  └─ JSON: { agents: [...], total, limit, offset }
```

---

## 8. Definition of Done (DoD)

- [ ] Migration `019_search_vector_agents.sql` aplicada en local y en Supabase remoto
- [ ] Columna `tags text[]` creada en tabla `agents`
- [ ] Columna `search_vector tsvector` creada y poblada (backfill)
- [ ] Índice GIN `idx_agents_search_vector` verificado con `EXPLAIN ANALYZE`
- [ ] Trigger `trg_agents_search_vector` activo — nuevos agentes actualizan automáticamente
- [ ] Función RPC `search_agents()` creada y testeada en Supabase SQL Editor
- [ ] `GET /api/v1/agents?q=` usa tsvector (no ilike) y devuelve resultados rankeados
- [ ] Rate limiting activo en el endpoint con prefijo `rl:search`
- [ ] Hook `useAgentSearch` con debounce 300ms — verificado que no hay fetch por keystroke individual
- [ ] Componente `SearchBar` integrado en `/[locale]/page.tsx` reemplazando `SearchInput`
- [ ] Búsqueda + filtro de categoría combinados funcionan correctamente
- [ ] Empty state visible cuando no hay resultados — sin spinners infinitos
- [ ] RLS verificado: endpoint solo devuelve agentes con `status = 'active'`
- [ ] `EXPLAIN ANALYZE` en búsqueda con query real muestra "Bitmap Index Scan on idx_agents_search_vector"
- [ ] Adversarial Review: sin SQL injection (parámetros siempre via `$1`/RPC), sin bypass de rate limit
- [ ] Tests unitarios de `useAgentSearch` (debounce, minChars, abort controller)
- [ ] Test e2e: buscar → ver resultados → limpiar → ver catálogo completo
- [ ] Filtro de categoría existente sin regresiones — tests existentes pasan

---

## 9. Implementation Readiness Check

| Ítem | ✅ Listo | ❌ Pendiente | Notas |
|------|---------|-------------|-------|
| Stack técnico definido | ✅ | | tsvector + GIN + Supabase |
| Número de migration correcto | ✅ | | `019` (018 ya aplicada) |
| Patrón de rate limiting disponible | ✅ | | `src/lib/ratelimit.ts` con lazy singletons |
| Endpoint base existe | ✅ | | `src/app/api/v1/agents/route.ts` |
| SearchInput base existe | ✅ | | `page.tsx` — a reemplazar por SearchBar |
| `tags` en DB | ❌ | ✅ en migration 019 | No existe aún |
| Columna `search_vector` | ❌ | ✅ en migration 019 | No existe aún |
| `getModels()` service path | ⚠️ | | Dev debe verificar si usa query builder o RPC |
| Upstash credenciales | ✅ | | `TOOLS.md` tiene REST URL y token |
| i18n placeholders | ⚠️ | | Verificar `tc('search')` existe en `/messages/es.json` y `en.json` |
| Preguntas abiertas S0 resueltas | ⚠️ | | Ver sección 10 |

---

## 10. Decisiones tomadas y preguntas resueltas

| Pregunta (S0 §8) | Decisión |
|------------------|----------|
| ¿`tags` ya existe? | No existe — se agrega en migration 019 |
| ¿Búsqueda aplica a todos los Creators? | Sí — solo agentes con `status = 'active'` (RLS) |
| ¿Búsqueda en landing pública o solo autenticado? | Landing pública `/(locale)/page.tsx` — no requiere auth |
| ¿Endpoint público o con API key? | Público para GET con rate limiting; API key opcional para mayor límite (fuera de scope MVP) |

---

## 11. Archivos a crear / modificar

| Acción | Archivo |
|--------|---------|
| CREAR | `supabase/migrations/019_search_vector_agents.sql` |
| CREAR | `src/features/models/hooks/useAgentSearch.ts` |
| CREAR | `src/features/models/components/SearchBar.tsx` |
| MODIFICAR | `src/app/api/v1/agents/route.ts` — rate limit + tsvector |
| MODIFICAR | `src/features/models/services/models.service.ts` — usar textSearch |
| MODIFICAR | `src/app/[locale]/page.tsx` — SearchInput → SearchBar |
| MODIFICAR | `src/lib/ratelimit.ts` — agregar `getSearchLimit()` |

---

*Generado por agente PM San — BMAD Method v6 — 2026-02-27*  
*Pendiente: SPEC_APPROVED explícito de Fer para avanzar a Story (SM)*
