# Story HU-4.2: Filtros avanzados en marketplace (tipo agente, precio máx, categoría)

**Status:** ready-for-dev  
**Sprint:** 7 | **Épica:** Epic 4 — Discovery y Calidad del Catálogo  
**Prioridad:** P2 | **Estimación:** M (~1 día)  
**Dependencias:** Ninguna (API ya lista)

---

## Historia de usuario

Como usuario explorando el marketplace, quiero poder filtrar agentes por tipo (LLM, RAG, tool, etc.), precio máximo y categoría combinados, para encontrar exactamente el agente que necesito sin revisar todo el catálogo.

---

## Acceptance Criteria

1. El marketplace muestra un **panel/row de filtros** con: selector de categoría, selector de tipo de agente (`agent_type`), e input de precio máximo (`max_price` en USDC).
2. Los filtros son **acumulables** — categoría + tipo + precio máximo funcionan juntos en la misma query.
3. La **URL refleja los filtros activos** como query params: `?category=X&agent_type=Y&max_price=Z` — compatible con back/forward del browser.
4. Cuando hay filtros activos, se muestra un botón **"Limpiar filtros"** visible. Limpiar filtros preserva el término de búsqueda (`search`).
5. Los **tipos de agente** disponibles: `llm`, `rag`, `tool`, `multimodal`, `code` — mostrados como chips.
6. El **filtro de precio máximo** acepta valores entre `0` y `10` USDC con pasos de `0.10` (input number).
7. Los filtros **no causan full page reload** — usan `router.push` (Next.js shallow navigation).
8. Los filtros tienen **traducciones en es/en**.
9. **Zero cambios de backend** — la query de Supabase se actualiza en el service, la API route pública NO se toca.

---

## Contexto crítico — el service usa Supabase directamente

**Importante:** `page.tsx` (Server Component) llama a `getModels()` del service que hace query a Supabase directamente. **No llama a la API pública `/api/v1/agents`**. Los filtros `agent_type` y `max_price` se agregan al service de Supabase, no como proxy a la API.

El filtro de `category` ya existe en `CategoryFilter.tsx` con patrón `router.push`. Este componente queda **absorbido por `FilterPanel`**.

---

## Estructura de archivos

### Archivos a CREAR:

| Archivo | Descripción |
|---------|-------------|
| `src/features/models/components/FilterPanel.tsx` | Componente central con todos los filtros integrados |

### Archivos a MODIFICAR:

| Archivo | Cambio |
|---------|--------|
| `src/features/models/services/models.service.ts` | Agregar `agent_type` y `max_price` a `getModels` |
| `src/app/[locale]/page.tsx` | Leer nuevos searchParams; pasar a getModels; reemplazar `CategoryFilter` por `FilterPanel`; actualizar `pageHref` |
| `src/messages/en.json` | Agregar objeto `"filters"` con claves i18n |
| `src/messages/es.json` | Agregar objeto `"filters"` con claves i18n |

### Archivos a ELIMINAR:

| Archivo | Acción |
|---------|--------|
| `src/features/models/components/CategoryFilter.tsx` | Eliminar (absorbido por FilterPanel) — o re-exportar si hay otros imports |

### Archivos NO tocar:
- `src/app/api/v1/agents/route.ts` — sin cambios de backend
- DB, contratos — sin cambios

---

## Código de referencia — Implementación exacta

### `models.service.ts` — Agregar filtros a `getModels`

