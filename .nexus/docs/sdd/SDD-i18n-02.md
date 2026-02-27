# SDD — i18n-02: Limpiar hardcodes español

**Sprint:** 5  
**HU de referencia:** `.nexus/docs/prd/i18n-02.md`  
**Estado:** SPEC_DRAFT — pendiente SPEC_APPROVED de Fer  
**Fecha SDD:** 2026-02-26  
**Autor:** PM Agent (BMAD v6)

---

## 1. Verificación de tipos de componente

| Archivo | Tipo | Hook a usar | Observaciones |
|---------|------|-------------|---------------|
| `Step1Basic.tsx` | Client Component (`'use client'`) | `useTranslations()` | Ya importa `useTranslations('publish')` — ampliar |
| `Step2Product.tsx` | Client Component (`'use client'`) | `useTranslations()` | Ya importa `useTranslations('publish')` — ampliar |
| `PublishForm.tsx` | **Client Component** (`'use client'` + `useState`) | `useTranslations()` | ✅ Confirmado: usa `useState`, `useRouter`, `useParams`. Agregar import |
| `WalletSetup.tsx` | Client Component (`'use client'`) | `useTranslations()` | Sin `useTranslations` aún — agregar |
| `OnboardingStep1.tsx` | Client Component (`'use client'`) | `useTranslations()` | Ya importa `useTranslations('onboarding.step1')` — ampliar |

---

## 2. Inventario exacto de hardcodes por archivo

### 2.1 Step1Basic.tsx

| String hardcodeado | Key i18n propuesta | ¿Existe en messages? |
|-------------------|-------------------|---------------------|
| `"Información básica"` | `publish.step1.title` | ❌ Nueva |
| `"Nombre, descripción y categoría de tu agente"` | `publish.step1.subtitle` | ❌ Nueva |
| `"Imagen de portada"` | `publish.coverImage` | ✅ Existe |
| `"(opcional · máx 5MB)"` | `publish.coverImageHint` | ✅ Existe |
| `"Subiendo a IPFS…"` | `publish.step1.uploadingIPFS` | ❌ Nueva |
| `"Click o arrastra aquí"` | `publish.step1.dropHint` | ❌ Nueva |
| `"Nombre del agente"` (label) | `publish.step1.agentName` | ❌ Nueva |
| `"Descripción"` (label) | `publish.description` | ✅ Existe |
| `"Categoría"` (label) | `publish.category` | ✅ Existe |
| `"Selecciona una categoría"` (option placeholder) | `publish.step1.selectCategory` | ❌ Nueva |
| `"Guardando…"` (botón) | `common.saving` | ❌ Nueva |
| `'El nombre debe tener al menos 3 caracteres'` (error inline) | `publish.step1.errorNameMin` | ❌ Nueva |
| `'Selecciona una categoría'` (error inline) | reusar `publish.step1.selectCategory` | ❌ Nueva (misma key) |

**Namespace activo:** `publish` → agregar `useTranslations('common')` para `saving`.  
**Nota de implementación:** El archivo ya tiene `const t = useTranslations('publish')`. Agregar `const tCommon = useTranslations('common')` para `tCommon('saving')`.

---

### 2.2 Step2Product.tsx

| String hardcodeado | Key i18n propuesta | ¿Existe en messages? |
|-------------------|-------------------|---------------------|
| `"Producto"` (h2 title) | `publish.step2.title` | ❌ Nueva |
| `"Precio, modelo base y capacidades"` (subtitle) | `publish.step2.subtitle` | ❌ Nueva |
| `"Precio por llamada (USDC)"` (label) | `publish.pricePerCall` | ✅ Existe |
| `"Ganas el 90% por cada llamada · WasiAI toma el 10%"` | `publish.revenueInfo` | ✅ Existe (valor levemente distinto — ver nota) |
| `"Modelo base"` (label) | `publish.step2.baseModel` | ❌ Nueva |
| `"Capacidades"` (label) | `publish.step2.capabilitiesLabel` | ❌ Nueva (`publish.capabilities` existe pero es string distinto) |
| `"(JSON array · opcional)"` (hint) | `publish.step2.capabilitiesHint` | ❌ Nueva |
| `"Guardando…"` (botón) | `common.saving` | ❌ Nueva (misma key) |
| `'Debe ser un array JSON'` (error) | `publish.step2.errorCapabilitiesArray` | ❌ Nueva |
| `'JSON inválido'` (error) | `publish.step2.errorCapabilitiesJson` | ❌ Nueva |
| `'El precio debe ser mayor a 0'` (error) | `publish.step2.errorPriceMin` | ❌ Nueva |

