# SDD — HU-9.2: Preview live en /publish

**Estado:** SPEC_PENDING  
**Sprint:** 7 | **Épica:** Epic 9 — UX Improvements  
**Prioridad:** P2 | **Estimación:** M  
**Generado por:** Architect (BMAD Method v6) · 2026-02-27

---

## 1. Análisis del codebase — Resolución del riesgo crítico

### Riesgo S0: ¿Es PublishForm Server o Client Component?

**Verificado en codebase:**

`src/app/[locale]/publish/page.tsx`:
```typescript
const PublishForm = dynamic(() => import('./PublishForm'), { ... })
```

`src/app/[locale]/publish/PublishForm.tsx` (primeras líneas):
```typescript
'use client'

import { useState } from 'react'
```

**PublishForm YA ES un Client Component.** El riesgo del S0 está resuelto. No se requiere conversión.

### Estado existente en PublishForm

PublishForm ya gestiona:
```typescript
const [data, setData] = useState<FormData>({ category: 'nlp', price_per_call: 0.02, ... })
```

`data` contiene: `name`, `description`, `category`, `price_per_call`, `capabilities`, `endpoint_url`, `cover_image`, `slug` (en `draftSlug`).

También existe `AgentCardPreview` importado en PublishForm:
```typescript
import { AgentCardPreview } from '@/components/publish/AgentCardPreview'
```

**Hallazgo importante:** `AgentCardPreview` ya existe en `src/components/publish/AgentCardPreview.tsx`. Esta HU puede reutilizarlo o reemplazarlo con `ModelCard` según el AC #7 ("usa exactamente el mismo componente `ModelCard`").

### Verificación de ModelCard con datos parciales

`ModelCard` accede a:
- `model.name` → sin `?.` → crash si undefined
- `model.creator?.username` → safe (ya tiene `?.`)
- `model.cover_image` → condición `if (model.cover_image)` → safe
- `model.category` → indexa `CATEGORY_COLORS[model.category]` → safe (retorna undefined → usa fallback)
- `model.description` → `{model.description && ...}` → safe
- `model.agent_type` → condición `if (model.agent_type && ...)` → safe
- `model.on_chain_registered` → condición → safe
- `model.erc8004_id` → condición → safe
- `model.total_calls` → `Math.max(0, model.total_calls)` → crash si undefined (NaN)
- `model.price_per_call` → `${model.price_per_call}` → muestra "undefined" si no definido
- `model.reputation_score` / `model.reputation_count` → condición doble → safe
- `model.is_featured` → condición → safe
- `model.slug` → en `href={/${locale}/models/${model.slug}}` → produce URL rota pero no crash
- `model.id` → en `key={model.id}` → undefined key (warning, no crash)

**Campos que requieren defaults defensivos:**
- `model.name` → `?? 'Sin nombre'`
- `model.total_calls` → `?? 0`
- `model.price_per_call` → `?? 0`

---

## 2. Schema de DB / Endpoints / On-chain

**Ninguno.** Solo UI. Sin cambios de backend.

---

## 3. Decisión de diseño: ModelCard vs AgentCardPreview

El AC #7 dice "usa exactamente el mismo componente `ModelCard`". Sin embargo, `ModelCard` es un `<Link>` que navega a la ficha del agente — en preview eso no tiene sentido.

**Solución:** Crear `PublishPreview` que:
1. Construye un objeto `Partial<Model>` con los datos del formulario
2. Renderiza `ModelCard` **envuelto en un div que cancela la navegación** o
3. Alternativa: pasa `model` a `ModelCard` y el link a `#` (no-op)

**Recomendación práctica:** Renderizar `ModelCard` dentro de un `<div>` con `pointer-events-none` en el link, o simplemente aceptar que el link no funciona en preview (el usuario no puede clickearlo dentro del panel de preview de todos modos si está en la misma página).

**Implementación limpia:** Dentro de `PublishPreview`, envolver `ModelCard` con:
```tsx
<div className="pointer-events-none select-none" aria-hidden="true">
  <ModelCard model={previewModel} locale={locale} index={0} />
</div>
```

---

## 4. Cambios en archivos

### 4.1 ModelCard.tsx — MODIFICAR (mínimamente)

**Path:** `src/features/models/components/ModelCard.tsx`