```typescript
// Tipo nuevo para agent_type:
export type AgentType = 'llm' | 'rag' | 'tool' | 'multimodal' | 'code'

// Actualizar la función getModels — agregar parámetros:
export async function getModels({
  category,
  search,
  agent_type,    // ← NUEVO
  max_price,     // ← NUEVO
  limit = 12,
  offset = 0,
}: {
  category?: ModelCategory
  search?: string
  agent_type?: AgentType | string
  max_price?: number
  limit?: number
  offset?: number
} = {}): Promise<{ models: Model[]; total: number }> {
  const supabase = await createClient()
  let query = supabase
    .from('agents')
    .select('*, creator:creator_profiles(id, username, display_name, avatar_url, verified)', { count: 'exact' })
    .eq('status', 'active')
    .order('is_featured', { ascending: false })
    .order('total_calls', { ascending: false })
    .range(offset, offset + limit - 1)

  if (category)   query = query.eq('category', category)
  if (agent_type) query = query.eq('agent_type', agent_type)         // ← NUEVO
  if (max_price !== undefined && !isNaN(max_price)) {
    query = query.lte('price_per_call', max_price)                   // ← NUEVO
  }
  if (search) {
    query = query.textSearch('search_vector', search, { type: 'websearch' })
  }

  const { data, error, count } = await query
  if (error) throw error
  return { models: (data as Model[]) ?? [], total: count ?? 0 }
}
```

---

### `FilterPanel.tsx` — CREAR

```typescript
'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'

const AGENT_TYPES = [
  { value: 'llm',        label: 'LLM',        icon: '🧠' },
  { value: 'rag',        label: 'RAG',         icon: '📚' },
  { value: 'tool',       label: 'Tool',        icon: '🔧' },
  { value: 'multimodal', label: 'Multimodal',  icon: '🎭' },
  { value: 'code',       label: 'Code',        icon: '💻' },
]

const CATEGORIES = [
  { value: 'all',        label: 'All',         icon: '✨' },
  { value: 'nlp',        label: 'NLP',         icon: '💬' },
  { value: 'vision',     label: 'Vision',      icon: '👁' },
  { value: 'audio',      label: 'Audio',       icon: '🎵' },
  { value: 'code',       label: 'Code',        icon: '💻' },
  { value: 'multimodal', label: 'Multimodal',  icon: '🤖' },
  { value: 'data',       label: 'Data',        icon: '📊' },
]

export function FilterPanel() {
  const t = useTranslations('filters')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const currentCategory  = searchParams.get('category')  ?? 'all'
  const currentAgentType = searchParams.get('agent_type') ?? ''
  const currentMaxPrice  = searchParams.get('max_price')  ?? ''

  // Función central: actualizar uno o más params y hacer push
  function updateFilters(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('page') // reset paginación al cambiar filtros

    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '' || value === 'all') {
        params.delete(key)
      } else {
        params.set(key, value)
      }
    })

    router.push(`${pathname}?${params.toString()}`)
  }

  const hasActiveFilters = (
    currentCategory !== 'all' ||
    currentAgentType !== '' ||
    currentMaxPrice !== ''
  )

  function clearAll() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('category')
    params.delete('agent_type')
    params.delete('max_price')
    params.delete('page')
    // Mantener 'search' si existe — limpiar filtros NO limpia la búsqueda
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">

        {/* Chips de Categoría */}
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => updateFilters({ category: cat.value === 'all' ? null : cat.value })}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                (cat.value === 'all' && currentCategory === 'all') ||
                currentCategory === cat.value
                  ? 'bg-avax-500 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <span>{cat.icon}</span>
              {cat.label}
            </button>
          ))}
        </div>

        {/* Separador */}
        <div className="hidden sm:block h-6 w-px bg-gray-200" />

        {/* Chips de Tipo de Agente */}
        <div className="flex flex-wrap gap-2">
          {AGENT_TYPES.map((type) => (
            <button
              key={type.value}
              onClick={() => updateFilters({
                agent_type: currentAgentType === type.value ? null : type.value
              })}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                currentAgentType === type.value
                  ? 'bg-violet-500 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <span>{type.icon}</span>
              {type.label}
            </button>
          ))}
        </div>

        {/* Separador */}
        <div className="hidden sm:block h-6 w-px bg-gray-200" />

        {/* Input Precio Máximo */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500 shrink-0">
            {t('maxPrice')}
          </label>
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-400">$</span>
            <input
              type="number"
              min="0"
              max="10"
              step="0.10"
              value={currentMaxPrice}
              onChange={(e) => updateFilters({ max_price: e.target.value || null })}
              placeholder="10.00"
              className="w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:border-avax-400 focus:outline-none"
            />
            <span className="text-xs text-gray-400">USDC</span>
          </div>
        </div>

        {/* Botón Limpiar filtros — solo visible cuando hay filtros activos */}
        {hasActiveFilters && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 transition"
          >
            ✕ {t('clearFilters')}
          </button>
        )}
      </div>
    </div>
  )
}
```

