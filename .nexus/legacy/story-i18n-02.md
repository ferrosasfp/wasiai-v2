# Story: i18n-02 — Limpiar hardcodes español en /publish, WalletSetup y onboarding

**Sprint:** 5
**Épica:** Tech Debt / i18n
**Prioridad:** Alta
**Estimación:** M (3–5 pts)
**Estado gate:** HU_APPROVED ✅ | SPEC_APPROVED ✅
**Generado:** 2026-02-26 por SM Agent (BMAD v6)
**Refs:** `.nexus/docs/prd/i18n-02.md` · `.nexus/docs/sdd/SDD-i18n-02.md`

---

## Historia de Usuario

> **Como** usuario del marketplace WasiAI,
> **quiero** que la interfaz de publicación de agentes, el setup de wallet y el onboarding
> se muestren en el idioma correcto según mi preferencia de locale,
> **para que** no vea strings mezclados en español cuando el locale activo es inglés (`/en/`).

---

## Contexto

La configuración de `next-intl` ya existe y funciona (`defaultLocale = 'en'`, archivos `messages/en.json` y `messages/es.json` presentes). Los componentes de publicación (`Step1Basic`, `Step2Product`, `PublishForm`), `WalletSetup` y `OnboardingStep1` conservan strings hardcodeados en español. Esta HU cierra esa deuda técnica con scope quirúrgico.

**Archivos de mensajes actuales:**
- `common.save` → existe ✅ ("Save" / "Guardar")
- `common.loading` → existe ✅ — pero NO `common.saving`
- `publish.coverImage`, `publish.coverImageHint`, `publish.description`, `publish.category`, `publish.pricePerCall` → existen ✅
- `publish.capabilities` → existe pero con valor distinto al que usa Step2Product — NO reusar
- `publish.revenueInfo` → existe pero texto largo diferente — NO reusar

---

## Acceptance Criteria

### AC-1 — Step1Basic.tsx internacionalizado
- [ ] `"Información básica"` (h2) → `t('step1.title')`
- [ ] `"Nombre, descripción y categoría de tu agente"` (p) → `t('step1.subtitle')`
- [ ] `"Imagen de portada"` (label) → `t('coverImage')` *(key ya existe)*
- [ ] `"(opcional · máx 5MB)"` (span hint) → `t('coverImageHint')` *(key ya existe)*
- [ ] `"Subiendo a IPFS…"` (estado uploading) → `t('step1.uploadingIPFS')`
- [ ] `"Click o arrastra aquí"` (drop zone) → `t('step1.dropHint')`
- [ ] `"Nombre del agente"` (label) → `t('step1.agentName')`
- [ ] `"Descripción"` (label) → `t('description')` *(key ya existe)*
- [ ] `"Categoría"` (label) → `t('category')` *(key ya existe)*
- [ ] `"Selecciona una categoría"` (option placeholder) → `t('step1.selectCategory')`
- [ ] `'Selecciona una categoría'` (error inline) → `t('step1.selectCategory')`
- [ ] `'El nombre debe tener al menos 3 caracteres'` (error) → `t('step1.errorNameMin')`
- [ ] `'Guardando…'` (botón) → `tCommon('saving')`
- [ ] En `/en/publish` toda la UI de Step 1 aparece en inglés.
- [ ] En `/es/publish` toda la UI de Step 1 aparece en español.

### AC-2 — Step2Product.tsx internacionalizado
- [ ] `"Producto"` (h2) → `t('step2.title')`
- [ ] `"Precio, modelo base y capacidades"` (p) → `t('step2.subtitle')`
- [ ] `"Precio por llamada (USDC)"` (label) → `t('pricePerCall')` *(key ya existe)*
- [ ] `"Ganas el 90% por cada llamada · WasiAI toma el 10%"` (hint) → `t('step2.revenueHint')`
- [ ] `"Modelo base"` (label) → `t('step2.baseModel')`
- [ ] `"Capacidades"` (label) → `t('step2.capabilitiesLabel')`
- [ ] `"(JSON array · opcional)"` (span hint) → `t('step2.capabilitiesHint')`
- [ ] `'Debe ser un array JSON'` (error) → `t('step2.errorCapabilitiesArray')`
- [ ] `'JSON inválido'` (error) → `t('step2.errorCapabilitiesJson')`
- [ ] `'El precio debe ser mayor a 0'` (error) → `t('step2.errorPriceMin')`
- [ ] `'Guardando…'` (botón) → `tCommon('saving')`
- [ ] Comportamiento bilingüe validado en ambos locales.

