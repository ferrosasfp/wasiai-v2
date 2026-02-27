# SDD — HU-9.1: Empty state cuando búsqueda retorna 0 resultados

**Estado:** SPEC_PENDING  
**Sprint:** 7 | **Épica:** Epic 9 — UX Improvements  
**Prioridad:** P2 | **Estimación:** S  
**Generado por:** Architect (BMAD Method v6) · 2026-02-27

---

## 1. Análisis del codebase actual

### Estado actual en page.tsx

`src/app/[locale]/page.tsx` ya tiene lógica de empty state básica:
```tsx
{models.length === 0 ? (
  <div className="rounded-2xl border-2 border-dashed ...">
    <p className="text-4xl mb-4">🔍</p>
    <p>{search || category ? t('noModelsFiltered') : t('noModels')}</p>
    {(search || category) ? (
      <Link href={`/${locale}`}>Limpiar filtros</Link>
      ...
    ) : (
      <Link href={`/${locale}/publish`}>Sé el primero</Link>
    )}
  </div>
) : (
  <div className="grid ...">...</div>
)}
```

**El empty state existe pero es básico:** sin icono amigable real, sin sugerencias de agentes populares, sin separación de casos "búsqueda sin resultados" vs "marketplace vacío".

Esta HU reemplaza ese bloque básico con `EmptySearchState` **solo cuando hay término de búsqueda activo**. Si no hay search (marketplace vacío), se mantiene el comportamiento actual.

---

## 2. Schema de DB / Endpoints / On-chain

**Ninguno.** Solo UI. La API ya existe.

---

## 3. Componentes UI

### 3.1 EmptySearchState — NUEVO

**Path:** `src/features/models/components/EmptySearchState.tsx`

```typescript
// Server Component (sin 'use client' — recibe datos ya cargados)
interface EmptySearchStateProps {
  search: string        // término buscado (para mostrar en mensaje)
  category?: string     // filtro de categoría activo (para mensaje adicional)
  locale: string        // para links locale-aware
  suggestedModels: Model[]  // hasta 4 agentes sugeridos (pasados desde page.tsx)
  clearHref: string     // href para limpiar filtros
}
```

**Estructura JSX:**
```tsx
export function EmptySearchState({
  search, category, locale, suggestedModels, clearHref
}: EmptySearchStateProps) {
  const t = useTranslations('emptySearch')  // ← server-side via getTranslations

  return (
    <div className="py-16">
      {/* Mensaje principal */}
      <div className="text-center mb-10">
        <p className="text-5xl mb-4">🔍</p>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          {t('noResults', { search })}
        </h2>
        <p className="text-gray-500 text-sm mb-1">
          {t('suggestion')}
        </p>
        {category && (
          <p className="text-gray-400 text-sm">
            {t('alsoTryClearCategory')}
          </p>
        )}
        
        {/* Botón "Ver todos los agentes" */}
        <Link
          href={clearHref}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-avax-500 px-6 py-2.5 text-sm font-semibold text-white hover:bg-avax-600 transition"
        >
          {t('viewAll')}
        </Link>
      </div>

      {/* Agentes sugeridos */}
      {suggestedModels.length > 0 && (
        <div>
          <h3 className="text-center text-sm font-medium text-gray-400 uppercase tracking-wide mb-6">
            {t('popularAgents')}
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

**Nota:** Este componente es Server Component. Usa `useTranslations` (disponible en server via `next-intl/server`) o recibe textos como props. **Preferencia:** recibir `t` resuelto desde page.tsx para simplificar.

**Alternativa más simple:** Recibir textos como props desde page.tsx (que ya hace `getTranslations`). Evita importar `next-intl/server` en el componente hijo.

```typescript
// Props alternativas con textos pre-resueltos:
interface EmptySearchStateProps {
  search: string
  category?: string
  locale: string
  suggestedModels: Model[]
  clearHref: string
  // Textos resueltos desde page.tsx:
  texts: {
    noResults: string    // "No encontramos agentes para 'X'"
    suggestion: string   // "Intenta con otros términos..."
    alsoTryClearCategory?: string
    viewAll: string      // "Ver todos los agentes"
    popularAgents: string // "Agentes populares"
  }
}
```

**Recomendación:** Usar la alternativa con textos como props — más simple y Server Component puro.

---

### 3.2 page.tsx — MODIFICAR

**Path:** `src/app/[locale]/page.tsx`

**Cambio 1: Import nuevo**
```typescript
import { EmptySearchState } from '@/features/models/components/EmptySearchState'
```

**Cambio 2: Segunda llamada a `getModels` condicional**

Agregar después de la llamada principal:
```typescript
// Solo cargar sugeridos si la búsqueda retorna 0 resultados Y hay término activo
const suggestedModels = (models.length === 0 && search)
  ? (await getModels({ limit: 4, offset: 0 })).models
  : []
