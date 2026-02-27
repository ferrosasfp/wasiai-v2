# Story: UX-08 — Validación /publish Alineada con UI

**Epic:** UX — Experiencia del Creator  
**Sprint:** 5  
**Prioridad:** P1  
**Estimado:** 0.5 días  
**Estado:** SPEC_APPROVED → Listo para implementación  
**Archivos afectados:**
- `src/components/publish/Step1Basic.tsx`
- `src/app/[locale]/publish/PublishForm.tsx`
- `messages/en.json`
- `messages/es.json`

**Sin cambios en API ni DB.**

---

## Historia de Usuario

Como creator publicando mi primer agente,  
quiero que el formulario de /publish me indique claramente cuáles campos son obligatorios con `*` rojo visible,  
y que la validación en frontend me muestre el error en el campo exacto (no un toast genérico),  
para no frustrarme intentando publicar sin saber qué falta.

---

## Contexto para el Dev

El campo `description` es requerido por el servidor (schema Zod) pero en `Step1Basic.tsx`:
1. No tiene `*` rojo en el label
2. No se valida en `handleNext()` antes de llamar al servidor
3. No limpia su error al editar
4. No tiene `data-field` attr para el foco automático

Adicionalmente, en `PublishForm.tsx`, el fallback `?? 'name'` en el mapeo de errores Zod puede pisar el campo `name` cuando el error real es en otro campo sin `path[0]`. Se cambia a `?? '_form'`.

Los strings de error hardcodeados en español en `handleNext()` se mueven a i18n.

---

## Criterios de Aceptación (ACs)

### AC1 — Descripción marcada como obligatoria visualmente
- [ ] Campo "Description" en Step1 tiene `*` rojo visible junto al label (`text-red-500`)
- [ ] Texto auxiliar "Mínimo 10 caracteres" (en) / "Mínimo 10 caracteres" (es) visible a la derecha del label en gris claro (`text-gray-400 text-xs`)

### AC2 — Validación client-side antes de llamar al servidor
- [ ] Al pulsar "Siguiente" con description vacía → error inline debajo del textarea, **NO se hace request POST/PATCH** (verificable en DevTools > Network)
- [ ] Al pulsar "Siguiente" con description de 9 caracteres → error inline (igual que vacío)
- [ ] Al pulsar "Siguiente" con description de 10+ caracteres → avanza (llama servidor)
- [ ] Al pulsar "Siguiente" con `name` < 3 chars → error inline debajo del input name
- [ ] Al pulsar "Siguiente" sin `category` → error inline debajo del select

### AC3 — Foco automático al primer campo con error
- [ ] Al intentar avanzar con campos inválidos → foco visible en el primer campo inválido (orden: name → description → category)
- [ ] El foco es funcional: el browser scrolls al campo si está fuera de viewport

### AC4 — Borde rojo + limpieza de error al editar
- [ ] Textarea `description` con error activo → `border-red-500`
- [ ] Input `name` con error activo → `border-red-500`
- [ ] Al escribir en `description` con error activo → borde vuelve a gris, error desaparece
- [ ] Al escribir en `name` con error activo → borde vuelve a gris, error desaparece (ya existente, verificar que sigue funcionando)

### AC5 — Mapeo de errores del servidor al campo correcto
- [ ] Si servidor retorna `{ fields: { description: "..." } }` → mensaje aparece debajo del textarea (ya funcionaba, verificar)
- [ ] Si servidor retorna error Zod `{ details: [{ path: ["description"], message: "..." }] }` → mensaje aparece debajo del textarea
- [ ] Si servidor retorna error Zod sin `path[0]` → va a `_form` (sin crash, sin pisar `name`)

### AC6 — Sin botón disabled para errores
- [ ] El botón "Siguiente" NO usa `disabled` para bloquear por errores de validación inline
- [ ] Sigue usando `disabled` solo cuando `saving === true` o `uploading === true`

### AC7 — Build limpio
- [ ] `tsc --noEmit` sin errores
- [ ] Sin warnings en consola del browser relacionados con keys i18n faltantes