### AC-3 — PublishForm.tsx internacionalizado
- [ ] `'Error al guardar'` (fallback en 3 lugares de setErrors) → `t('form.errorSaving')`
- [ ] `'Error al publicar — intenta de nuevo'` → `t('form.errorPublishing')`
- [ ] Agregar `import { useTranslations } from 'next-intl'` y `const t = useTranslations('publish')`.
- [ ] Los mensajes de error se muestran en el locale activo.

### AC-4 — WalletSetup.tsx internacionalizado
- [ ] `'Guardando…'` (botón loading) → `t('saving')` donde `t = useTranslations('common')`
- [ ] `'Guardar'` (botón) → `t('save')` *(key ya existe en common)*
- [ ] Agregar `import { useTranslations } from 'next-intl'` y `const t = useTranslations('common')`.
- [ ] Botón muestra "Saving…" en `/en/` y "Guardando…" en `/es/`.

### AC-5 — OnboardingStep1.tsx internacionalizado
- [ ] `'Error al guardar perfil'` (fallback en `throw new Error`) → `t('errorSavingProfile')`
- [ ] `'Guardando…'` (botón loading) → `tCommon('saving')`
- [ ] Agregar `const tCommon = useTranslations('common')` (el `const t = useTranslations('onboarding.step1')` ya existe).
- [ ] En `/en/onboarding` los textos de error y botón loading aparecen en inglés.

### AC-6 — Claves en archivos de mensajes
- [ ] Todas las claves nuevas en `messages/en.json` con valor en inglés correcto.
- [ ] Todas las claves nuevas en `messages/es.json` con valor en español correcto.
- [ ] Ninguna key nueva colisiona con las existentes.
- [ ] Árbol JSON simétrico entre `en.json` y `es.json`.

### AC-7 — Sin regresión
- [ ] `next build` pasa sin errores ni warnings nuevos.
- [ ] No hay `MISSING_MESSAGE` en consola del browser para ningún locale.
- [ ] Flujo completo de publicación funciona en `/en/publish` y `/es/publish`.
- [ ] No se rompe ningún test existente.

---

## Tabla exacta: archivo → string hardcodeado → key i18n

### `src/components/publish/Step1Basic.tsx`

| String en código | Key i18n | ¿Existe? | Namespace |
|-----------------|----------|----------|-----------|
| `"Información básica"` | `publish.step1.title` | ❌ Nueva | `t` |
| `"Nombre, descripción y categoría de tu agente"` | `publish.step1.subtitle` | ❌ Nueva | `t` |
| `"Imagen de portada"` | `publish.coverImage` | ✅ Existe | `t` |
| `"(opcional · máx 5MB)"` | `publish.coverImageHint` | ✅ Existe | `t` |
| `"Subiendo a IPFS…"` | `publish.step1.uploadingIPFS` | ❌ Nueva | `t` |
| `"Click o arrastra aquí"` | `publish.step1.dropHint` | ❌ Nueva | `t` |
| `"Nombre del agente"` | `publish.step1.agentName` | ❌ Nueva | `t` |
| `"Descripción"` | `publish.description` | ✅ Existe | `t` |
| `"Categoría"` | `publish.category` | ✅ Existe | `t` |
| `"Selecciona una categoría"` (option) | `publish.step1.selectCategory` | ❌ Nueva | `t` |
| `'Selecciona una categoría'` (error) | `publish.step1.selectCategory` | ❌ Nueva | `t` |
| `'El nombre debe tener al menos 3 caracteres'` | `publish.step1.errorNameMin` | ❌ Nueva | `t` |
| `'Guardando…'` | `common.saving` | ❌ Nueva | `tCommon` |

### `src/components/publish/Step2Product.tsx`

