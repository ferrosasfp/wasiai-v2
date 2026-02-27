# Story — HU-4.1: Búsqueda full-text en el catálogo de agentes

**Estado:** READY FOR DEV  
**Epic:** EP-4 — Marketplace Discovery  
**Sprint:** Próximo  
**Estimación:** M (3–5 días)  
**Autor:** SM San — BMAD Method v6  
**Fecha:** 2026-02-27  
**Aprobaciones:** HU_APPROVED ✅ · SPEC_APPROVED ✅

---

> ⚠️ **Este archivo es 100% autocontenido.**  
> El Dev NO necesita leer hu-4.1-s0.md, hu-4.1-sdd.md, ni ningún otro documento.  
> Todo lo necesario para implementar está aquí.

---

## 1. Contexto del sistema (lo que el Dev necesita saber)

| Elemento | Valor |
|----------|-------|
| Stack | Next.js 14 App Router · Supabase · TypeScript strict |
| DB | PostgreSQL (Supabase) — RLS activo en todas las tablas |
| Rate limiting | Upstash Redis · patrón lazy singleton en `src/lib/ratelimit.ts` |
| Deploy | Vercel · auto-deploy en push a `main` |
| Migrations aplicadas | 000–018 (última: `018_free_trial_creator_control.sql`) |
| **Próxima migration** | **019** |
| Endpoint base | `src/app/api/v1/agents/route.ts` — existe, usa `ilike` hoy |
| SearchInput base | `src/app/[locale]/page.tsx` — existe como form GET server component |
| Rate limit util | `src/lib/ratelimit.ts` — lazy singletons para Upstash |
| i18n | next-intl · `/messages/es.json` y `/messages/en.json` |

### Actores relevantes para esta HU
- **Consumer** — busca agentes por texto libre
- **Agente autónomo** — llama `GET /api/v1/agents?q=` sin intervención humana

### Reglas absolutas (nunca violar)
- Sin `any` explícito en TypeScript
- Sin hardcodes de URLs/keys — siempre desde env vars
- Sin datos simulados — métricas siempre reales o en cero
- RLS activo antes de cualquier commit con tablas nuevas
- Rate limiting en todos los endpoints costosos o con cuota
- `git push origin master master:main`

---

## 2. User Stories

### US-4.1.1 — Búsqueda básica (Consumer)
> Como Consumer, quiero escribir palabras clave en una barra de búsqueda y ver agentes relevantes, para encontrar rápidamente el agente que resuelve mi problema sin navegar el catálogo completo.

### US-4.1.2 — Búsqueda combinada con filtro (Consumer)
> Como Consumer, quiero combinar búsqueda por texto con el filtro de categoría existente, para refinar resultados cuando sé la categoría pero busco una función específica.

### US-4.1.3 — Resultado vacío informativo (Consumer)
> Como Consumer, cuando mi búsqueda no devuelve resultados, quiero ver un mensaje claro con sugerencias, para no quedarme con una pantalla vacía.

### US-4.1.4 — Búsqueda vía API (Agente autónomo)
> Como agente autónomo, quiero consultar el catálogo vía `GET /api/v1/agents?q=<query>` y recibir resultados rankeados en JSON, para elegir el agente correcto sin intervención humana.

---

## 3. Criterios de Aceptación (ACs)

### AC-1 — Barra de búsqueda visible en el marketplace
- [ ] Existe un `<input>` de búsqueda en `/[locale]/page.tsx`
- [ ] El input tiene `placeholder="Busca agentes por función, tecnología..."`
- [ ] El input tiene `aria-label="Buscar agentes"` (accesibilidad)

### AC-2 — Búsqueda funcional con PostgreSQL full-text search
- [ ] La búsqueda consulta los campos `name`, `description` y `tags` del agente
- [ ] Se usa `tsvector/tsquery` de PostgreSQL (no `ilike`)
- [ ] La búsqueda es case-insensitive (configuración `'simple'`)
- [ ] Los resultados están rankeados por relevancia (`ts_rank`)
- [ ] Queries de menos de 2 caracteres no disparan búsqueda

### AC-3 — Debounce en el frontend
- [ ] La búsqueda se dispara con debounce de ≥300ms
- [ ] No se realiza ningún fetch por cada keystroke individual