---

## Implementación Exacta

### Cambio 1 — `src/components/publish/Step1Basic.tsx`

**Diff completo del componente:**

#### A) handleNext — agregar validación de description + foco automático + i18n

**Reemplazar:**
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

**Con:**
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

#### B) Input name — agregar data-field + borde rojo condicional

**Reemplazar:**
```tsx
<input
  type="text"
  value={data.name ?? ''}
  onChange={e => {
    onChange('name', e.target.value)
    if (localErrors.name) setLocalErrors(prev => { const e = { ...prev }; delete e.name; return e })
  }}
  placeholder="Ej: Traductor Español GPT"
  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100"
/>
```

**Con:**
```tsx
<input
  type="text"
  data-field="name"
  value={data.name ?? ''}
  onChange={e => {
    onChange('name', e.target.value)
    if (localErrors.name) setLocalErrors(prev => { const e = { ...prev }; delete e.name; return e })
  }}
  placeholder="Ej: Traductor Español GPT"
  className={`w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-avax-100 transition ${
    allErrors.name
      ? 'border-red-500 focus:border-red-500'
      : 'border-gray-200 focus:border-avax-400'
  }`}
/>
```

#### C) Label description — agregar `*` rojo + hint

**Reemplazar:**
```tsx
<label className="mb-1.5 block text-sm font-medium text-gray-700">Descripción</label>
```

**Con:**
```tsx
<label className="mb-1.5 block text-sm font-medium text-gray-700">
  {t('description')} <span className="text-red-500">*</span>
  <span className="ml-2 font-normal text-gray-400 text-xs">{t('descriptionHint')}</span>
</label>
```

#### D) Textarea description — agregar data-field + borde rojo condicional + limpiar error al editar

**Reemplazar:**
```tsx
<textarea
  value={data.description ?? ''}
  onChange={e => onChange('description', e.target.value)}
  placeholder="Describe qué hace tu agente, qué inputs acepta y qué outputs devuelve..."
  rows={4}
  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none focus:ring-2 focus:ring-avax-100"
/>
{allErrors.description && <p className="mt-1 text-xs text-red-500">{allErrors.description}</p>}
```

**Con:**
```tsx
<textarea
  data-field="description"
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

#### E) Select category — agregar data-field

**Reemplazar:**
```tsx
<select
  value={data.category ?? ''}
  onChange={e => {
    onChange('category', e.target.value)
    if (localErrors.category) setLocalErrors(prev => { const e = { ...prev }; delete e.category; return e })
  }}
  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none"
>
```

**Con:**
```tsx
<select
  data-field="category"
  value={data.category ?? ''}
  onChange={e => {
    onChange('category', e.target.value)
    if (localErrors.category) setLocalErrors(prev => { const e = { ...prev }; delete e.category; return e })
  }}
  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none"