| String en código | Key i18n | ¿Existe? | Namespace |
|-----------------|----------|----------|-----------|
| `"Producto"` | `publish.step2.title` | ❌ Nueva | `t` |
| `"Precio, modelo base y capacidades"` | `publish.step2.subtitle` | ❌ Nueva | `t` |
| `"Precio por llamada (USDC)"` | `publish.pricePerCall` | ✅ Existe | `t` |
| `"Ganas el 90% por cada llamada · WasiAI toma el 10%"` | `publish.step2.revenueHint` | ❌ Nueva | `t` |
| `"Modelo base"` | `publish.step2.baseModel` | ❌ Nueva | `t` |
| `"Capacidades"` | `publish.step2.capabilitiesLabel` | ❌ Nueva | `t` |
| `"(JSON array · opcional)"` | `publish.step2.capabilitiesHint` | ❌ Nueva | `t` |
| `'Debe ser un array JSON'` | `publish.step2.errorCapabilitiesArray` | ❌ Nueva | `t` |
| `'JSON inválido'` | `publish.step2.errorCapabilitiesJson` | ❌ Nueva | `t` |
| `'El precio debe ser mayor a 0'` | `publish.step2.errorPriceMin` | ❌ Nueva | `t` |
| `'Guardando…'` | `common.saving` | ❌ Nueva | `tCommon` |

### `src/app/[locale]/publish/PublishForm.tsx`

| String en código | Key i18n | ¿Existe? | Namespace |
|-----------------|----------|----------|-----------|
| `'Error al guardar'` (3 ocurrencias en setErrors) | `publish.form.errorSaving` | ❌ Nueva | `t` |
| `'Error al publicar — intenta de nuevo'` | `publish.form.errorPublishing` | ❌ Nueva | `t` |

### `src/components/WalletSetup.tsx`

| String en código | Key i18n | ¿Existe? | Namespace |
|-----------------|----------|----------|-----------|
| `'Guardando…'` | `common.saving` | ❌ Nueva | `t` |
| `'Guardar'` | `common.save` | ✅ Existe | `t` |

### `src/components/onboarding/OnboardingStep1.tsx`

| String en código | Key i18n | ¿Existe? | Namespace |
|-----------------|----------|----------|-----------|
| `'Error al guardar perfil'` | `onboarding.step1.errorSavingProfile` | ❌ Nueva | `t` |
| `'Guardando…'` | `common.saving` | ❌ Nueva | `tCommon` |

---

## Keys nuevas — valores completos para en.json y es.json

### Cambios en `messages/en.json`

```json
// 1. Agregar dentro de "common": { ... }
"saving": "Saving…",

// 2. Agregar dentro de "publish": { ... } (nuevos sub-objetos)
"step1": {
  "title": "Basic Information",
  "subtitle": "Name, description and category of your agent",
  "uploadingIPFS": "Uploading to IPFS…",
  "dropHint": "Click or drag here",
  "agentName": "Agent name",
  "selectCategory": "Select a category",
  "errorNameMin": "Name must be at least 3 characters"
},
"step2": {
  "title": "Product",
  "subtitle": "Price, base model and capabilities",
  "revenueHint": "You earn 90% per call · WasiAI takes 10%",
  "baseModel": "Base model",
  "capabilitiesLabel": "Capabilities",
  "capabilitiesHint": "JSON array · optional",
  "errorCapabilitiesArray": "Must be a JSON array",
  "errorCapabilitiesJson": "Invalid JSON",
  "errorPriceMin": "Price must be greater than 0"
},
"form": {
  "errorSaving": "Error saving",
  "errorPublishing": "Error publishing — please try again"
},

// 3. Agregar dentro de "onboarding": { "step1": { ... } }
"errorSavingProfile": "Error saving profile"
```

### Cambios en `messages/es.json`

```json
// 1. Agregar dentro de "common": { ... }
"saving": "Guardando…",

// 2. Agregar dentro de "publish": { ... } (nuevos sub-objetos)
"step1": {
  "title": "Información básica",
  "subtitle": "Nombre, descripción y categoría de tu agente",
  "uploadingIPFS": "Subiendo a IPFS…",
  "dropHint": "Click o arrastra aquí",
  "agentName": "Nombre del agente",
  "selectCategory": "Selecciona una categoría",
  "errorNameMin": "El nombre debe tener al menos 3 caracteres"
},
"step2": {
  "title": "Producto",
  "subtitle": "Precio, modelo base y capacidades",
  "revenueHint": "Ganas el 90% por cada llamada · WasiAI toma el 10%",
  "baseModel": "Modelo base",
  "capabilitiesLabel": "Capacidades",
  "capabilitiesHint": "JSON array · opcional",
  "errorCapabilitiesArray": "Debe ser un array JSON",
  "errorCapabilitiesJson": "JSON inválido",
  "errorPriceMin": "El precio debe ser mayor a 0"
},
"form": {
  "errorSaving": "Error al guardar",
  "errorPublishing": "Error al publicar — intenta de nuevo"
},

// 3. Agregar dentro de "onboarding": { "step1": { ... } }
"errorSavingProfile": "Error al guardar perfil"
```