### AC-4 — Compatibilidad con filtro de categoría
- [ ] Se puede aplicar búsqueda + filtro de categoría simultáneamente
- [ ] Limpiar la búsqueda restaura el catálogo al estado del filtro activo

### AC-5 — Estado vacío
- [ ] Si no hay resultados, se muestra un componente de empty state con mensaje claro
- [ ] Sin spinners infinitos ni pantalla en blanco

### AC-6 — Performance con índice GIN
- [ ] Existe índice GIN sobre `search_vector` en la tabla `agents`
- [ ] `EXPLAIN ANALYZE` confirma "Bitmap Index Scan on idx_agents_search_vector"
- [ ] La búsqueda responde en ≤500ms en condiciones normales

### AC-7 — Endpoint para agentes autónomos
- [ ] `GET /api/v1/agents?q=<query>` devuelve resultados rankeados en JSON
- [ ] El endpoint tiene rate limiting vía Upstash Redis (30 req/min/IP cuando `?q=` presente)
- [ ] Solo devuelve agentes con `status = 'active'` (RLS activo)
- [ ] No expone datos sensibles (solo campos públicos)

### AC-8 — Sin regresiones
- [ ] El filtro de categoría existente sigue funcionando sin cambios de comportamiento
- [ ] Los tests e2e del marketplace pasan en verde

---

## 4. Implementación — Instrucciones exactas

### 4.1 Migration SQL — `019_search_vector_agents.sql`

**Crear el archivo:** `supabase/migrations/019_search_vector_agents.sql`

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

-- 6. Trigger en INSERT y UPDATE de columnas relevantes
DROP TRIGGER IF EXISTS trg_agents_search_vector ON agents;
CREATE TRIGGER trg_agents_search_vector
  BEFORE INSERT OR UPDATE OF name, description, tags
  ON agents
  FOR EACH ROW
  EXECUTE FUNCTION agents_search_vector_update();

