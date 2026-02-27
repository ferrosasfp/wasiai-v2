# S1 — SDD-UX-08: Validación /publish Alineada con UI

**HU origen:** UX-08  
**Sprint:** 5  
**Prioridad:** P1  
**Estimado:** 0.5 días  
**Estado:** PENDING_SPEC_APPROVED  
**Archivos afectados:** `Step1Basic.tsx`, `PublishForm.tsx`, `messages/en.json`, `messages/es.json`  
**Sin cambios en API**

---

## 1. Análisis del estado actual

### Step1Basic.tsx — problemas identificados
| Campo | Estado actual | Problema |
|-------|--------------|---------|
| `name` | `*` rojo presente | ✅ ya marcado |
| `description` | Sin `*`, sin validación client-side | ❌ servidor la requiere pero UI no la valida |
| `category` | `*` rojo presente | ✅ ya marcado |
| `endpoint_url` | Está en Step3 (fuera de scope aquí) | — |

### PublishForm.tsx — problemas identificados
- `handleStep1Next`: cuando el servidor retorna error con `json.details` (array Zod), el mapeo usa `issue.path[0] ?? 'name'` — si description falla en el servidor, se mapea bien. ✅ ya funciona.
- Cuando el servidor retorna `json.fields` directamente → también ok. ✅
- El campo `description` no tiene validación client-side en `Step1Basic.handleNext()`, así que siempre llega al servidor vacío. ❌

---

## 2. Cambios requeridos

### 2.1 `src/components/publish/Step1Basic.tsx`

#### A) Label de `description` — agregar `*` rojo + texto auxiliar

**Antes:**
```tsx
<label className="mb-1.5 block text-sm font-medium text-gray-700">Descripción</label>
```

**Después:**
```tsx
<label className="mb-1.5 block text-sm font-medium text-gray-700">
  {t('description')} <span className="text-red-500">*</span>
  <span className="ml-2 font-normal text-gray-400 text-xs">{t('descriptionHint')}</span>
</label>
```

#### B) Textarea de `description` — agregar borde rojo en error + limpiar error al editar

**Antes:**
```tsx
<textarea
  value={data.description ?? ''}
  onChange={e => onChange('description', e.target.value)}
  placeholder="Describe qué hace tu agente..."
  rows={4}
  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100"
/>
{allErrors.description && <p className="mt-1 text-xs text-red-500">{allErrors.description}</p>}
```

**Después:**
```tsx
<textarea
  value={data.description ?? ''}
  onChange={e => {
    onChange('description', e.target.value)
    if (localErrors.description) setLocalErrors(prev => { const err = { ...prev }; delete err.description; return err })
  }}
  placeholder={t('descriptionPlaceholder')}
  rows={4}
  className={`w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-avax-100 transition ${
    allErrors.description
      ? 'border-red-500 focus:border-red-500'
      : 'border-gray-200 focus:border-avax-400'
  }`}
/>
{allErrors.description && (
  <p className="mt-1 text-xs text-red-500">{allErrors.description}</p>
)}
```

#### C) `handleNext()` — agregar validación de `description`

**Antes:**
```tsx
function handleNext() {
  const errs: Record<string, string> = {}
  if (!data.name || data.name.trim().length < 3) {
    errs.name = 'El nombre debe tener al menos 3 caracteres'
  }
  if (!data.category) {
    errs.category = 'Selecciona una categoría'
  }
  if (Object.keys(errs).length > 0) {
    setLocalErrors(errs)
    return
  }
  setLocalErrors({})
  onNext()
}
```

**Después:**
```tsx
function handleNext() {
  const errs: Record<string, string> = {}
  if (!data.name || data.name.trim().length < 3) {
    errs.name = t('errors.nameMin')
  }
  if (!data.description || data.description.trim().length < 10) {
    errs.description = t('errors.descriptionMin')
  }
  if (!data.category) {
    errs.category = t('errors.categoryRequired')
  }
  if (Object.keys(errs).length > 0) {
    setLocalErrors(errs)
    // Foco automático al primer campo con error
    const firstErrorField = Object.keys(errs)[0]
    const el = document.querySelector(`[data-field="${firstErrorField}"]`) as HTMLElement | null
    el?.focus()
    return
  }
  setLocalErrors({})
  onNext()
}
```

#### D) Agregar `data-field` a los inputs para foco automático

- `<input … data-field="name" …>` — ya existe, agregar atributo
- `<textarea … data-field="description" …>` — agregar atributo
- `<select … data-field="category" …>` — agregar atributo

#### E) Input `name` — agregar borde rojo en error (consistencia visual)

Aplicar la misma lógica condicional de className que en description:
```tsx
className={`w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-avax-100 transition ${
  allErrors.name
    ? 'border-red-500 focus:border-red-500'
    : 'border-gray-200 focus:border-avax-400'
}`}
```

---

### 2.2 `src/app/[locale]/publish/PublishForm.tsx`

#### El mapeo de errores servidor → campo **ya funciona** para los dos paths:

