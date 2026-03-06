# Story HU-9.2: Preview live en /publish (creator ve la card en tiempo real)

**Status:** ready-for-dev  
**Sprint:** 7 | **Épica:** Epic 9 — UX Improvements  
**Prioridad:** P2 | **Estimación:** M (~1 día)  
**Dependencias:** Ninguna (`ModelCard` ya existe)

---

## Historia de usuario

Como creator publicando un agente, mientras lleno el formulario de publicación, quiero ver una preview en tiempo real de cómo quedará la card de mi agente en el marketplace, para asegurarme de que se ve profesional antes de publicar.

---

## Acceptance Criteria

1. En la página `/publish`, hay un **panel lateral** (desktop) o **sección inferior** (mobile) que muestra una `ModelCard` con los datos del formulario en tiempo real.
2. La preview se actualiza con **cada keystroke** — debounce ≤ 200ms si aplica (en la práctica, React re-render es suficientemente rápido).
3. **Campos reflejados** en la preview: nombre, descripción, precio, categoría, tipo de agente (`agent_type`), slug (para badge), imagen si está cargada.
4. Si un campo requerido está **vacío**, la preview muestra un **placeholder en gris** — sin error, sin crash.
5. La preview está claramente **etiquetada como "Vista previa" / "Preview"** con un badge visible.
6. En **mobile**, la preview es **collapsible** (toggle "Ver preview" / "Ocultar preview", colapsada por defecto).
7. La preview usa **exactamente el mismo componente `ModelCard`** del marketplace — sin duplicación de código.

---

## Hallazgo crítico — PublishForm ya es Client Component

```typescript
// Verificado en src/app/[locale]/publish/PublishForm.tsx línea 1:
'use client'
import { useState } from 'react'
```

**El riesgo del S0 (Server/Client Component) está resuelto.** PublishForm ya es Client Component con `useState`. No se requiere conversión.

**También existe `AgentCardPreview`** en `src/components/publish/AgentCardPreview.tsx`. El AC #7 requiere usar `ModelCard` directamente, no `AgentCardPreview`. No hay conflicto — `PublishPreview` wrappea `ModelCard`.

---

## Estructura de archivos

### Archivos a CREAR:

| Archivo | Descripción |
|---------|-------------|
| `src/features/publish/components/PublishPreview.tsx` | Wrapper Client Component con toggle mobile + ModelCard |

### Archivos a MODIFICAR:

| Archivo | Cambio |
|---------|--------|
| `src/features/models/components/ModelCard.tsx` | 3 defaults defensivos mínimos (name, total_calls, price_per_call) |
| `src/app/[locale]/publish/PublishForm.tsx` | Importar `PublishPreview`; cambiar layout a grid 2 col; pasar `previewData` |
| `src/messages/en.json` | Agregar claves `preview.*` dentro de `"publish"` |
| `src/messages/es.json` | Agregar claves `preview.*` dentro de `"publish"` |

### Archivos NO tocar:
- API, DB — sin cambios de backend
- Lógica de publicación existente — NO romper el flujo de submit

---

## Cambios en `ModelCard.tsx` — Mínimos (3 defaults defensivos)

Solo estos 3 cambios. Sin cambios estructurales.

**Cambio 1: `name` puede ser vacío**
```tsx
// ANTES:
<h3 className="...">{model.name}</h3>

// DESPUÉS:
<h3 className="...">{model.name ?? 'Sin nombre'}</h3>
```

**Cambio 2: `total_calls` puede ser undefined**
```typescript
// ANTES:
const remaining = Math.max(0, model.total_calls)

// DESPUÉS:
const remaining = Math.max(0, model.total_calls ?? 0)
```

**Cambio 3: `price_per_call` puede ser undefined**
```tsx
// ANTES:
<span className="text-sm font-bold text-gray-900">${model.price_per_call}</span>

// DESPUÉS:
<span className="text-sm font-bold text-gray-900">
  ${(model.price_per_call ?? 0).toFixed(2)}
</span>
```

---

## `PublishPreview.tsx` — CREAR

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
  previewLabel: string   // "Vista previa" (i18n, resuelto desde PublishForm)
  showLabel: string      // "Ver preview" (mobile)
  hideLabel: string      // "Ocultar preview" (mobile)
}