---

## Patrón de implementación por componente

### Step1Basic.tsx

**Situación actual:** Tiene `const t = useTranslations('publish')`. Falta `tCommon`.

```tsx
// AGREGAR junto al t existente:
const tCommon = useTranslations('common')

// REEMPLAZOS (en orden de aparición en el JSX):

// h2
- "Información básica"
+ {t('step1.title')}

// p subtitle
- "Nombre, descripción y categoría de tu agente"
+ {t('step1.subtitle')}

// label "Imagen de portada"
- "Imagen de portada"
+ {t('coverImage')}

// span hint
- "(opcional · máx 5MB)"
+ {t('coverImageHint')}

// p estado uploading en drop zone
- "Subiendo a IPFS…"
+ {t('step1.uploadingIPFS')}

// p drop hint en drop zone
- "Click o arrastra aquí"
+ {t('step1.dropHint')}

// label "Nombre del agente"
- "Nombre del agente"
+ {t('step1.agentName')}

// label "Descripción"
- "Descripción"
+ {t('description')}

// label "Categoría"
- "Categoría"
+ {t('category')}

// option placeholder del select
- "Selecciona una categoría"
+ {t('step1.selectCategory')}

// handleNext() — errores inline:
- errs.name = 'El nombre debe tener al menos 3 caracteres'
+ errs.name = t('step1.errorNameMin')

- errs.category = 'Selecciona una categoría'
+ errs.category = t('step1.selectCategory')

// botón submit:
- {saving ? 'Guardando…' : t('cta.next')}
+ {saving ? tCommon('saving') : t('cta.next')}
```

---

### Step2Product.tsx

**Situación actual:** Tiene `const t = useTranslations('publish')`. Falta `tCommon`.

```tsx
// AGREGAR junto al t existente:
const tCommon = useTranslations('common')

// REEMPLAZOS:

// h2
- "Producto"
+ {t('step2.title')}

// p subtitle
- "Precio, modelo base y capacidades"
+ {t('step2.subtitle')}

// label precio (ya existe publish.pricePerCall)
- "Precio por llamada (USDC)"
+ {t('pricePerCall')}

// p revenue hint
- "Ganas el 90% por cada llamada · WasiAI toma el 10%"
+ {t('step2.revenueHint')}

// label Modelo base
- "Modelo base"
+ {t('step2.baseModel')}

// label Capacidades
- "Capacidades"
+ {t('step2.capabilitiesLabel')}

// span hint capacidades
- "(JSON array · opcional)"
+ {t('step2.capabilitiesHint')}

// handleCapabilitiesBlur() — errores:
- setCapabilitiesError('Debe ser un array JSON')
+ setCapabilitiesError(t('step2.errorCapabilitiesArray'))

- setCapabilitiesError('JSON inválido')
+ setCapabilitiesError(t('step2.errorCapabilitiesJson'))

// handleNext() — errores:
- errs.price_per_call = 'El precio debe ser mayor a 0'
+ errs.price_per_call = t('step2.errorPriceMin')

// botón submit:
- {saving ? 'Guardando…' : t('cta.next')}
+ {saving ? tCommon('saving') : t('cta.next')}
```

> **Nota:** `handleCapabilitiesBlur` y `handleNext` usan `setCapabilitiesError` y `setLocalErrors` que son state setters llamados fuera del render. Los hooks `useTranslations` son llamados al tope del componente y sus funciones `t`/`tCommon` son closures disponibles en todos los handlers — esto es correcto y no viola las rules of hooks.

---

### PublishForm.tsx

**Situación actual:** NO tiene `useTranslations`. Es Client Component (`'use client'` + `useState`, `useRouter`, `useParams`).