-- 7. Backfill: poblar search_vector en todos los agentes existentes
UPDATE agents SET
  search_vector =
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(array_to_string(tags, ' '), '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'C');

-- 8. Función RPC para búsqueda rankeada (usada por el endpoint API)
CREATE OR REPLACE FUNCTION search_agents(
  search_query     text,
  filter_category  text    DEFAULT NULL,
  filter_agent_type text   DEFAULT NULL,
  result_limit     int     DEFAULT 20,
  result_offset    int     DEFAULT 0
)
RETURNS TABLE (
  id               uuid,
  slug             text,
  name             text,
  description      text,
  category         text,
  agent_type       text,
  price_per_call   numeric,
  is_featured      boolean,
  total_calls      bigint,
  rank             float4
) LANGUAGE sql STABLE AS $$
  SELECT
    a.id,
    a.slug,
    a.name,
    a.description,
    a.category,
    a.agent_type,
    a.price_per_call,
    a.is_featured,
    a.total_calls,
    ts_rank(a.search_vector, websearch_to_tsquery('simple', search_query)) AS rank
  FROM agents a
  WHERE
    a.status = 'active'
    AND a.search_vector @@ websearch_to_tsquery('simple', search_query)
    AND (filter_category   IS NULL OR a.category   = filter_category)
    AND (filter_agent_type IS NULL OR a.agent_type = filter_agent_type)
  ORDER BY rank DESC, a.is_featured DESC, a.total_calls DESC
  LIMIT  result_limit
  OFFSET result_offset;
$$;

-- RLS: la función hereda las políticas RLS de la tabla agents
GRANT EXECUTE ON FUNCTION search_agents TO authenticated, anon;

-- Nota: se usa 'simple' (idioma-agnóstico) para MVP.
-- Evaluar 'spanish' o 'english' si el catálogo crece y los resultados son irrelevantes.
```

**Aplicar en local:**
```bash
supabase db push
# o
supabase migration up
```

**Verificar:**
```sql
-- Debe mostrar "Bitmap Index Scan on idx_agents_search_vector"
EXPLAIN ANALYZE
SELECT * FROM search_agents('solidity audit');
```

---

### 4.2 Rate limiting — `src/lib/ratelimit.ts`

Agregar la función `getSearchLimit()` al archivo existente:

```typescript
// Agregar al final del archivo src/lib/ratelimit.ts

let _search: Ratelimit | null = null

/**
 * Rate limiter para búsquedas: 30 req/min por IP
 * Solo se activa cuando el endpoint recibe ?q=
 * Prefix: 'rl:search'
 */
export function getSearchLimit(): Ratelimit {
  return _search ??= new Ratelimit({
    redis: makeRedis(), // usar la función helper existente en el archivo
    limiter: Ratelimit.slidingWindow(30, '1 m'),
    prefix: 'rl:search',
  })
}
```

> **Nota:** Si `makeRedis()` no existe como helper, crear una instancia `new Redis({ url, token })` con las mismas env vars que el resto del archivo. Seguir el patrón lazy singleton ya establecido en `ratelimit.ts`.

---

### 4.3 Endpoint `GET /api/v1/agents` — `src/app/api/v1/agents/route.ts`

**Modificar el handler GET existente.** Los cambios son:

1. Importar `getSearchLimit` y la función de obtener identifier
2. Aplicar rate limit cuando `?q=` está presente
3. Cuando hay query `q`, delegar a RPC `search_agents()` en vez de `ilike`

```typescript
// Al inicio del archivo — agregar imports:
import { getSearchLimit } from '@/lib/ratelimit'

// En el handler GET, ANTES de cualquier query a Supabase:
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const q          = searchParams.get('q')?.trim() ?? ''
  const category   = searchParams.get('category') ?? undefined
  const agentType  = searchParams.get('agent_type') ?? undefined
  const limit      = Math.min(parseInt(searchParams.get('limit') ?? '20'), 50)
  const offset     = parseInt(searchParams.get('offset') ?? '0')

  // ── Rate limit solo cuando hay búsqueda ──────────────────────────
  if (q.length > 0) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
              ?? request.headers.get('x-real-ip')
              ?? 'anonymous'
    const { success } = await getSearchLimit().limit(ip)
    if (!success) {
      return NextResponse.json(
        { error: 'Demasiadas búsquedas. Intenta en un momento.' },
        { status: 429 }
      )
    }
  }

  const supabase = await createServerClient()

  // ── Búsqueda con tsvector (si q presente y ≥2 chars) ─────────────
  if (q.length >= 2) {
    const { data, error } = await supabase.rpc('search_agents', {
      search_query:      q,
      filter_category:   category   ?? null,
      filter_agent_type: agentType  ?? null,
      result_limit:      limit,
      result_offset:     offset,
    })

    if (error) {
      console.error('[search_agents RPC]', error)
      return NextResponse.json({ error: 'Error en búsqueda' }, { status: 500 })
    }

    return NextResponse.json({
      agents: data ?? [],
      total:  data?.length ?? 0,
      limit,
      offset,
      query:  q,
    })
  }

  // ── Listado normal (sin búsqueda) — mantener lógica existente ────
  // ... (resto del handler sin cambios)
}
```

> **Eliminar el bloque `ilike` antiguo:**
> Buscar en el archivo la línea que diga algo como:
> ```typescript
> if (q) query = query.or(`name.ilike.%${q}%,description.ilike.%${q}%`)
> ```
> y reemplazarla completamente por la lógica RPC de arriba.

---

### 4.4 Hook `useAgentSearch` — nuevo archivo

**Crear:** `src/features/models/hooks/useAgentSearch.ts`

```typescript
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface AgentSearchResult {
  id:            string
  slug:          string
  name:          string
  description:   string
  category:      string
  agent_type:    string
  price_per_call: number
  is_featured:   boolean
  total_calls:   number
  rank?:         number
}

interface UseAgentSearchOptions {
  debounceMs?: number   // default: 300
  minChars?:  number    // default: 2
  category?:  string
  agentType?: string
}

interface UseAgentSearchReturn {
  results:   AgentSearchResult[]
  isLoading: boolean
  error:     string | null
  query:     string
  setQuery:  (q: string) => void
  clear:     () => void
}

