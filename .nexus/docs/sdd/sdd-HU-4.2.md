# SDD — HU-4.2: Filtros avanzados en marketplace (tipo agente, precio max, categoría)

**Estado:** SPEC_PENDING  
**Sprint:** 7 | **Épica:** Epic 4 — Discovery y Calidad del Catálogo  
**Prioridad:** P2 | **Estimación:** M  
**Generado por:** Architect (BMAD Method v6) · 2026-02-27

---

## 1. Análisis del codebase actual

### getModels service (models.service.ts)

El service actual **solo soporta `category` y `search`**. Falta `agent_type` y `max_price`.

**Importante:** El service consulta Supabase directamente (no llama `/api/v1/agents`). La API pública `/api/v1/agents` acepta esos params, pero el server component de home usa el service de Supabase, no la API.

→ **Los filtros `agent_type` y `max_price` se agregan directamente al service de Supabase**, no como proxy a la API.

### CategoryFilter.tsx (existente)

```typescript
// Ubicación: src/features/models/components/CategoryFilter.tsx
// Es 'use client', usa router.push con searchParams
// Patrón: modifica params y llama router.push(`${pathname}?${params.toString()}`)
```

### page.tsx (existente)

Solo lee `category`, `search`, y `page` de `searchParams`. Falta leer `agent_type` y `max_price`.

---

## 2. Schema de DB / Endpoints / On-chain

**Ninguno.** Solo UI + service Supabase. Sin cambios de API routes.

### Verificación de columna `agent_type` en DB

La columna `agent_type` existe en la tabla `agents` (visible en `ModelCard.tsx` que accede a `model.agent_type`). ✅

La columna `price_per_call` existe (usada en múltiples lugares). ✅

---

## 3. Cambios en archivos

### 3.1 models.service.ts — MODIFICAR

**Path:** `src/features/models/services/models.service.ts`

Agregar parámetros `agent_type` y `max_price` a `getModels`:

```typescript
// Tipos nuevos
export type AgentType = 'llm' | 'rag' | 'tool' | 'multimodal' | 'code'

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
  agent_type?: AgentType | string  // string para flexibilidad
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
  if (agent_type) query = query.eq('agent_type', agent_type)     // ← NUEVO
  if (max_price !== undefined && !isNaN(max_price)) {
    query = query.lte('price_per_call', max_price)               // ← NUEVO
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

### 3.2 FilterPanel — NUEVO (componente central de filtros)

**Path:** `src/features/models/components/FilterPanel.tsx`

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
```

**Props:** Sin props externas (lee directamente de `useSearchParams`)

**Estado interno:**
```typescript
const router = useRouter()
const pathname = usePathname()
const searchParams = useSearchParams()

const currentCategory  = searchParams.get('category')  ?? 'all'
const currentAgentType = searchParams.get('agent_type') ?? ''
const currentMaxPrice  = searchParams.get('max_price')  ?? ''
```

**Función central de actualización de params:**
```typescript
function updateFilters(updates: Record<string, string | null>) {
  const params = new URLSearchParams(searchParams.toString())
  
  // Limpiar page al cambiar filtros
  params.delete('page')
  
  Object.entries(updates).forEach(([key, value]) => {
    if (value === null || value === '' || value === 'all') {
      params.delete(key)
    } else {
      params.set(key, value)
    }
  })
  
  router.push(`${pathname}?${params.toString()}`)
}
```

**Lógica "Limpiar filtros":**
```typescript
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
  // Mantener 'search' si existe
  router.push(`${pathname}?${params.toString()}`)
}
```

**JSX completo:**
```tsx
export function FilterPanel() {
  const t = useTranslations('filters')
  // ... (estado arriba)

  return (
    <div className="space-y-4">
      {/* Row principal de filtros */}
      <div className="flex flex-wrap items-center gap-3">
        
        {/* Filtro Categoría — chips */}
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => updateFilters({ category: cat.value === 'all' ? null : cat.value })}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                currentCategory === cat.value || (cat.value === 'all' && currentCategory === 'all')
                  ? 'bg-avax-500 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <span>{cat.icon}</span>
              {cat.label}
            </button>
          ))}
        </div>

        {/* Separador vertical */}
        <div className="hidden sm:block h-6 w-px bg-gray-200" />

        {/* Filtro Tipo de Agente — chips */}
        <div className="flex flex-wrap gap-2">
          {AGENT_TYPES.map((type) => (
            <button
              key={type.value}
              onClick={() => updateFilters({ agent_type: currentAgentType === type.value ? null : type.value })}
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

        {/* Separador vertical */}
        <div className="hidden sm:block h-6 w-px bg-gray-200" />

        {/* Filtro Precio máximo — input number */}
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

        {/* Botón "Limpiar filtros" — visible solo si hay filtros activos */}
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

### 3.3 CategoryFilter.tsx — DEPRECAR / INTEGRAR

`CategoryFilter.tsx` queda absorbido por `FilterPanel`. 

**Opción A (recomendada):** Mantener `CategoryFilter.tsx` pero vaciar su contenido y re-exportar desde `FilterPanel`:
```typescript
// CategoryFilter.tsx — redirect a FilterPanel
export { FilterPanel as CategoryFilter } from './FilterPanel'
```

**Opción B:** Eliminar `CategoryFilter.tsx` y actualizar imports en `page.tsx`.

**Recomendación:** Opción B — eliminar y actualizar `page.tsx` directamente. Más limpio.

---

### 3.4 page.tsx — MODIFICAR

**Path:** `src/app/[locale]/page.tsx`

**Cambio 1: searchParams**
```typescript
// ANTES:
const { category, search, page: pageStr } = await searchParams

