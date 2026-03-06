# Story HU-9.1: Empty state cuando búsqueda retorna 0 resultados

**Status:** ready-for-dev  
**Sprint:** 7 | **Épica:** Epic 9 — UX Improvements  
**Prioridad:** P2 | **Estimación:** S (~4 horas)  
**Dependencias:** Ninguna

---

## Historia de usuario

Como usuario buscando agentes, cuando mi búsqueda no encuentra resultados, quiero ver una pantalla amigable con sugerencias de agentes populares, para no quedarme con una página vacía y poder descubrir agentes relevantes.

---

## Acceptance Criteria

1. Cuando `models.length === 0` **y hay un término de búsqueda activo** (`search` query param presente), se muestra el componente `EmptySearchState` en lugar del grid vacío.
2. El `EmptySearchState` muestra: **icono** + **mensaje** `"No encontramos agentes para '{search}'"` + sugerencia de limpiar filtros.
3. El empty state incluye hasta **4 agentes sugeridos** (más populares/llamados) cargados desde el mismo endpoint con `limit=4` sin filtros.
4. Hay un botón **"Ver todos los agentes"** que limpia la búsqueda y vuelve al marketplace completo.
5. Si hay **filtro de categoría activo también**, el mensaje sugiere adicionalmente quitar el filtro de categoría.
6. El componente tiene **traducciones en es/en**.
7. Si la búsqueda sin resultados también tiene sugeridos vacíos (DB vacía) → mostrar empty state **sin sección de sugeridos** (sin crash).
8. Si NO hay `search` activo (marketplace vacío sin búsqueda) → mantener el **comportamiento original** (no usar `EmptySearchState`).

---

## Contexto del codebase actual

`page.tsx` ya tiene un empty state básico:
```tsx
{models.length === 0 ? (
  <div className="rounded-2xl border-2 border-dashed ...">
    <p className="text-4xl mb-4">🔍</p>
    <p>{search || category ? t('noModelsFiltered') : t('noModels')}</p>
    ...
  </div>
) : (
  <div className="grid ...">...</div>
)}
```

**Esta HU reemplaza ese bloque SOLO para el caso `search !== undefined && models.length === 0`.** El caso "marketplace vacío sin búsqueda" mantiene el comportamiento actual.

---

## Estructura de archivos

### Archivos a CREAR:

| Archivo | Descripción |
|---------|-------------|
| `src/features/models/components/EmptySearchState.tsx` | Componente Server Component con icono, mensaje, sugerencias, CTA |

### Archivos a MODIFICAR:

| Archivo | Cambio |
|---------|--------|
| `src/app/[locale]/page.tsx` | Importar `EmptySearchState`; segunda llamada a `getModels` condicional; reemplazar bloque de empty state para el caso de búsqueda |
| `src/messages/en.json` | Agregar objeto `"emptySearch"` con claves i18n |
| `src/messages/es.json` | Agregar objeto `"emptySearch"` con claves i18n |

### Archivos NO tocar:
- `src/features/models/components/ModelCard.tsx` — se reutiliza sin cambios
- API, DB — sin cambios de backend

---

## Código de referencia — Implementación exacta

### `EmptySearchState.tsx` — CREAR

```typescript
// Server Component — sin 'use client'
import Link from 'next/link'
import { ModelCard } from './ModelCard'
import type { Model } from '../types/models.types'

interface EmptySearchStateProps {
  search: string
  category?: string
  locale: string
  suggestedModels: Model[]
  clearHref: string
  // Textos pre-resueltos desde page.tsx (evita importar next-intl/server aquí)
  texts: {
    noResults: string       // "No encontramos agentes para 'X'"
    suggestion: string      // "Prueba con otras palabras..."
    alsoTryClearCategory?: string
    viewAll: string         // "Ver todos los agentes"
    popularAgents: string   // "Agentes populares"
  }
}

export function EmptySearchState({
  search,
  category,
  locale,
  suggestedModels,
  clearHref,
  texts,
}: EmptySearchStateProps) {
  return (
    <div className="py-16">
      {/* Mensaje principal */}
      <div className="text-center mb-10">
        <p className="text-5xl mb-4">🔍</p>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          {texts.noResults}
        </h2>
        <p className="text-gray-500 text-sm mb-1">
          {texts.suggestion}
        </p>
        {category && texts.alsoTryClearCategory && (
          <p className="text-gray-400 text-sm">
            {texts.alsoTryClearCategory}
          </p>
        )}

        {/* Botón "Ver todos los agentes" */}
        <Link
          href={clearHref}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-avax-500 px-6 py-2.5 text-sm font-semibold text-white hover:bg-avax-600 transition"
        >
          {texts.viewAll}
        </Link>
      </div>

      {/* Agentes sugeridos — solo si existen */}
      {suggestedModels.length > 0 && (
        <div>
          <h3 className="text-center text-sm font-medium text-gray-400 uppercase tracking-wide mb-6">
            {texts.popularAgents}
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {suggestedModels.map((model, i) => (
              <ModelCard key={model.id} model={model} locale={locale} index={i} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

### `page.tsx` — Cambios a realizar

**Cambio 1: Agregar import**
```typescript
import { EmptySearchState } from '@/features/models/components/EmptySearchState'
```

**Cambio 2: Segunda llamada a `getModels` condicional (después de la llamada principal)**
```typescript
// Cargar sugeridos SOLO si búsqueda activa retorna 0 resultados
const suggestedModels = (models.length === 0 && search)
  ? (await getModels({ limit: 4, offset: 0 })).models
  : []