export function useAgentSearch(
  options: UseAgentSearchOptions = {}
): UseAgentSearchReturn {
  const { debounceMs = 300, minChars = 2, category, agentType } = options

  const [query,     setQueryState] = useState('')
  const [results,   setResults]    = useState<AgentSearchResult[]>([])
  const [isLoading, setIsLoading]  = useState(false)
  const [error,     setError]      = useState<string | null>(null)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const search = useCallback(async (q: string) => {
    if (q.trim().length < minChars) {
      setResults([])
      return
    }

    // Cancelar request anterior si sigue en vuelo
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setIsLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        q:     q.trim(),
        limit: '20',
      })
      if (category)  params.set('category',   category)
      if (agentType) params.set('agent_type', agentType)

      const res = await fetch(`/api/v1/agents?${params.toString()}`, {
        signal: abortRef.current.signal,
      })

      if (!res.ok) {
        if (res.status === 429) {
          throw new Error('Demasiadas búsquedas. Intenta en un momento.')
        }
        throw new Error(`Error ${res.status}`)
      }

      const json = await res.json()
      setResults(json.agents ?? [])
    } catch (err) {
      if ((err as Error).name === 'AbortError') return // cancelación intencional
      setError((err as Error).message)
      setResults([])
    } finally {
      setIsLoading(false)
    }
  }, [minChars, category, agentType])

  const setQuery = useCallback((q: string) => {
    setQueryState(q)

    // Cancelar timer anterior
    if (timerRef.current) clearTimeout(timerRef.current)

    if (q.trim().length < minChars) {
      setResults([])
      setIsLoading(false)
      return
    }

    // Debounce: esperar debounceMs antes de disparar el fetch
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

  // Cleanup al desmontar componente
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

### 4.5 Componente `SearchBar` — nuevo archivo

**Crear:** `src/features/models/components/SearchBar.tsx`

```typescript
'use client'

import { useRef } from 'react'
import { useAgentSearch, type AgentSearchResult } from '../hooks/useAgentSearch'

interface SearchBarProps {
  defaultValue?: string
  category?:     string
  placeholder?:  string
  /**
   * mode='server' → form GET para navegación SSR (mantiene SEO, recarga página)
   * mode='client' → useAgentSearch reactivo (SPA, sin recarga)
   */
  mode?:       'server' | 'client'
  onResults?:  (results: AgentSearchResult[]) => void
}

export function SearchBar({
  defaultValue = '',
  category,
  placeholder  = 'Busca agentes por función, tecnología...',
  mode         = 'server',
  onResults,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { query, setQuery, isLoading, error, clear } = useAgentSearch({ category })

  // ── Modo server: form GET → recarga SSR con SEO ───────────────────
  if (mode === 'server') {
    return (
      <form method="GET" className="flex items-center gap-2">
        {category && (
          <input type="hidden" name="category" value={category} />
        )}
        <div className="relative">
          <input
            ref={inputRef}
            type="search"
            name="search"
            defaultValue={defaultValue}
            placeholder={placeholder}
            aria-label="Buscar agentes"
            className={[
              'w-full rounded-xl border border-gray-200 bg-white',
              'px-4 py-2 pr-10 text-sm',
              'focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100',
              'sm:w-64',
            ].join(' ')}
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

  // ── Modo client: reactivo con debounce ────────────────────────────
  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={e => {
            const val = e.target.value
            setQuery(val)
            // Si el padre quiere los resultados en tiempo real
            // onResults se llamará cuando lleguen (ver useEffect en el padre)
          }}
          placeholder={placeholder}
          aria-label="Buscar agentes"
          className={[
            'w-full rounded-xl border border-gray-200 bg-white',
            'px-4 py-2 pr-10 text-sm',
            'focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100',
            'sm:w-64',
          ].join(' ')}
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
          <span className="text-xs text-gray-400 animate-pulse" aria-live="polite">
            buscando…
          </span>
        )}
      </div>
      {error && (
        <p className="mt-1 text-xs text-red-500" role="alert">{error}</p>
      )}
    </div>
  )
}
```

---

### 4.6 Integración en `src/app/[locale]/page.tsx`

**Objetivo:** Reemplazar el `SearchInput` local (definido inline al final del archivo) por el nuevo `SearchBar` con `mode='server'`.

**Cambios mínimos:**

```typescript
// 1. Agregar import al inicio del archivo:
import { SearchBar } from '@/features/models/components/SearchBar'

// 2. En el JSX, reemplazar <SearchInput ...> por:
<SearchBar
  defaultValue={search}   // search viene de searchParams
  category={category}     // category viene de searchParams
  placeholder={tc('search')}  // o string hardcodeado si la key no existe aún
  mode="server"
/>

// 3. Eliminar la función SearchInput definida localmente
//    (buscar "function SearchInput" al final del archivo y borrar todo el bloque)
```

**Actualizar `getModels()` en `src/features/models/services/models.service.ts`:**

Buscar el bloque que aplica el filtro de búsqueda y cambiar de `ilike` a `textSearch`:

```typescript
// ANTES (buscar algo similar a esto):
if (search) {
  query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`)
}