// DESPUÉS:
const { category, search, page: pageStr, agent_type, max_price } = await searchParams
```

**Cambio 2: parseo de max_price**
```typescript
const maxPriceParsed = max_price ? parseFloat(max_price) : undefined
// Validar que no sea NaN
const maxPriceValue = (maxPriceParsed !== undefined && !isNaN(maxPriceParsed))
  ? maxPriceParsed
  : undefined
```

**Cambio 3: llamada a getModels**
```typescript
const { models, total } = await getModels({
  category: category as ModelCategory | undefined,
  search,
  agent_type,           // ← NUEVO
  max_price: maxPriceValue,  // ← NUEVO
  limit: PAGE_SIZE,
  offset,
})
```

**Cambio 4: pageHref incluye nuevos params**
```typescript
function pageHref(p: number) {
  const q = new URLSearchParams()
  if (category)   q.set('category', category)
  if (search)     q.set('search', search)
  if (agent_type) q.set('agent_type', agent_type)         // ← NUEVO
  if (max_price)  q.set('max_price', max_price)           // ← NUEVO
  if (p > 1)      q.set('page', String(p))
  const qs = q.toString()
  return `/${locale}${qs ? `?${qs}` : ''}`
}
```

**Cambio 5: reemplazar `<CategoryFilter />` por `<FilterPanel />`**
```tsx
// ANTES:
import { CategoryFilter } from '@/features/models/components/CategoryFilter'
// ...
<CategoryFilter />

// DESPUÉS:
import { FilterPanel } from '@/features/models/components/FilterPanel'
// ...
<FilterPanel />
```

---

## 4. i18n — Claves nuevas

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

## 5. Flujo completo

```
Usuario en marketplace
  ↓
Selecciona categoría "Vision" → updateFilters({ category: 'vision' })
  ↓
router.push('/{locale}?category=vision')
  ↓
page.tsx: getModels({ category: 'vision' }) → grid filtrado ✓

Usuario además selecciona tipo "RAG"
  ↓
updateFilters({ agent_type: 'rag' })
  → params: category=vision&agent_type=rag
  ↓
page.tsx: getModels({ category: 'vision', agent_type: 'rag' }) → grid combinado ✓

Usuario además escribe "0.05" en max_price
  ↓
updateFilters({ max_price: '0.05' })
  → params: category=vision&agent_type=rag&max_price=0.05
  ↓
page.tsx: getModels({ ..., max_price: 0.05 }) → query Supabase: .lte('price_per_call', 0.05)
  ↓
Botón "Limpiar filtros" visible ✓

URL back/forward funciona: browser navega entre estados de filtros ✓
```

---

## 6. Definition of Done

- [ ] `FilterPanel.tsx` creado en `src/features/models/components/`
- [ ] `CategoryFilter.tsx` eliminado o re-exportado desde FilterPanel
- [ ] `models.service.ts` acepta `agent_type` y `max_price` con filtros Supabase correctos
- [ ] `page.tsx` lee `agent_type` y `max_price` de searchParams y los pasa a getModels
- [ ] `pageHref` incluye `agent_type` y `max_price` en paginación
- [ ] Filtros acumulables: categoría + tipo + precio funcionan juntos ✓
- [ ] URL refleja filtros activos como query params ✓
- [ ] Botón "Limpiar filtros" visible solo cuando hay filtros activos ✓
- [ ] Limpiar filtros preserva el término de búsqueda (search) ✓
- [ ] Sin full page reload (router.push = shallow nav) ✓
- [ ] Traducciones en `en.json` y `es.json` con `filters.*` ✓
- [ ] `npm run build` sin errores TypeScript ✓
- [ ] Sin warnings ESLint ✓
- [ ] `git push origin master master:main`

---

## 7. Implementation Readiness Check

| Item | Estado |
|------|--------|
| Columna `agent_type` en tabla `agents` | ✅ Visible en ModelCard y tipos |
| Columna `price_per_call` en tabla `agents` | ✅ Ampliamente usada |
| Supabase `.lte()` filter disponible | ✅ Parte del query builder |
| CategoryFilter patrón router.push | ✅ Copiado y centralizado en FilterPanel |
| page.tsx es Server Component async | ✅ Puede leer searchParams directamente |
| Sin cambios en API routes | ✅ Confirmado |
| Riesgo hydration mismatch (input number) | ✅ Mitigado con `<input type="number">` (SSR compatible) |
| ISR cache compatible con nuevos params | ✅ Cada combinación de params es una ruta distinta cacheada |

**Veredicto: IMPLEMENTABLE sin ambigüedades.** ~1 día de dev. La adición de filtros a Supabase es directa con el query builder existente.

---

*Generado por Architect (BMAD v6) · Sprint 7 · 2026-02-27*