>
```

---

### Cambio 2 — `src/app/[locale]/publish/PublishForm.tsx`

**Reemplazar (en `handleStep1Next`, dentro del loop `for`):**
```typescript
const field = issue.path[0] ?? 'name'
```

**Con:**
```typescript
const field = issue.path[0] ?? '_form'
```

> Contexto de la línea: es el fallback cuando un error Zod no tiene `path[0]`. Cambiando a `'_form'` evitamos que un error genérico sin path pise el campo `name`.

---

### Cambio 3 — `messages/en.json`

Dentro del objeto `"publish"`, **agregar** las siguientes keys (a nivel top del objeto publish, junto a `"description"` existente):

```json
"descriptionHint": "Min. 10 characters",
"descriptionPlaceholder": "Describe what your agent does, what inputs it accepts and what outputs it returns...",
"errors": {
  "nameMin": "Name must be at least 3 characters",
  "descriptionMin": "Description must be at least 10 characters",
  "categoryRequired": "Select a category"
}
```

**Resultado final del objeto `publish` en en.json** (solo las keys nuevas marcadas con `// NEW`):
```json
{
  "title": "Publish a Model",
  "subtitle": "List your AI model on WasiAI and earn USDC per call.",
  "coverImage": "Cover Image",
  "coverImageHint": "optional · max 5MB",
  "modelName": "Model Name",
  "slug": "Slug (URL)",
  "category": "Category",
  "pricePerCall": "Price per call (USDC)",
  "endpoint": "API Endpoint",
  "description": "Description",
  "descriptionHint": "Min. 10 characters",
  "descriptionPlaceholder": "Describe what your agent does, what inputs it accepts and what outputs it returns...",
  "revenueInfo": "You earn 90% of every call · WasiAI takes 10% · Paid instantly in USDC",
  "publishButton": "Publish Model →",
  "publishing": "Publishing...",
  "successTitle": "Model Published!",
  "successSubtitle": "Redirecting to dashboard...",
  "capabilities": "Capabilities",
  "addCapability": "+ Add Capability",
  "capabilityName": "Name",
  "capabilityDesc": "Description",
  "inputType": "Input",
  "outputType": "Output",
  "steps": {
    "basic": "Basic",
    "product": "Product",
    "technical": "Technical"
  },
  "preview": {
    "label": "Preview",
    "pricePlaceholder": "— USDC/call"
  },
  "draftModal": {
    "title": "You have an unpublished draft",
    "cta": "Continue draft",
    "discard": "Discard and start over"
  },
  "cta": {
    "next": "Next",
    "back": "Back",
    "publish": "Publish agent",
    "publishing": "Publishing..."
  },
  "errors": {
    "nameMin": "Name must be at least 3 characters",
    "descriptionMin": "Description must be at least 10 characters",
    "categoryRequired": "Select a category"
  }
}
```

---

### Cambio 4 — `messages/es.json`

Dentro del objeto `"publish"`, **agregar**:

```json
"descriptionHint": "Mín. 10 caracteres",
"descriptionPlaceholder": "Describe qué hace tu agente, qué inputs acepta y qué outputs devuelve...",
"errors": {
  "nameMin": "El nombre debe tener al menos 3 caracteres",
  "descriptionMin": "La descripción debe tener al menos 10 caracteres",
  "categoryRequired": "Selecciona una categoría"
}
```

**Resultado final del objeto `publish` en es.json:**
```json
{
  "title": "Publicar un Modelo",
  "subtitle": "Lista tu modelo de IA en WasiAI y gana USDC por cada llamada.",
  "coverImage": "Imagen de portada",
  "coverImageHint": "opcional · máx 5MB",
  "modelName": "Nombre del Modelo",
  "slug": "Slug (URL)",
  "category": "Categoría",
  "pricePerCall": "Precio por llamada (USDC)",
  "endpoint": "Endpoint de la API",
  "description": "Descripción",
  "descriptionHint": "Mín. 10 caracteres",
  "descriptionPlaceholder": "Describe qué hace tu agente, qué inputs acepta y qué outputs devuelve...",
  "revenueInfo": "Ganas el 90% de cada llamada · WasiAI toma el 10% · Pagado al instante en USDC",
  "publishButton": "Publicar Modelo →",
  "publishing": "Publicando...",
  "successTitle": "¡Modelo Publicado!",
  "successSubtitle": "Redirigiendo al dashboard...",
  "capabilities": "Capacidades",
  "addCapability": "+ Agregar Capacidad",
  "capabilityName": "Nombre",
  "capabilityDesc": "Descripción",
  "inputType": "Entrada",
  "outputType": "Salida",
  "steps": {
    "basic": "Básico",
    "product": "Producto",
    "technical": "Técnico"
  },
  "preview": {
    "label": "Vista previa",
    "pricePlaceholder": "— USDC/call"
  },
  "draftModal": {
    "title": "Tienes un borrador sin publicar",
    "cta": "Continuar borrador",
    "discard": "Descartar y empezar de nuevo"
  },
  "cta": {
    "next": "Siguiente",
    "back": "Atrás",
    "publish": "Publicar agente",
    "publishing": "Publicando..."
  },
  "errors": {
    "nameMin": "El nombre debe tener al menos 3 caracteres",
    "descriptionMin": "La descripción debe tener al menos 10 caracteres",
    "categoryRequired": "Selecciona una categoría"
  }
}
```