// DESPUÉS:
if (search && search.trim().length >= 2) {
  // Prefijo :* para match parcial — ej. "solid" matchea "solidity"
  const tsQuery = search.trim().split(/\s+/).map(w => `${w}:*`).join(' & ')
  query = query.textSearch('search_vector', tsQuery, {
    type:   'plain',
    config: 'simple',
  })
}
```

---

### 4.7 i18n — verificar placeholders

Verificar que `/messages/es.json` y `/messages/en.json` tengan la key `search`. Si no existe:

```json
// messages/es.json — agregar en la sección del marketplace:
{
  "search": "Busca agentes por función, tecnología..."
}

// messages/en.json — agregar:
{
  "search": "Search agents by function, technology..."
}
```

---

## 5. Archivos a crear / modificar — resumen

| Acción | Archivo |
|--------|---------|
| **CREAR** | `supabase/migrations/019_search_vector_agents.sql` |
| **CREAR** | `src/features/models/hooks/useAgentSearch.ts` |
| **CREAR** | `src/features/models/components/SearchBar.tsx` |
| **MODIFICAR** | `src/lib/ratelimit.ts` — agregar `getSearchLimit()` |
| **MODIFICAR** | `src/app/api/v1/agents/route.ts` — rate limit + RPC search_agents |
| **MODIFICAR** | `src/features/models/services/models.service.ts` — textSearch en getModels |
| **MODIFICAR** | `src/app/[locale]/page.tsx` — SearchInput → SearchBar |
| **VERIFICAR** | `messages/es.json` y `messages/en.json` — key `search` |

---

## 6. Flujo end-to-end (referencia)

```
[Consumer escribe "solidity audit"]
        │
        ▼
SearchBar (mode=server) → form GET → /[locale]?search=solidity+audit
        │
        ▼
page.tsx (Server Component)
  └─ getModels({ search: "solidity audit" })
       └─ supabase.textSearch('search_vector', 'solidity:* & audit:*', { config: 'simple' })
            └─ PostgreSQL: GIN index lookup → resultados filtrados
        │
        ▼
ModelCard[] con SSR → HTML al cliente

─── Agente autónomo / llamada API ───

GET /api/v1/agents?q=solidity+audit
  ├─ Rate limit check (rl:search · 30 req/min/IP)
  │   └─ 429 si excede
  ├─ supabase.rpc('search_agents', { search_query: 'solidity audit', ... })
  │   └─ tsvector @@ websearch_to_tsquery → ts_rank → TOP 20
  └─ JSON: { agents: [...], total, limit, offset, query }
```

---

## 7. Seguridad — checklist obligatorio

- [ ] **Sin SQL injection:** los parámetros de `search_agents()` son siempre `$1`, `$2`, etc. (PostgreSQL los escapa automáticamente). Nunca concatenar strings en SQL.
- [ ] **Rate limit activo** cuando `?q=` presente (30 req/min/IP)
- [ ] **RLS verificado:** la función `search_agents()` hereda RLS de la tabla `agents` — solo devuelve `status = 'active'`
- [ ] **Sin datos sensibles:** la RPC solo expone id, slug, name, description, category, agent_type, price_per_call, is_featured, total_calls, rank — sin emails, wallets, ni keys
- [ ] **AbortController** en el hook — cancela requests en vuelo para evitar race conditions

---

## 8. Tests requeridos

### Unitarios

**`src/features/models/hooks/__tests__/useAgentSearch.test.ts`**

```
- debounce: no dispara fetch antes de 300ms
- minChars: no dispara fetch con query de 1 char
- minChars: sí dispara fetch con query de 2 chars
- clear: resetea query, results, error y cancela AbortController
- rate limit 429: setError con mensaje amigable
- AbortError: no setea error (es cancelación intencional)
```

### E2E

```
Escenario: búsqueda básica
  1. Ir a /marketplace (o /)
  2. Escribir "solidity" en la barra de búsqueda
  3. Esperar 300ms
  4. Verificar que se muestran agentes relevantes (al menos 1 resultado o empty state)