**Nota `revenueInfo`:** El JSON actual dice `"You earn 90% of every call · WasiAI takes 10% · Paid instantly in USDC"` pero el componente muestra `"Ganas el 90% por cada llamada · WasiAI toma el 10%"` (versión corta). Usar `publish.revenueInfo` y actualizar el valor en ambos JSONs a la versión corta del componente, o agregar `publish.step2.revenueHint` como key nueva. **Decisión: agregar `publish.step2.revenueHint`** para no romper otros usos de `publish.revenueInfo`.

---

### 2.3 PublishForm.tsx ✅ confirmado Client Component

| String hardcodeado | Key i18n propuesta | ¿Existe en messages? |
|-------------------|-------------------|---------------------|
| `'Error al guardar'` (error name fallback) | `publish.form.errorSaving` | ❌ Nueva |
| `'Error al publicar — intenta de nuevo'` | `publish.form.errorPublishing` | ❌ Nueva |
| `"Tienes un borrador sin publicar"` (modal h2) | `publish.draftModal.title` | ✅ Existe |
| `"¿Quieres continuar donde lo dejaste?"` (modal p) | `publish.draftModal.subtitle` | ❌ Nueva (fuera de AC, anotar para backlog) |
| `"Continuar borrador"` (modal btn) | `publish.draftModal.cta` | ✅ Existe |
| `"Descartar"` (modal btn corto) | `common.cancel` | ✅ Existe (`common.cancel`) |
| `"Publicar agente"` (h1 página) | `publish.title` | ✅ Existe (valor: "Publish a Model" — actualizar a "Publish agent") |
| `"Lista tu agente de IA…"` (h1 subtitle) | `publish.subtitle` | ✅ Existe |

**Scope AC-3:** Solo `publish.form.errorSaving` y `publish.form.errorPublishing` son las 2 keys nuevas requeridas.  
**Agregar import:** `import { useTranslations } from 'next-intl'` + `const t = useTranslations('publish')`

---

### 2.4 WalletSetup.tsx

| String hardcodeado | Key i18n propuesta | ¿Existe en messages? |
|-------------------|-------------------|---------------------|
| `"Guardando…"` (botón) | `common.saving` | ❌ Nueva |
| `"Guardar"` (botón) | `common.save` | ✅ Existe |
| `"Editar"` (btn) | `common.edit` | ✅ Existe (fuera de AC) |
| `"Cancelar"` (btn) | `common.cancel` | ✅ Existe (fuera de AC) |

**Namespace:** `common` — `useTranslations('common')` cubre ambos: `t('save')` y `t('saving')`.  
**Strings fuera de AC-4** (errores de wallet address, mensaje de wallet no configurada): notar para i18n-03 si se decide ampliar scope.

---

### 2.5 OnboardingStep1.tsx

| String hardcodeado | Key i18n propuesta | ¿Existe en messages? |
|-------------------|-------------------|---------------------|
| `'Error al guardar perfil'` (throw fallback) | `onboarding.step1.errorSavingProfile` | ❌ Nueva |
| `'Guardando…'` (botón) | `common.saving` | ❌ Nueva (misma key compartida) |
| `'El nombre es requerido'` (error inline) | `onboarding.step1.errorNameRequired` | ❌ Nueva (fuera de AC) |
| `"Nombre"` (label) | `onboarding.step1.nameLabel` | ❌ Nueva (fuera de AC) |
| `"Bio"` (label) | `onboarding.step1.bioLabel` | ❌ Nueva (fuera de AC) |

**Scope AC-5:** Solo `errorSavingProfile` y `saving` (via `common.saving`).  
**Nota:** El componente ya usa `const t = useTranslations('onboarding.step1')`. Agregar `const tCommon = useTranslations('common')` para `tCommon('saving')`.

---

## 3. Keys nuevas — valores completos en/es

### 3.1 Resumen de keys a agregar

#### `common` namespace (agregar en ambos archivos)

```json
// en.json — dentro de "common": { ... }
"saving": "Saving…"

// es.json — dentro de "common": { ... }
"saving": "Guardando…"
```

#### `publish.step1` namespace (nuevo sub-objeto)

```json
// en.json — dentro de "publish": { ... }
"step1": {
  "title": "Basic Information",
  "subtitle": "Name, description and category of your agent",
  "uploadingIPFS": "Uploading to IPFS…",
  "dropHint": "Click or drag here",
  "agentName": "Agent name",
  "selectCategory": "Select a category",
  "errorNameMin": "Name must be at least 3 characters"
}

// es.json — dentro de "publish": { ... }
"step1": {
  "title": "Información básica",
  "subtitle": "Nombre, descripción y categoría de tu agente",
  "uploadingIPFS": "Subiendo a IPFS…",
  "dropHint": "Click o arrastra aquí",
  "agentName": "Nombre del agente",
  "selectCategory": "Selecciona una categoría",
  "errorNameMin": "El nombre debe tener al menos 3 caracteres"
}
```