---

## Flujo completo post-implementación

```
Usuario en Step1 (/publish)
│
├─ name < 3 chars → [Siguiente] → error inline bajo name, foco al input
├─ description vacía → [Siguiente] → error inline "Mín. 10 caracteres", foco al textarea
├─ description 9 chars → [Siguiente] → igual que vacío
├─ sin category → [Siguiente] → error inline, foco al select
│
├─ Todo válido → [Siguiente] → llama POST /api/models (o PATCH)
│   ├─ Servidor 422 json.fields → setErrors → muestra bajo campo exacto
│   ├─ Servidor 422 json.details (Zod) → mapeo path[0] → campo exacto
│   │   └─ sin path[0] → va a '_form' (sin crash, sin pisar 'name')
│   └─ Servidor 200 → avanza a Step2
│
└─ Usuario escribe en campo con error → borde vuelve gris, mensaje desaparece
```

---

## DoD Checklist (Dev debe marcar todos antes de PR)

### Funcional
- [ ] 1. Campo "Descripción" muestra `*` rojo en el label
- [ ] 2. Texto auxiliar "Mín. 10 caracteres" visible junto al label
- [ ] 3. Pulsar [Siguiente] con description vacía → error inline, **sin request al servidor** (Network tab vacío)
- [ ] 4. Pulsar [Siguiente] con description de 9 chars → error inline
- [ ] 5. Pulsar [Siguiente] con description de 10 chars → avanza (request enviado correctamente)
- [ ] 6. Al escribir en description con error activo → error desaparece, borde vuelve gris
- [ ] 7. Borde rojo en textarea cuando hay error
- [ ] 8. Borde rojo en input name cuando hay error
- [ ] 9. Foco automático al primer campo inválido al pulsar [Siguiente]
- [ ] 10. Error de servidor `{ field: "description" }` → aparece bajo el textarea (probar con curl o mock)
- [ ] 11. Error Zod sin path[0] → no pisa campo `name`, va a `_form` (no se muestra inline, no hay crash)
- [ ] 12. Botón [Siguiente] NO usa `disabled` para errores de validación inline

### Técnico
- [ ] 13. Keys i18n en `en.json` y `es.json` presentes: `descriptionHint`, `descriptionPlaceholder`, `errors.nameMin`, `errors.descriptionMin`, `errors.categoryRequired`
- [ ] 14. Sin warnings de i18n en consola del browser (modo dev)
- [ ] 15. `npm run build` (o `tsc --noEmit`) sin errores TypeScript
- [ ] 16. Sin cambios en archivos de API (`/api/models`, `/api/creator/agents/*`)
- [ ] 17. Sin cambios en DB / migrations
- [ ] 18. Sin dependencias nuevas en `package.json`

---

## Notas para Dev

1. **`data-field` es atributo HTML estándar** — no requiere tipado extra en TypeScript
2. **`allErrors = { ...localErrors, ...errors }`** — servidor sobreescribe local. Sigue siendo correcto. No cambiar el merge.
3. **El placeholder de description** estaba hardcodeado en español en el TSX original. Se mueve a i18n en este story. Ambos idiomas reciben el mismo texto descriptivo (ya estaba en español; la key en.json recibe la traducción en inglés).
4. **`t('description')`** — la key `"description"` ya existe en ambos json files. Solo se le agrega el `*` rojo y el hint.
5. **No usar `disabled` para errores inline** — AC6 explícito. El button ya tiene `disabled={saving || uploading}` que se mantiene.
6. **Orden de foco:** `Object.keys(errs)[0]` respeta el orden en que se agregan al objeto `errs` en `handleNext`: name → description → category. Este orden es correcto.

---

*Story generado por SM — 2026-02-26*  
*Basado en: UX-08.md (HU) + SDD-UX-08.md (Spec) + código actual verificado*