```tsx
// AGREGAR imports y hook al tope del componente:
import { useTranslations } from 'next-intl'

// Dentro de la función PublishForm():
const t = useTranslations('publish')

// REEMPLAZOS — handleStep1Next():
- setErrors({ name: (json.error as string) ?? 'Error al guardar' })
+ setErrors({ name: (json.error as string) ?? t('form.errorSaving') })

// handleStep2Next():
- setErrors((json.fields as Record<string, string>) ?? { price_per_call: (json.error as string) ?? 'Error al guardar' })
+ setErrors((json.fields as Record<string, string>) ?? { price_per_call: (json.error as string) ?? t('form.errorSaving') })

// handlePublish() — patchRes error:
- setErrors((json.fields as Record<string, string>) ?? { endpoint_url: (json.error as string) ?? 'Error al guardar' })
+ setErrors((json.fields as Record<string, string>) ?? { endpoint_url: (json.error as string) ?? t('form.errorSaving') })

// handlePublish() — statusRes error:
- setErrors({ endpoint_url: 'Error al publicar — intenta de nuevo' })
+ setErrors({ endpoint_url: t('form.errorPublishing') })
```

---

### WalletSetup.tsx

**Situación actual:** NO tiene `useTranslations`.

```tsx
// AGREGAR:
import { useTranslations } from 'next-intl'

// Dentro de WalletSetup():
const t = useTranslations('common')

// REEMPLAZOS en JSX:
- {loading ? 'Guardando…' : 'Guardar'}
+ {loading ? t('saving') : t('save')}
```

---

### OnboardingStep1.tsx

**Situación actual:** Tiene `const t = useTranslations('onboarding.step1')`. Falta `tCommon`.

```tsx
// AGREGAR junto al t existente:
const tCommon = useTranslations('common')

// REEMPLAZOS:

// handleSubmit() — en el throw:
- throw new Error(data.error ?? 'Error al guardar perfil')
+ throw new Error(data.error ?? t('errorSavingProfile'))

// botón submit:
- {loading ? 'Guardando…' : t('cta')}
+ {loading ? tCommon('saving') : t('cta')}
```

---

## Verificación de colisiones

| Key propuesta | Colisiona | Estado |
|--------------|-----------|--------|
| `common.saving` | No existe (solo `common.loading`) | ✅ Seguro |
| `publish.step1.*` | No existe `publish.step1` como objeto | ✅ Seguro |
| `publish.step2.*` | No existe `publish.step2` como objeto | ✅ Seguro |
| `publish.form.*` | No existe `publish.form` como objeto | ✅ Seguro |
| `publish.step2.capabilitiesLabel` | `publish.capabilities` existe pero es key diferente | ✅ Separado |
| `publish.step2.revenueHint` | `publish.revenueInfo` existe pero valor difiere | ✅ Separado |
| `common.save` | Existe → se reutiliza sin crear nueva | ✅ Reusar |
| `onboarding.step1.errorSavingProfile` | No existe en el objeto actual | ✅ Seguro |

---

## Out of scope — registrado para i18n-03

Los siguientes hardcodes fueron identificados pero quedan fuera de esta HU por scope quirúrgico:

**PublishForm.tsx:**
- Modal: `"¿Quieres continuar donde lo dejaste?"`, `"Continuar borrador"`, `"Descartar"`, `"Tienes un borrador sin publicar"`
- Página: `"Publicar agente"` (h1), `"Lista tu agente de IA en WasiAI…"` (subtitle)

**Step1Basic.tsx:**
- Placeholders: `"Ej: Traductor Español GPT"` (input nombre), `"Describe qué hace tu agente…"` (textarea), `"PNG, JPG, WebP, GIF"` (hint)

**Step2Product.tsx:**
- Placeholders: `"Ej: gpt-4o, llama-3, mistral-7b…"` (base_model input)
- Placeholder complejo textarea capabilities (JSON)

**WalletSetup.tsx:**
- `"Editar"`, `"Cancelar"` (ya existen en `common.edit`/`common.cancel`), pero no están conectados
- `"Dirección inválida — debe ser 0x seguido de 40 caracteres hex"` (validación)
- `"⚠️ Sin wallet configurada — agrega tu dirección EVM para recibir pagos"` (advertencia)
- `"✅ Wallet guardada correctamente"` (éxito)
- `"Error guardando wallet"` (catch fallback)