Escenario: limpiar búsqueda
  1. Buscar "solidity"
  2. Borrar el texto del input
  3. Verificar que se restaura el catálogo completo

Escenario: búsqueda + filtro de categoría
  1. Seleccionar categoría "DeFi"
  2. Buscar "audit"
  3. Verificar que se aplican ambos filtros

Escenario: estado vacío
  1. Buscar "xyzabcdefgh123noresults"
  2. Verificar que se muestra empty state con mensaje — sin spinner infinito

Escenario: regresión categoría
  1. Cambiar categoría sin texto de búsqueda
  2. Verificar que el filtro de categoría funciona igual que antes
```

---

## 9. Definition of Done (DoD)

- [ ] Migration `019_search_vector_agents.sql` aplicada en **local** y en **Supabase remoto**
- [ ] Columna `tags text[]` creada en tabla `agents`
- [ ] Columna `search_vector tsvector` creada y populada con backfill
- [ ] Índice GIN `idx_agents_search_vector` verificado con `EXPLAIN ANALYZE`
- [ ] Trigger `trg_agents_search_vector` activo — nuevos agentes actualizan automáticamente
- [ ] Función RPC `search_agents()` creada y testeada en Supabase SQL Editor
- [ ] `GET /api/v1/agents?q=` usa tsvector (no `ilike`) y devuelve JSON rankeado
- [ ] Rate limiting activo en el endpoint con prefijo `rl:search` (30 req/min/IP)
- [ ] Hook `useAgentSearch` con debounce 300ms implementado y verificado (sin fetch por keystroke)
- [ ] Componente `SearchBar` integrado reemplazando `SearchInput` local
- [ ] Búsqueda + filtro de categoría combinados funcionan
- [ ] Empty state visible cuando no hay resultados — sin spinners infinitos
- [ ] RLS verificado: solo agentes con `status = 'active'` en la respuesta
- [ ] `EXPLAIN ANALYZE` muestra "Bitmap Index Scan on idx_agents_search_vector"
- [ ] Sin SQL injection (params siempre por RPC con `$N`)
- [ ] Sin bypass de rate limit
- [ ] Tests unitarios del hook `useAgentSearch` pasan
- [ ] Test e2e: buscar → resultados → limpiar → catálogo completo
- [ ] Filtro de categoría existente sin regresiones
- [ ] Code Review formal completado
- [ ] Adversarial Review pasada (SSRF, inyección, rate limit bypass)
- [ ] Deploy en Vercel sin degradación de Lighthouse
- [ ] `git push origin master master:main` ✅

---

## 10. Notas de implementación para el Dev

### ¿Usar mode='server' o mode='client' en la página principal?

- **Recomendación:** `mode='server'` para `/[locale]/page.tsx` — mantiene SSR, SEO y el comportamiento actual del `SearchInput`.
- `mode='client'` es para UIs donde no se quiere recargar la página (ej. un panel lateral o modal de búsqueda en el futuro).

### ¿`textSearch` en `getModels()` o solo la RPC?

Hay dos rutas:
1. **`getModels()` con `textSearch`** → usado por Server Components (SSR, SEO)
2. **RPC `search_agents()`** → usado por el endpoint `GET /api/v1/agents` (para agentes autónomos y el hook cliente)

Ambas son necesarias. La migration 019 crea la RPC. `getModels()` usa el query builder de Supabase con `.textSearch()` (que internamente genera la misma query `@@`).

### Sobre `websearch_to_tsquery` vs `to_tsquery` vs `plainto_tsquery`

La RPC usa `websearch_to_tsquery` — acepta input sin procesar del usuario (espacios, comillas, minus) sin romper. Es la opción más segura para input libre.

Para `getModels()` desde el servidor (donde se controla el input), el patrón `word:*` con `plain` también funciona bien.

### Si `makeRedis()` no existe en `ratelimit.ts`

Agregar el helper:
```typescript
import { Redis } from '@upstash/redis'

function makeRedis() {
  return new Redis({
    url:   process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
}
```

O simplemente reutilizar la misma instancia Redis del limiter existente en el archivo.

---

*Story generado por agente SM San — BMAD Method v6 — 2026-02-27*  
*Basado en: hu-4.1-s0.md (HU_APPROVED) + hu-4.1-sdd.md (SPEC_APPROVED)*  
*El Dev no necesita leer ningún documento adicional.*