```typescript
// Path A: json.fields (formato WasiAI custom)
if (json.fields) {
  setErrors(json.fields as Record<string, string>)  // ← description se mapea directo
}

// Path B: json.details (formato Zod array)
for (const issue of json.details) {
  const field = issue.path[0] ?? 'name'  // ← description se mapea si path[0] === 'description'
  fieldErrors[field] = issue.message
}
```

**No requiere cambios funcionales.** Solo ajuste cosmético: cuando hay error en `description` y no en `name`, el fallback `?? 'name'` podría ocultar el error real. Mitigación:

**Cambio puntual en `handleStep1Next`:**

**Antes:**
```typescript
const field = issue.path[0] ?? 'name'
```

**Después:**
```typescript
const field = issue.path[0] ?? '_form'
```

Así, errores genéricos sin path van a `_form` (no se muestran inline pero no pisarán `name`). El toast de fallback genérico no existe aún; si `_form` tiene valor se puede mostrar como banner. **Scope mínimo:** dejar el cambio del fallback y documentar para siguiente iteración.

---

### 2.3 Keys i18n — `messages/en.json` y `messages/es.json`

#### Agregar dentro del objeto `"publish"`:

**`messages/en.json`** — añadir:
```json
"descriptionHint": "Minimum 10 characters",
"descriptionPlaceholder": "Describe what your agent does, what inputs it accepts and what outputs it returns...",
"errors": {
  "nameMin": "Name must be at least 3 characters",
  "descriptionMin": "Description must be at least 10 characters",
  "categoryRequired": "Select a category"
}
```

**`messages/es.json`** — añadir:
```json
"descriptionHint": "Mínimo 10 caracteres",
"descriptionPlaceholder": "Describe qué hace tu agente, qué inputs acepta y qué outputs devuelve...",
"errors": {
  "nameMin": "El nombre debe tener al menos 3 caracteres",
  "descriptionMin": "La descripción debe tener al menos 10 caracteres",
  "categoryRequired": "Selecciona una categoría"
}
```

> **Nota:** los strings hardcoded en español que existían en `handleNext()` se mueven a i18n. El placeholder de description también se mueve a i18n (actualmente es string literal en el componente).

---

## 3. Flujo completo post-implementación

```
Usuario en Step1
│
├─ Llena name < 3 chars → [Next] → error inline bajo name, foco al input
├─ description vacía → [Next] → error inline "Mínimo 10 caracteres", foco al textarea
├─ sin categoría → [Next] → error inline, foco al select
│
├─ Todo válido → [Next] → llama servidor
│   ├─ Servidor 422/400 con json.fields → setErrors → aparece bajo el campo exacto
│   ├─ Servidor 422/400 con json.details (Zod) → mapeo path[0] → campo exacto
│   └─ Servidor error sin campo → fallback a _form (sin UI inline, sin crash)
│
└─ Servidor 200 → avanza a Step2
```

---

## 4. Definition of Done (DoD verificable)

| # | Check | Cómo verificar |
|---|-------|----------------|
| 1 | Campo "Descripción" muestra `*` rojo junto al label | Visual en `/publish` |
| 2 | Texto auxiliar "Mínimo 10 caracteres" visible junto al label | Visual en `/publish` |
| 3 | Submit con description vacía → error inline, **no llama al servidor** | DevTools Network: sin request POST/PATCH |
| 4 | Submit con description de 9 chars → error inline | Contar caracteres manualmente |
| 5 | Submit con description de 10 chars → avanza | Sin error, request enviado |
| 6 | Al escribir en description con error activo → error desaparece | Interacción manual |
| 7 | Borde rojo en textarea cuando hay error | Visual |
| 8 | Borde rojo en input name cuando hay error | Visual |
| 9 | Foco automático al primer campo inválido al intentar [Next] | Tab orden + foco visual |
| 10 | Error de servidor `{ field: "description", message: "..." }` → aparece bajo el textarea | Mockear error con devtools o test endpoint |
| 11 | Keys i18n en `en.json` y `es.json` presentes y sin warnings en consola | `next build` o consola en dev |
| 12 | Sin cambios en `POST /api/models` ni `PATCH /api/creator/agents/[slug]` | Diff de archivos API |
| 13 | Build TypeScript sin errores (`tsc --noEmit`) | `npm run build` |

---

## 5. Notas de implementación para Dev

- **No crear nuevas dependencias** — todo con Tailwind + react state existente
- **No usar `disabled` en el botón** — errores inline al intentar submit (AC4)
- El campo `data-field` es un atributo HTML estándar, no requiere tipado extra
- Los strings de error en `handleNext` que estaban hardcoded en español → mover a i18n con `t('errors.*')`
- El componente ya usa `useTranslations('publish')` → solo agregar las keys nuevas
- Verificar que `allErrors = { ...localErrors, ...errors }` sigue siendo el merge correcto (servidor sobreescribe local) ✅

---

**Estado:** PENDING_SPEC_APPROVED  
**Requiere aprobación explícita de Fer antes de pasar a SM → Create Story.**