```

**Cambio 3: Reemplazar el empty state básico para el caso de búsqueda**

```tsx
{models.length === 0 ? (
  search ? (
    // HU-9.1: Empty state con sugerencias cuando hay búsqueda activa
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
    // Mantener el empty state actual para marketplace vacío (sin búsqueda)
    <div className="rounded-2xl border-2 border-dashed border-gray-200 py-16 text-center">
      ...{/* código actual sin cambios */}
    </div>
  )
) : (
  <div className="grid ...">...</div>
)}
```

---

## 4. i18n — Claves nuevas

### `src/messages/en.json` — agregar en objeto `"home"`:
```json
"emptySearch": {
  "noResults": "No agents found for '{search}'",
  "suggestion": "Try different keywords or remove some filters.",
  "alsoTryClearCategory": "You can also try clearing the category filter.",
  "viewAll": "View all agents",
  "popularAgents": "Popular agents"
}
```

### `src/messages/es.json` — agregar en objeto `"home"`:
```json
"emptySearch": {
  "noResults": "No encontramos agentes para '{search}'",
  "suggestion": "Prueba con otras palabras o quita algunos filtros.",
  "alsoTryClearCategory": "También puedes quitar el filtro de categoría.",
  "viewAll": "Ver todos los agentes",
  "popularAgents": "Agentes populares"
}
```

**Nota sobre interpolación next-intl:** `t('noResults', { search })` usa ICU message format — `{search}` en el mensaje.

---

## 5. Flujo completo

```
Usuario busca "xyz" que no existe
  ↓
page.tsx: getModels({ search: 'xyz', ... }) → models = [], total = 0
  ↓
search !== undefined && models.length === 0 → cargar suggestedModels (4 tops sin filtro)
  ↓
Renderiza EmptySearchState con:
  - Mensaje: "No encontramos agentes para 'xyz'"
  - Sugerencia de limpiar filtros
  - [Si hay category activa]: mensaje adicional sobre quitar categoría
  - Hasta 4 ModelCard de agentes populares
  - Botón "Ver todos los agentes" → href="/{locale}"

Usuario con category="nlp" + search="xyz" sin resultados:
  ↓
Mismo flujo + mensaje adicional sobre categoría
  ↓
clearHref limpia tanto search como category (href="/{locale}" sin params)

Caso: marketplace completamente vacío (sin agentes en DB):
  ↓
suggestedModels = [] también → EmptySearchState renderiza sin sección de sugeridos ✓
  → Sigue mostrando el mensaje y botón "Ver todos los agentes"
```

---

## 6. Performance

- La segunda llamada a `getModels({ limit: 4 })` solo ocurre si `models.length === 0 && search` → caso poco frecuente
- Next.js cachea las llamadas a Supabase en el mismo request (React cache) → la segunda llamada es barata
- Con `revalidate = 300` (ISR), la página se revalida cada 5 min → ambas llamadas cacheadas juntas

---

## 7. Definition of Done

- [ ] `EmptySearchState.tsx` creado en `src/features/models/components/`
- [ ] Búsqueda sin resultados + `search` activo → muestra `EmptySearchState`
- [ ] Mensaje correcto: `"No encontramos agentes para '{término}'"` 
- [ ] Hasta 4 agentes sugeridos visibles (usando `ModelCard` existente sin modificación)
- [ ] Si sugeridos también vacíos → empty state sin sección de sugeridos (no crash)
- [ ] Botón "Ver todos los agentes" → `/${locale}` (limpia todos los filtros)
- [ ] Si hay `category` activa → mensaje adicional visible
- [ ] Caso marketplace vacío (sin `search`) → mantiene comportamiento original
- [ ] Traducciones `emptySearch.*` en `en.json` y `es.json`
- [ ] `npm run build` sin errores TypeScript
- [ ] Sin warnings ESLint
- [ ] `git push origin master master:main`

---

## 8. Implementation Readiness Check

| Item | Estado |
|------|--------|
| `getModels` service disponible | ✅ Ya existe en models.service.ts |
| `ModelCard` acepta datos completos sin modificación | ✅ Verificado en código |
| page.tsx es Server Component (async) | ✅ `export default async function HomePage` |
| `getTranslations` disponible en page.tsx | ✅ Ya se usa |
| `id="agents"` anchor en page.tsx | ✅ No relacionado con esta HU |
| Sin cambios de backend/API/DB | ✅ Confirmado |
| Riesgo sugeridos vacíos | ✅ Condición `suggestedModels.length > 0` en JSX |

**Veredicto: IMPLEMENTABLE sin ambigüedades.** ~4 horas de dev.

---

*Generado por Architect (BMAD v6) · Sprint 7 · 2026-02-27*