Solo agregar defaults defensivos en los 3 campos que crashean:

```typescript
// ANTES:
const remaining = Math.max(0, model.total_calls)

// DESPUÉS:
const remaining = Math.max(0, model.total_calls ?? 0)
```

```tsx
// ANTES (en header):
<h3 className="...">
  {model.name}
</h3>

// DESPUÉS:
<h3 className="...">
  {model.name ?? 'Sin nombre'}
</h3>
```

```tsx
// ANTES (en footer):
<span className="text-sm font-bold text-gray-900">${model.price_per_call}</span>

// DESPUÉS:
<span className="text-sm font-bold text-gray-900">
  ${(model.price_per_call ?? 0).toFixed(2)}
</span>
```

**Estos son los únicos cambios en ModelCard.** Sin cambios estructurales.

---

### 4.2 PublishPreview — NUEVO

**Path:** `src/features/publish/components/PublishPreview.tsx`

```typescript
'use client'

import { useState } from 'react'
import { ModelCard } from '@/features/models/components/ModelCard'
import type { Model } from '@/features/models/types/models.types'

interface PublishPreviewProps {
  locale: string
  formData: {
    name?: string
    description?: string
    category?: string
    price_per_call?: number
    agent_type?: string
    cover_image?: string | null
    slug?: string
  }
  previewLabel: string       // "Preview" (i18n)
  showLabel: string          // "Ver preview" (i18n, mobile)
  hideLabel: string          // "Ocultar preview" (i18n, mobile)
}

export function PublishPreview({ locale, formData, previewLabel, showLabel, hideLabel }: PublishPreviewProps) {
  const [collapsed, setCollapsed] = useState(true)  // mobile: colapsado por defecto

  // Construir objeto Model parcial con defaults seguros
  const previewModel: Model = {
    id: 'preview',
    slug: formData.slug ?? 'preview',
    name: formData.name ?? '',
    description: formData.description ?? '',
    category: (formData.category as Model['category']) ?? 'nlp',
    price_per_call: formData.price_per_call ?? 0,
    agent_type: (formData.agent_type as Model['agent_type']) ?? null,
    cover_image: formData.cover_image ?? null,
    total_calls: 0,
    is_featured: false,
    on_chain_registered: false,
    erc8004_id: null,
    reputation_score: null,
    reputation_count: 0,
    creator: null,
    status: 'draft',
    // Campos requeridos por el tipo — valores seguros para preview
    creator_id: '',
    endpoint_url: '',
    capabilities: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  return (
    <>
      {/* Mobile toggle button */}
      <div className="sm:hidden mb-4">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-700"
        >
          <span>{collapsed ? showLabel : hideLabel}</span>
          <svg
            className={`h-4 w-4 transition-transform ${collapsed ? '' : 'rotate-180'}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Preview panel: hidden on mobile when collapsed, always visible on desktop */}
      <div className={`${collapsed ? 'hidden sm:block' : 'block'}`}>
        {/* Label "Preview" */}
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded-full bg-avax-50 border border-avax-100 px-3 py-1 text-xs font-semibold text-avax-600">
            {previewLabel}
          </span>
          <span className="text-xs text-gray-400">Vista previa en tiempo real</span>
        </div>

        {/* ModelCard no interactivo */}
        <div className="pointer-events-none select-none opacity-95">
          <ModelCard model={previewModel} locale={locale} index={0} />
        </div>
      </div>
    </>
  )
}
```

---

### 4.3 PublishForm.tsx — MODIFICAR

**Path:** `src/app/[locale]/publish/PublishForm.tsx`

**Cambio 1: Import nuevo**
```typescript
import { PublishPreview } from '@/features/publish/components/PublishPreview'
```

**Cambio 2: Extraer datos del formulario para la preview**

Los datos ya están en `data` (useState). Se pasan directamente:
```typescript
const previewData = {
  name: data.name as string | undefined,
  description: data.description as string | undefined,
  category: data.category as string | undefined,
  price_per_call: data.price_per_call as number | undefined,
  agent_type: data.agent_type as string | undefined,
  cover_image: data.cover_image as string | null | undefined,
  slug: draftSlug ?? undefined,
}
```

**Cambio 3: Layout con panel de preview**

El layout actual de PublishForm es columna única. Se convierte a grid 2 columnas en desktop:

```tsx
// WRAPPER EXTERNO del form — cambiar a grid
return (
  <div className="min-h-screen bg-gray-50 py-8 px-4">
    <div className="mx-auto max-w-5xl">
      {/* Grid: formulario | preview */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8 items-start">
        
        {/* Columna izquierda: formulario existente (sin cambios internos) */}
        <div>
          {/* ... todo el JSX actual del form ... */}
        </div>

        {/* Columna derecha: preview (sticky en desktop) */}
        <div className="lg:sticky lg:top-20">
          <PublishPreview
            locale={locale}
            formData={previewData}
            previewLabel={t('preview.label')}
            showLabel={t('preview.show')}
            hideLabel={t('preview.hide')}
          />
        </div>

      </div>
    </div>
  </div>
)
```

**Nota sobre max-width actual:** Verificar el max-width del PublishForm actual. Si usa `max-w-2xl`, ampliar a `max-w-5xl` para acomodar el panel lateral.

---

## 5. i18n — Claves nuevas

### `src/messages/en.json` — agregar en objeto `"publish"`:
```json
"preview": {
  "label": "Preview",
  "show": "Show preview",
  "hide": "Hide preview"
}
```

### `src/messages/es.json` — agregar en objeto `"publish"`:
```json
"preview": {
  "label": "Vista previa",
  "show": "Ver preview",
  "hide": "Ocultar preview"
}
```

---

## 6. Flujo completo

```
Creator en /publish
  ↓
PublishForm (Client Component con 'use client') renderiza con grid 2 col en desktop
  ↓
Panel derecho: PublishPreview sticky
  ↓
Creator escribe "nombre del agente"
  ↓
handleChange('name', 'Mi Agente') → setData({...data, name: 'Mi Agente'})
  ↓
data cambió → PublishPreview recibe previewData actualizado → re-render
  ↓
ModelCard muestra "Mi Agente" en tiempo real ✓

Mobile:
  ↓
PublishPreview muestra botón "Ver preview" (collapsed=true por defecto)
  ↓
Click → collapsed=false → ModelCard visible
  ↓
Click "Ocultar preview" → collapsed=true ✓
```

---

## 7. Definition of Done

- [ ] `PublishPreview.tsx` creado en `src/features/publish/components/`
- [ ] `ModelCard.tsx` con 3 defaults defensivos (name, total_calls, price_per_call)
- [ ] `PublishForm.tsx` layout convertido a grid 2 columnas en `lg:` breakpoint
- [ ] Preview se actualiza en tiempo real con cada cambio del formulario
- [ ] Campos reflejados: nombre, descripción, precio, categoría, agent_type, imagen
- [ ] Campos vacíos → placeholder seguro (sin crash, sin error visible)
- [ ] Label "Vista previa" / "Preview" visible
- [ ] Mobile: toggle "Ver preview / Ocultar preview" funcional
- [ ] Desktop: panel sticky lateral
- [ ] `ModelCard` no navega en preview (pointer-events-none)
- [ ] Traducciones `preview.*` en `publish.*` en `en.json` y `es.json`
- [ ] `npm run build` sin errores TypeScript
- [ ] Sin warnings ESLint
- [ ] Flujo existente de publicación NO roto (verificar submit funciona igual)
- [ ] `git push origin master master:main`

---

## 8. Implementation Readiness Check

| Item | Estado |
|------|--------|
| PublishForm es Client Component | ✅ Verificado: `'use client'` en línea 1 |
| `data` state disponible en PublishForm | ✅ `useState<FormData>` |
| `ModelCard` importable en Client Component | ✅ Es un componente puro sin server deps |
| `AgentCardPreview` existente | ⚠️ Existe pero AC #7 requiere usar `ModelCard` — no conflicto |
| Tipo `Model` compatible con datos parciales | ✅ Con defaults defensivos agregados |
| Sin cambios de backend | ✅ Confirmado |
| Layout max-width | ⚠️ Verificar max-width actual del form para ajustar a 5xl |

**Veredicto: IMPLEMENTABLE.** Riesgo principal (Server Component) está resuelto. Un posible ajuste menor: verificar el max-width actual del form y ajustar si es necesario. ~1 día de dev.

---

*Generado por Architect (BMAD v6) · Sprint 7 · 2026-02-27*