```

**Cambio 3: Reemplazar el bloque de empty state**

```tsx
{models.length === 0 ? (
  search ? (
    // HU-9.1: Empty state rico cuando hay búsqueda activa sin resultados
    <EmptySearchState
      search={search}
      category={category}
      locale={locale}
      suggestedModels={suggestedModels}
      clearHref={`/${locale}`}
      texts={{
        noResults: t('emptySearch.noResults', { search }),
        suggestion: t('emptySearch.suggestion'),
        alsoTryClearCategory: category ? t('emptySearch.alsoTryClearCategory') : undefined,
        viewAll: t('emptySearch.viewAll'),
        popularAgents: t('emptySearch.popularAgents'),
      }}
    />
  ) : (
    // Mantener el empty state ACTUAL para marketplace vacío (sin búsqueda)
    <div className="rounded-2xl border-2 border-dashed border-gray-200 py-16 text-center">
      {/* ... código original sin cambios ... */}
    </div>
  )
) : (
  <div className="grid ...">...</div>
)}
```

---

## Claves i18n

### `src/messages/en.json` — agregar objeto `"emptySearch"`:
```json
"emptySearch": {
  "noResults": "No agents found for '{search}'",
  "suggestion": "Try different keywords or remove some filters.",
  "alsoTryClearCategory": "You can also try clearing the category filter.",
  "viewAll": "View all agents",
  "popularAgents": "Popular agents"
}
```

### `src/messages/es.json` — agregar objeto `"emptySearch"`:
```json
"emptySearch": {
  "noResults": "No encontramos agentes para '{search}'",
  "suggestion": "Prueba con otras palabras o quita algunos filtros.",
  "alsoTryClearCategory": "También puedes quitar el filtro de categoría.",
  "viewAll": "Ver todos los agentes",
  "popularAgents": "Agentes populares"
}
```

**Nota:** next-intl usa ICU message format → `{search}` en el mensaje se interpola con `t('emptySearch.noResults', { search })`.

---

## Notas de implementación

### EmptySearchState es Server Component
Sin `'use client'` — recibe datos ya cargados desde `page.tsx`. El `page.tsx` es async Server Component y pasa textos pre-resueltos como props → no se necesita `useTranslations` dentro del componente.

### La segunda llamada a `getModels` es barata
- Solo ocurre cuando `models.length === 0 && search` → caso poco frecuente
- Next.js cachea llamadas a Supabase en el mismo request (React cache)
- ISR con `revalidate = 300` cachea ambas llamadas juntas

### `clearHref` → `/${locale}` limpia todo
Pasar `clearHref={/${locale}}` sin query params limpia búsqueda Y categoría. Esto es intencional — el botón "Ver todos los agentes" resetea completamente el estado del marketplace.

### Verificar interpolación en next-intl
```typescript
// Así se usa la interpolación de variables en next-intl:
t('emptySearch.noResults', { search })
// El mensaje debe tener: "No encontramos agentes para '{search}'"
// Las comillas simples alrededor de {search} son parte del texto, no escape
```

---

## Flujo completo

```
Usuario busca "xyz" que no existe
  ↓
page.tsx: getModels({ search: 'xyz', ... }) → models = [], total = 0
  ↓
search !== undefined && models.length === 0:
  → getModels({ limit: 4, offset: 0 }) → suggestedModels (top 4 sin filtros)
  ↓
Renderiza EmptySearchState:
  - 🔍 icono
  - "No encontramos agentes para 'xyz'"
  - "Prueba con otras palabras o quita algunos filtros."
  - [Si category activa]: "También puedes quitar el filtro de categoría."
  - Botón "Ver todos los agentes" → /{locale}
  - Grid de hasta 4 ModelCard de agentes populares

Caso: marketplace vacío (sin search)
  ↓
models.length === 0, search === undefined
  → Renderiza el empty state ORIGINAL (sin cambios) ✓

Caso: sugeridos también vacíos (DB sin agentes)
  ↓
suggestedModels = []
  → EmptySearchState renderiza sin sección de sugeridos ✓ (condición: suggestedModels.length > 0)
```

---

## DoD — Definition of Done

- [ ] `EmptySearchState.tsx` creado en `src/features/models/components/`
- [ ] Búsqueda sin resultados + `search` activo → muestra `EmptySearchState`
- [ ] Mensaje correcto: `"No encontramos agentes para '{término}'"` ✓
- [ ] Hasta 4 agentes sugeridos visibles (usando `ModelCard` existente sin modificación)
- [ ] Si sugeridos también vacíos → empty state sin sección de sugeridos (no crash) ✓
- [ ] Botón "Ver todos los agentes" → `/${locale}` (limpia todos los filtros)
- [ ] Si hay `category` activa → mensaje adicional visible ✓
- [ ] Caso marketplace vacío (sin `search`) → mantiene comportamiento original ✓
- [ ] Traducciones `emptySearch.*` en `en.json` y `es.json`
- [ ] `npm run build` sin errores TypeScript
- [ ] Sin warnings ESLint
- [ ] `git push origin master master:main`

---

## Dev Agent Record

### Agent Model Used
_(completar al implementar)_

### Completion Notes List
_(completar al implementar)_

### File List
- `src/features/models/components/EmptySearchState.tsx` — NUEVO
- `src/app/[locale]/page.tsx` — MODIFICADO
- `src/messages/en.json` — MODIFICADO
- `src/messages/es.json` — MODIFICADO