#### `publish.step2` namespace (nuevo sub-objeto)

```json
// en.json — dentro de "publish": { ... }
"step2": {
  "title": "Product",
  "subtitle": "Price, base model and capabilities",
  "baseModel": "Base model",
  "capabilitiesLabel": "Capabilities",
  "capabilitiesHint": "JSON array · optional",
  "revenueHint": "You earn 90% per call · WasiAI takes 10%",
  "errorCapabilitiesArray": "Must be a JSON array",
  "errorCapabilitiesJson": "Invalid JSON",
  "errorPriceMin": "Price must be greater than 0"
}

// es.json — dentro de "publish": { ... }
"step2": {
  "title": "Producto",
  "subtitle": "Precio, modelo base y capacidades",
  "baseModel": "Modelo base",
  "capabilitiesLabel": "Capacidades",
  "capabilitiesHint": "JSON array · opcional",
  "revenueHint": "Ganas el 90% por cada llamada · WasiAI toma el 10%",
  "errorCapabilitiesArray": "Debe ser un array JSON",
  "errorCapabilitiesJson": "JSON inválido",
  "errorPriceMin": "El precio debe ser mayor a 0"
}
```

#### `publish.form` namespace (nuevo sub-objeto)

```json
// en.json — dentro de "publish": { ... }
"form": {
  "errorSaving": "Error saving",
  "errorPublishing": "Error publishing — please try again"
}

// es.json — dentro de "publish": { ... }
"form": {
  "errorSaving": "Error al guardar",
  "errorPublishing": "Error al publicar — intenta de nuevo"
}
```

#### `onboarding.step1` (agregar a sub-objeto existente)

```json
// en.json — dentro de "onboarding": { "step1": { ... } }
"errorSavingProfile": "Error saving profile"

// es.json — dentro de "onboarding": { "step1": { ... } }
"errorSavingProfile": "Error al guardar perfil"
```

---

## 4. Cambios por archivo — guía de implementación

### Step1Basic.tsx
```tsx
// Agregar segundo useTranslations
const t = useTranslations('publish')
const tCommon = useTranslations('common')

// Reemplazos:
// h2: "Información básica"  →  t('step1.title')
// p subtitle  →  t('step1.subtitle')
// label "Imagen de portada"  →  t('coverImage')
// "(opcional · máx 5MB)"  →  t('coverImageHint')
// "Subiendo a IPFS…"  →  t('step1.uploadingIPFS')
// "Click o arrastra aquí"  →  t('step1.dropHint')
// label "Nombre del agente"  →  t('step1.agentName')
// label "Descripción"  →  t('description')
// label "Categoría"  →  t('category')
// option "Selecciona una categoría"  →  t('step1.selectCategory')
// error 'Selecciona una categoría'  →  t('step1.selectCategory')
// error 'El nombre debe tener...'  →  t('step1.errorNameMin')
// botón "Guardando…"  →  tCommon('saving')
```

### Step2Product.tsx
```tsx
// Agregar segundo useTranslations
const t = useTranslations('publish')
const tCommon = useTranslations('common')

// Reemplazos:
// h2 "Producto"  →  t('step2.title')
// p subtitle  →  t('step2.subtitle')
// label "Precio por llamada..."  →  t('pricePerCall')
// hint revenue  →  t('step2.revenueHint')
// label "Modelo base"  →  t('step2.baseModel')
// label "Capacidades"  →  t('step2.capabilitiesLabel')
// "(JSON array · opcional)"  →  t('step2.capabilitiesHint')
// error 'Debe ser un array JSON'  →  t('step2.errorCapabilitiesArray')
// error 'JSON inválido'  →  t('step2.errorCapabilitiesJson')
// error 'El precio debe ser...'  →  t('step2.errorPriceMin')
// botón "Guardando…"  →  tCommon('saving')
```

### PublishForm.tsx
```tsx
// Agregar import y hook
import { useTranslations } from 'next-intl'
const t = useTranslations('publish')

// Reemplazos scope AC-3:
// 'Error al guardar' (fallback error name)  →  t('form.errorSaving')
// 'Error al publicar — intenta de nuevo'  →  t('form.errorPublishing')
```

### WalletSetup.tsx
```tsx
// Agregar import y hook
import { useTranslations } from 'next-intl'
const t = useTranslations('common')

// Reemplazos scope AC-4:
// "Guardando…"  →  t('saving')
// "Guardar"  →  t('save')
```