---

### `page.tsx` — Cambios a realizar

**Cambio 1: Import**
```typescript
// ANTES:
import { CategoryFilter } from '@/features/models/components/CategoryFilter'

// DESPUÉS:
import { FilterPanel } from '@/features/models/components/FilterPanel'
```

**Cambio 2: Leer nuevos searchParams**
```typescript
// ANTES:
const { category, search, page: pageStr } = await searchParams

// DESPUÉS:
const { category, search, page: pageStr, agent_type, max_price } = await searchParams

// Parsear max_price de forma segura:
const maxPriceParsed = max_price ? parseFloat(max_price) : undefined
const maxPriceValue = (maxPriceParsed !== undefined && !isNaN(maxPriceParsed))
  ? maxPriceParsed
  : undefined
```

**Cambio 3: Pasar nuevos params a getModels**
```typescript
// ANTES:
const { models, total } = await getModels({
  category: category as ModelCategory | undefined,
  search,
  limit: PAGE_SIZE,
  offset,
})

// DESPUÉS:
const { models, total } = await getModels({
  category: category as ModelCategory | undefined,
  search,
  agent_type,
  max_price: maxPriceValue,
  limit: PAGE_SIZE,
  offset,
})
```

**Cambio 4: Actualizar `pageHref` para preservar nuevos filtros**
```typescript
function pageHref(p: number) {
  const q = new URLSearchParams()
  if (category)   q.set('category', category)
  if (search)     q.set('search', search)
  if (agent_type) q.set('agent_type', agent_type)    // ← NUEVO
  if (max_price)  q.set('max_price', max_price)      // ← NUEVO
  if (p > 1)      q.set('page', String(p))
  const qs = q.toString()
  return `/${locale}${qs ? `?${qs}` : ''}`
}
```

**Cambio 5: Reemplazar componente en JSX**
```tsx
// ANTES:
<CategoryFilter />

// DESPUÉS:
<FilterPanel />
```

---

## `CategoryFilter.tsx` — Eliminar o re-exportar

**Opción recomendada: Eliminar el archivo** y actualizar cualquier import en `page.tsx` (ya cubierto en Cambio 5 arriba).

Si hay otros archivos que importan `CategoryFilter`, re-exportar desde `FilterPanel`:
```typescript
// CategoryFilter.tsx — si hay otros imports externos
export { FilterPanel as CategoryFilter } from './FilterPanel'
```

Buscar otros usos con: `grep -r "CategoryFilter" src/`

---

## Claves i18n

### `src/messages/en.json` — agregar objeto `"filters"`:
```json
"filters": {
  "category": "Category",
  "agentType": "Agent Type",
  "maxPrice": "Max Price",
  "clearFilters": "Clear filters",
  "all": "All",
  "types": {
    "llm": "LLM",
    "rag": "RAG",
    "tool": "Tool",
    "multimodal": "Multimodal",
    "code": "Code"
  }
}
```

### `src/messages/es.json` — agregar objeto `"filters"`:
```json
"filters": {
  "category": "Categoría",
  "agentType": "Tipo de Agente",
  "maxPrice": "Precio máx",
  "clearFilters": "Limpiar filtros",
  "all": "Todos",
  "types": {
    "llm": "LLM",
    "rag": "RAG",
    "tool": "Herramienta",
    "multimodal": "Multimodal",
    "code": "Código"
  }
}
```