export function PublishPreview({
  locale,
  formData,
  previewLabel,
  showLabel,
  hideLabel,
}: PublishPreviewProps) {
  const [collapsed, setCollapsed] = useState(true) // mobile: colapsado por defecto

  // Construir objeto Model con defaults seguros para preview
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
    creator_id: '',
    endpoint_url: '',
    capabilities: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  return (
    <>
      {/* Botón toggle — solo visible en mobile */}
      <div className="sm:hidden mb-4">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-700"
        >
          <span>{collapsed ? showLabel : hideLabel}</span>
          <svg
            className={`h-4 w-4 transition-transform ${collapsed ? '' : 'rotate-180'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Panel de preview: oculto en mobile cuando colapsado, siempre visible en desktop */}
      <div className={collapsed ? 'hidden sm:block' : 'block'}>
        {/* Badge "Preview" */}
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded-full bg-avax-50 border border-avax-100 px-3 py-1 text-xs font-semibold text-avax-600">
            {previewLabel}
          </span>
          <span className="text-xs text-gray-400">Vista previa en tiempo real</span>
        </div>

        {/* ModelCard no interactivo — pointer-events-none para evitar clicks en preview */}
        <div className="pointer-events-none select-none opacity-95">
          <ModelCard model={previewModel} locale={locale} index={0} />
        </div>
      </div>
    </>
  )
}
```

**Nota sobre el tipo `Model`:** Si el tipo tiene campos requeridos que no están en la lista de arriba, agregar los defaults necesarios para satisfacer TypeScript. El objeto `previewModel` debe compilar sin errores. Usar `as any` como último recurso temporal si hay conflicto de tipos — documentarlo en completion notes.

---

## `PublishForm.tsx` — Cambios a realizar

### Cambio 1: Imports nuevos
```typescript
import { PublishPreview } from '@/features/publish/components/PublishPreview'
// useTranslations ya está importado en PublishForm
```

### Cambio 2: Extraer previewData desde el state existente
```typescript
// data y draftSlug ya existen en PublishForm como useState
// Agregar después de los useState existentes:
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

### Cambio 3: Cambiar el wrapper del return a grid 2 columnas

Envolver el JSX actual del formulario en un grid. El max-width actual del form probablemente es `max-w-2xl` o `max-w-3xl` — ampliar a `max-w-5xl` para acomodar el panel lateral.

```tsx
return (
  <div className="min-h-screen bg-gray-50 py-8 px-4">
    <div className="mx-auto max-w-5xl">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-8 items-start">
        
        {/* Columna izquierda: formulario EXISTENTE (sin cambios internos) */}
        <div>
          {/* ... TODO el JSX actual del form va aquí, sin cambios ... */}
        </div>

        {/* Columna derecha: preview sticky */}
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

**⚠️ CRÍTICO:** No romper el flujo de submit. Solo está cambiando el wrapper del layout — la lógica interna del formulario no se toca.

---

## Claves i18n

### `src/messages/en.json` — agregar dentro del objeto `"publish"`:
```json
"preview": {
  "label": "Preview",
  "show": "Show preview",
  "hide": "Hide preview"
}
```

### `src/messages/es.json` — agregar dentro del objeto `"publish"`:
```json
"preview": {
  "label": "Vista previa",
  "show": "Ver preview",
  "hide": "Ocultar preview"
}
```

---

## Notas de implementación

### `AgentCardPreview` existente
Existe `src/components/publish/AgentCardPreview.tsx`. Esta HU NO lo usa (AC #7 requiere `ModelCard`). No eliminar `AgentCardPreview` — puede ser usado por otro código. Solo se crea `PublishPreview` como alternativa que usa `ModelCard`.

### `pointer-events-none` en ModelCard
`ModelCard` tiene un `<Link>` que navega a la ficha del agente. En preview, esa navegación no tiene sentido. El `pointer-events-none` en el wrapper evita cualquier click dentro del card de preview. El usuario no puede interactuar con el card preview — solo verlo.

### Verificar campos del type `Model`
Antes de crear el `previewModel`, revisar el tipo en `src/features/models/types/models.types.ts` para asegurarse de que todos los campos requeridos están en el objeto. Si hay campos adicionales requeridos, agregar con `'' | 0 | null | false` según corresponda.

### Flujo de submit no debe romperse
El submit de `PublishForm` usa el state `data` existente. Los cambios solo agregan:
1. Un nuevo `previewData` derivado (no altera `data`)
2. Un componente visual en el panel derecho
3. Un cambio de layout wrapper

Ninguno de estos cambios afecta `handleSubmit`, `handleChange`, o cualquier otra lógica del formulario.

---

## Flujo completo

```
Creator en /publish
  ↓
PublishForm (Client Component) renderiza con grid 2 columnas en lg: breakpoint
  ↓
Panel izquierdo: formulario existente sin cambios
Panel derecho: PublishPreview (sticky en desktop)
  ↓
Creator escribe "Mi Agente Inteligente" en campo name
  ↓
handleChange('name', 'Mi Agente Inteligente') → setData({...data, name: 'Mi Agente Inteligente'})
  ↓
previewData.name = 'Mi Agente Inteligente'
  ↓
PublishPreview re-renderiza → ModelCard muestra "Mi Agente Inteligente" ✓

Mobile:
  ↓
Panel derecho: botón "Ver preview" (collapsed=true por defecto)
  ↓
Click → collapsed=false → ModelCard visible ✓
Click "Ocultar preview" → collapsed=true ✓
```

---

## DoD — Definition of Done

- [ ] `PublishPreview.tsx` creado en `src/features/publish/components/`
- [ ] `ModelCard.tsx` con 3 defaults defensivos (name, total_calls, price_per_call)
- [ ] `PublishForm.tsx` layout en grid 2 columnas en `lg:` breakpoint
- [ ] Preview se actualiza en tiempo real con cada cambio del formulario
- [ ] Campos reflejados: nombre, descripción, precio, categoría, agent_type, imagen
- [ ] Campos vacíos → placeholder seguro (sin crash, sin error visible)
- [ ] Label "Vista previa" / "Preview" visible con badge
- [ ] Mobile: toggle "Ver preview / Ocultar preview" funcional (colapsado por defecto)
- [ ] Desktop: panel sticky lateral
- [ ] `ModelCard` no navega en preview (`pointer-events-none`)
- [ ] Traducciones `preview.*` en `publish.*` en `en.json` y `es.json`
- [ ] Flujo existente de publicación NO roto (submit funciona igual)
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
- `src/features/publish/components/PublishPreview.tsx` — NUEVO
- `src/features/models/components/ModelCard.tsx` — MODIFICADO (3 defaults)
- `src/app/[locale]/publish/PublishForm.tsx` — MODIFICADO (layout + preview)
- `src/messages/en.json` — MODIFICADO
- `src/messages/es.json` — MODIFICADO