### OnboardingStep1.tsx
```tsx
// Ya tiene: const t = useTranslations('onboarding.step1')
// Agregar segundo hook:
const tCommon = useTranslations('common')

// Reemplazos scope AC-5:
// 'Error al guardar perfil' (en catch/throw)  →  t('errorSavingProfile')
// 'Guardando…' (botón)  →  tCommon('saving')
```

---

## 5. Colisión / duplicados — verificación

| Key propuesta | ¿Colisiona con existente? | Resolución |
|--------------|--------------------------|------------|
| `common.saving` | No existe (solo `common.loading`) | ✅ Seguro agregar |
| `publish.step1.*` | No existe `publish.step1` | ✅ Seguro |
| `publish.step2.*` | No existe `publish.step2` | ✅ Seguro |
| `publish.form.*` | No existe `publish.form` | ✅ Seguro |
| `publish.capabilities` | Existe → NO usar. Usar `publish.step2.capabilitiesLabel` | ✅ Separado |
| `publish.revenueInfo` | Existe pero valor difiere → NO tocar. Usar `publish.step2.revenueHint` | ✅ Separado |
| `common.save` | Existe con valor "Save" / "Guardar" | ✅ Reusar sin crear nueva |
| `common.edit` / `common.cancel` | Existen | ✅ Reusar (fuera de scope AC) |
| `onboarding.step1.errorSavingProfile` | No existe | ✅ Seguro agregar |

---

## 6. Definición de Hecho (DoD) — verificable

### Automático (CI/CD)
- [ ] `next build` pasa sin errores ni warnings nuevos
- [ ] No hay `console.error` de next-intl (`MISSING_MESSAGE`) en ningún locale

### Manual — `/en/publish`
- [ ] Step1: título "Basic Information", categoría dropdown muestra "Select a category", botón muestra "Saving…" al guardar, IPFS muestra "Uploading to IPFS…"
- [ ] Step2: título "Product", labels "Base model", "Capabilities", botón muestra "Saving…"
- [ ] PublishForm: error de guardar muestra "Error saving", error de publicar muestra "Error publishing — please try again"

### Manual — `/es/publish`
- [ ] Todos los strings anteriores en español correcto sin mezcla

### Manual — `/en/dashboard` y `/en/onboarding`
- [ ] WalletSetup: botón "Save" (no "Guardar"), estado loading "Saving…"
- [ ] OnboardingStep1: error "Error saving profile", botón loading "Saving…"

### Manual — `/es/dashboard` y `/es/onboarding`
- [ ] WalletSetup: "Guardar" y "Guardando…" correctos
- [ ] OnboardingStep1: "Error al guardar perfil" y "Guardando…" correctos

### Code Review
- [ ] No quedan strings en español hardcodeados en los 5 archivos (grep `"Guardando"` → 0 resultados en src/)
- [ ] Doble `useTranslations` por componente donde aplica — patrón aprobado por next-intl
- [ ] Keys en `en.json` y `es.json` simétricas (mismo árbol JSON)
- [ ] PR aprobado formalmente

---

## 7. Riesgos residuales

| Riesgo | Impacto | Mitigación |
|--------|---------|-----------|
| `useTranslations` llamado dos veces por componente | Bajo | next-intl soporta múltiples llamadas; patrón documentado |
| `publish.revenueInfo` y nuevo `publish.step2.revenueHint` con copy levemente diferente | Bajo | Keys distintas, sin conflicto. Anotar para unificar en i18n-03 |
| Strings fuera de AC (validaciones inline, modal subtitle) quedan en español | Bajo | Aceptado en scope. Registrar en backlog i18n-03 |
| `WalletSetup` sin next-intl provider en el árbol | Medio | Verificar que el layout de `/[locale]/creator/dashboard` incluye el NextIntlClientProvider |

---

## 8. Out of scope (registrado para backlog)

Los siguientes strings hardcodeados fueron identificados pero quedan fuera de esta HU por scope quirúrgico:

- `PublishForm.tsx`: modal subtitle `"¿Quieres continuar donde lo dejaste?"`, página h1/subtitle, botón "Descartar"
- `Step1Basic.tsx`: placeholder de input nombre (`"Ej: Traductor Español GPT"`), placeholder textarea descripción, PNG/JPG hint
- `Step2Product.tsx`: placeholder input base_model, placeholder textarea capabilities
- `WalletSetup.tsx`: mensaje advertencia wallet, error validación dirección hex, mensaje éxito `"✅ Wallet guardada"`
- `OnboardingStep1.tsx`: error `"El nombre es requerido"`, labels Nombre/Bio

→ Candidatos para **i18n-03**.

---

## Estado del Gate

```
[ ] SPEC_APPROVED — pendiente revisión de Fer
```