---

## Notas de implementación

### Supabase `.lte()` para precio máximo
```typescript
// Supabase query builder — lte = less than or equal
query = query.lte('price_per_call', max_price)
```
La columna `price_per_call` existe en la tabla `agents` (confirmado en código existente).

### `agent_type` — columna existente en DB
La columna `agent_type` existe en la tabla `agents` (visible en `ModelCard.tsx` que accede a `model.agent_type`). El filtro `.eq('agent_type', agent_type)` funciona directamente.

### Toggle de tipo de agente (chip como toggle)
```typescript
// Click en chip activo → deseleccionar (null = eliminar param)
// Click en chip inactivo → seleccionar
updateFilters({ agent_type: currentAgentType === type.value ? null : type.value })
```

### Limpiar filtros preserva `search`
El botón "Limpiar filtros" elimina `category`, `agent_type`, `max_price` pero **NO `search`**. El usuario puede seguir buscando con texto mientras quita filtros adicionales.

### ISR cache compatible
Cada combinación única de query params genera una entrada separada en el cache de Next.js ISR. No hay riesgo de contaminación entre estados de filtros.

---

## Flujo completo

```
Usuario en marketplace sin filtros
  ↓
Click categoría "Vision" → updateFilters({ category: 'vision' })
  → URL: ?category=vision
  → page.tsx: getModels({ category: 'vision' }) → grid filtrado ✓

Además selecciona tipo "RAG"
  ↓
updateFilters({ agent_type: 'rag' })
  → URL: ?category=vision&agent_type=rag
  → getModels({ category: 'vision', agent_type: 'rag' }) ✓

Además escribe "0.05" en precio máximo
  ↓
onChange → updateFilters({ max_price: '0.05' })
  → URL: ?category=vision&agent_type=rag&max_price=0.05
  → getModels({ ..., max_price: 0.05 }) → query: .lte('price_per_call', 0.05) ✓
  → Botón "Limpiar filtros" aparece ✓

Click "Limpiar filtros"
  ↓
clearAll() → elimina category, agent_type, max_price → preserva search si existe
  → URL: ? (limpia) o ?search=X
  → Botón "Limpiar filtros" desaparece ✓

Browser back/forward
  ↓
URL cambia → Next.js re-renderiza page.tsx con los params anteriores ✓
```

---

## DoD — Definition of Done

- [ ] `FilterPanel.tsx` creado en `src/features/models/components/`
- [ ] `CategoryFilter.tsx` eliminado o re-exportado desde FilterPanel
- [ ] `models.service.ts` acepta `agent_type` y `max_price` con filtros Supabase
- [ ] `page.tsx` lee `agent_type` y `max_price` de searchParams y los pasa a getModels
- [ ] `pageHref` incluye `agent_type` y `max_price` para paginación correcta
- [ ] Filtros acumulables: categoría + tipo + precio funcionan juntos ✓
- [ ] URL refleja filtros activos como query params ✓
- [ ] Botón "Limpiar filtros" visible solo cuando hay filtros activos ✓
- [ ] Limpiar filtros preserva el término de búsqueda (`search`) ✓
- [ ] Sin full page reload (`router.push`) ✓
- [ ] Traducciones `filters.*` en `en.json` y `es.json` ✓
- [ ] `npm run build` sin errores TypeScript ✓
- [ ] Sin warnings ESLint ✓
- [ ] `git push origin master master:main`

---

## Dev Agent Record

### Agent Model Used
_(completar al implementar)_

### Completion Notes List
_(completar al implementar)_

### File List
- `src/features/models/components/FilterPanel.tsx` — NUEVO
- `src/features/models/components/CategoryFilter.tsx` — ELIMINADO o re-exportado
- `src/features/models/services/models.service.ts` — MODIFICADO
- `src/app/[locale]/page.tsx` — MODIFICADO
- `src/messages/en.json` — MODIFICADO
- `src/messages/es.json` — MODIFICADO