**OnboardingStep1.tsx:**
- `'El nombre es requerido'` (validación inline)
- `"Nombre"` (label), `"Bio"` (label)

---

## DoD Checklist

### Código
- [ ] `grep -r '"Guardando' src/` → 0 resultados
- [ ] `grep -r "'Guardando" src/` → 0 resultados
- [ ] `grep -r '"Error al guardar"' src/` → 0 resultados
- [ ] `grep -r '"Error al publicar"' src/` → 0 resultados
- [ ] `grep -r '"Información básica"' src/` → 0 resultados
- [ ] `grep -r '"Producto"' src/components/publish/` → 0 resultados
- [ ] No hay `any` explícito nuevo introducido
- [ ] `useTranslations` solo llamado al tope del componente (no en condicionales ni loops)

### Build
- [ ] `next build` pasa sin errores
- [ ] No hay warnings nuevos en build output
- [ ] No hay `MISSING_MESSAGE` en consola del browser (dev mode)

### Manual QA — `/en/publish`
- [ ] Step 1: título "Basic Information", hint "optional · max 5MB", uploading "Uploading to IPFS…", drop hint "Click or drag here", label "Agent name", placeholder select "Select a category", errores en inglés, botón "Saving…" al guardar
- [ ] Step 2: título "Product", subtitle "Price, base model and capabilities", hint "You earn 90% per call · WasiAI takes 10%", labels "Base model"/"Capabilities", hint "JSON array · optional", errores en inglés, botón "Saving…"
- [ ] PublishForm: errores de red/guardado en inglés ("Error saving", "Error publishing — please try again")

### Manual QA — `/es/publish`
- [ ] Todos los strings anteriores en español correcto sin mezcla

### Manual QA — `/en/` creator dashboard / onboarding
- [ ] WalletSetup: botón "Save" (reposo), "Saving…" (loading)
- [ ] OnboardingStep1: botón "Saving…" durante submit, error de red "Error saving profile"

### Manual QA — `/es/` creator dashboard / onboarding
- [ ] WalletSetup: "Guardar" / "Guardando…"
- [ ] OnboardingStep1: "Guardando…" / "Error al guardar perfil"

### Code Review
- [ ] PR revisado formalmente por Fer
- [ ] Árbol JSON simétrico entre `en.json` y `es.json` (mismas keys, misma jerarquía)
- [ ] `common.saving` no duplicado con `common.loading`
- [ ] Ningún Server Component usa `useTranslations` (todos los archivos en scope son Client Components ✅)
- [ ] Patrón doble `useTranslations` por componente aprobado (soportado por next-intl)

---

## Notas de implementación para el Dev

1. **Orden sugerido:** Empezar por `messages/en.json` y `messages/es.json` (agregar todas las keys), luego componentes de dentro hacia afuera: `OnboardingStep1` → `WalletSetup` → `Step1Basic` → `Step2Product` → `PublishForm`.

2. **Doble `useTranslations`:** next-intl soporta múltiples llamadas por componente. El patrón `t = useTranslations('publish')` + `tCommon = useTranslations('common')` es válido y documentado.

3. **`handleNext` y handlers async:** Las funciones `t()` y `tCommon()` son closures del render — disponibles en todos los event handlers sin necesidad de nada especial.

4. **PublishForm.tsx:** El archivo actualmente NO importa `useTranslations`. Agregar el import de `'next-intl'` y el hook como primera declaración dentro de la función `PublishForm()`.

5. **`common.saving` vs `common.loading`:** Son keys distintas con propósito distinto. `loading` = "Loading..." (genérico, para skeletons), `saving` = "Saving…" (acción de guardado en progreso). Mantener separadas.

6. **Verificar provider:** Confirmar que el layout de `/[locale]/creator/dashboard/` incluye `NextIntlClientProvider` en su árbol para que `WalletSetup` pueda usar `useTranslations`. Si no, agregar el provider al layout correspondiente.

7. **Carácter especial `·`:** El punto medio (U+00B7) en strings como `"optional · max 5MB"` debe copiarse literal al JSON — es válido en UTF-8.
