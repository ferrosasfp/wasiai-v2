# S1 — SDD: i18n-01 Traducción Completa de la DApp

**HU:** i18n-01  
**Tipo:** Deuda técnica — i18n / Copy  
**Gate:** SPEC_APPROVED (pendiente de Fer)  
**PM:** San (agente BMAD)  
**Fecha:** 2026-02-27  
**No requiere migrations de DB**

---

## 1. Auditoría: Keys faltantes en `es.json` vs `en.json`

### 1.1 Paridad estructural
✅ **Ambos archivos tienen exactamente las mismas keys** (0 keys faltantes en ninguna dirección).

Secciones top-level presentes en ambos:
`common`, `home`, `auth`, `marketplace`, `publish`, `dashboard`, `onboarding`, `trial`, `analytics`, `creator_profile`, `docs`, `codeExamples`

### 1.2 Keys con valor idéntico en EN y ES (sin traducir o aceptablemente igual)

| Key | Valor (mismo en ambos) | ¿Requiere traducción? |
|-----|------------------------|----------------------|
| `analytics.title` | `"Analytics"` | ✅ Sí → `"Analítica"` |
| `analytics.earnings` | `"Earnings"` | ✅ Sí → `"Ganancias"` |
| `analytics.uptime` | `"Uptime (24h)"` | ⚠️ Opcional — "Uptime" es tecnicismo aceptado |
| `common.appName` | `"WasiAI"` | ✅ Correcto — nombre de marca |
| `common.pageNotFound` | `"404"` | ✅ Correcto — código HTTP |
| `docs.sdkNode` | `"SDK Node.js"` | ✅ Correcto — nombre técnico |
| `docs.sdkPython` | `"SDK Python"` | ✅ Correcto — nombre técnico |
| `marketplace.categories.audio` | `"Audio"` | ✅ Correcto — término universal |
| `marketplace.categories.multimodal` | `"Multimodal"` | ✅ Correcto — término técnico |
| `marketplace.title` | `"Marketplace"` | ⚠️ Opcional — "Mercado" es válido, pero "Marketplace" se usa en contexto Web3 LA |
| `publish.capabilityNumber` | `"Capability {n}"` | ✅ Sí → `"Capacidad {n}"` |
| `publish.preview.pricePlaceholder` | `"— USDC/call"` | ⚠️ Aceptable — USDC/call es universal |
| `publish.slug` | `"Slug (URL)"` | ⚠️ Aceptable — slug es término técnico |

**Resumen:** 2 keys requieren traducción inmediata (`analytics.title`, `analytics.earnings`), 1 más (`publish.capabilityNumber`). El resto son términos técnicos o nombres de marca correctamente compartidos.

---

## 2. Keys con terminología incorrecta: `modelo → agente`

### 2.1 En `messages/en.json` — Keys con "Model" que deben ser "Agent"

| Key actual | Valor actual | → Key nueva | → Valor nuevo |
|-----------|-------------|------------|--------------|
| `publish.title` | `"Publish a Model"` | (misma key) | `"Publish an Agent"` |
| `publish.subtitle` | `"List your AI model on WasiAI and earn USDC per call."` | (misma key) | `"List your AI agent on WasiAI and earn USDC per call."` |
| `publish.modelName` | `"Model Name"` | `publish.agentName` | `"Agent Name"` |
| `publish.publishButton` | `"Publish Model →"` | (misma key) | `"Publish Agent →"` |
| `publish.successTitle` | `"Model Published!"` | (misma key) | `"Agent Published!"` |
| `publish.step2.subtitle` | `"Price, base model and capabilities"` | (misma key) | `"Price, base model and capabilities"` *(mantener — "base model" aquí es el LLM subyacente, no el producto)* |
| `publish.step2.baseModel` | `"Base model"` | (misma key) | `"Base model"` *(mantener — es el LLM base)* |
| `dashboard.totalModels` | `"Total Models"` | `dashboard.totalAgents` | `"Total Agents"` |
| `dashboard.yourModels` | `"Your Models"` | `dashboard.yourAgents` | `"Your Agents"` |
| `dashboard.publishModel` | `"+ Publish Model"` | `dashboard.publishAgent` | `"+ Publish Agent"` |
| `dashboard.noModels` | `"No models yet"` | `dashboard.noAgents` | `"No agents yet"` |
| `dashboard.noModelsSubtitle` | `"Publish your first model to start earning."` | `dashboard.noAgentsSubtitle` | `"Publish your first agent to start earning."` |
| `dashboard.noCallsSubtitle` | `"Calls to your models will appear here in real time."` | (misma key) | `"Calls to your agents will appear here in real time."` |

### 2.2 En `messages/es.json` — Keys con "Modelo" que deben ser "Agente"

| Key | Valor actual | → Valor nuevo |
|-----|-------------|--------------|
| `publish.title` | `"Publicar un Modelo"` | `"Publicar un Agente"` |
| `publish.subtitle` | `"Lista tu modelo de IA en WasiAI y gana USDC por cada llamada."` | `"Lista tu agente de IA en WasiAI y gana USDC por cada llamada."` |
| `publish.modelName` | `"Nombre del Modelo"` | key rename → `publish.agentName`: `"Nombre del Agente"` |
| `publish.publishButton` | `"Publicar Modelo →"` | `"Publicar Agente →"` |
| `publish.successTitle` | `"¡Modelo Publicado!"` | `"¡Agente Publicado!"` |
| `publish.step2.subtitle` | `"Precio, modelo base y capacidades"` | `"Precio, modelo base y capacidades"` *(mantener — "modelo base" = LLM subyacente)* |
| `publish.step2.baseModel` | `"Modelo base"` | `"Modelo base"` *(mantener — es el LLM base)* |
| `dashboard.totalModels` | `"Total de Modelos"` | key rename → `dashboard.totalAgents`: `"Total de Agentes"` |
| `dashboard.yourModels` | `"Tus Modelos"` | key rename → `dashboard.yourAgents`: `"Tus Agentes"` |
| `dashboard.publishModel` | `"+ Publicar Modelo"` | key rename → `dashboard.publishAgent`: `"+ Publicar Agente"` |
| `dashboard.noModels` | `"Sin modelos todavía"` | key rename → `dashboard.noAgents`: `"Sin agentes todavía"` |
| `dashboard.noModelsSubtitle` | `"Publica tu primer modelo para empezar a ganar."` | key rename → `dashboard.noAgentsSubtitle`: `"Publica tu primer agente para empezar a ganar."` |
| `dashboard.noCallsSubtitle` | `"Las llamadas a tus modelos aparecerán aquí en tiempo real."` | `"Las llamadas a tus agentes aparecerán aquí en tiempo real."` |
| `analytics.earnings` | `"Earnings"` | `"Ganancias"` |
| `analytics.title` | `"Analytics"` | `"Analítica"` |

> **Nota crítica sobre renombrado de keys:** Las keys `publish.modelName`, `dashboard.totalModels`, `dashboard.yourModels`, `dashboard.publishModel`, `dashboard.noModels`, `dashboard.noModelsSubtitle` requieren renombrado. Se deben buscar **todos los componentes** que las consumen con `grep -rn "dashboard.totalModels\|dashboard.yourModels\|etc"` antes de renombrar.

---

## 3. Componentes con strings hardcodeados detectados

### 3.1 Hallazgos confirmados por grep

| Archivo | Línea(s) | String hardcodeado | Acción requerida |
|---------|---------|-------------------|-----------------|
| `src/components/WasiNavBar.tsx` | 10, 12, 14 | `label: 'Marketplace'`, `'Dashboard'`, `'Docs'` | Migrar a `t('nav.marketplace')`, etc. |
| `src/components/WasiNavBar.tsx` | 143, 159, 215, 231 | `"Sign out"`, `"Sign up"` | Migrar a `t('auth.signOut')`, `t('auth.signUp')` |
| `src/features/creator/components/CreatorAnalytics.tsx` | 96 | `"Analytics"` (heading) | Migrar a `t('analytics.title')` |
| `src/features/creator/components/CreatorAnalytics.tsx` | 105 | `"Todos los agentes"` hardcoded en ES | Migrar a `t('analytics.all_agents')` |
| `src/app/[locale]/creator/dashboard/page.tsx` | 104, 105, 106 | `"Total Models"`, `"Active"`, `"Total Calls"` | Migrar a keys i18n |
| `src/app/[locale]/creator/dashboard/page.tsx` | 138, 218, 271 | `"No models yet"`, subtítulos, copy de agentes autónomos | Migrar a keys i18n |
| `src/app/[locale]/models/[slug]/page.tsx` | 223, 227, 231, 235, 239 | `"Protocol"`, `"Network"`, `"Currency"`, `"Total calls"`, `"Creator earns"` | Migrar a keys i18n bajo `marketplace.agentDetail.*` |
| `src/app/[locale]/agent-keys/page.tsx` | 183, 200, 217, 252, 313, 339, 341, 343 | Múltiples strings mixtos EN/ES sobre USDC, warnings | Migrar a keys i18n bajo `agentKeys.*` |
| `src/app/[locale]/agent-keys/page.tsx` | 472, 566, 568 | Mix español hardcodeado | Migrar a keys i18n |

### 3.2 Secciones con hardcodes potenciales (requieren revisión visual)

- `src/features/models/components/CodeExamples.tsx` — no usa `useTranslations`; labels de "Copy", "How to use" en inglés probable
- `src/features/payments/components/PayToCallButton.tsx` — no usa `useTranslations`; estados "Loading", "Pay" en inglés
- `src/app/[locale]/creator/agents/[slug]/edit/EditAgentForm.tsx` — no usa `useTranslations`; formulario de edición
- `src/app/[locale]/creator/dashboard/_components/FreeTrialToggle.tsx` — no usa `useTranslations`
- `src/features/docs/content/` — todos los archivos de docs son contenido estático hardcodeado; labels sí deben traducirse

---

## 4. Plan de implementación ordenado

> **Regla de oro:** Lo que no usa `useTranslations` pero está en un componente de UI = hardcode. Lo que está en JSON pero tiene valor igual en EN y ES = sin traducir.  
> **Orden:** Primero JSON (sin riesgo de romper build) → luego keys renombradas (con búsqueda previa) → luego componentes (migración a `useTranslations`) → finalmente revisión visual.

### Fase 1 — Correcciones en JSON (0 riesgo de build break)

**1.1 — Traducir keys sin traducir en `es.json`:**
```json
"analytics": {
  "title": "Analítica",       // era "Analytics"
  "earnings": "Ganancias",    // era "Earnings"
}
"publish": {
  "capabilityNumber": "Capacidad {n}"  // era "Capability {n}"
}
```

**1.2 — Corregir terminología modelo→agente en `en.json` (solo valores, misma key por ahora):**
```json
"publish": {
  "title": "Publish an Agent",
  "subtitle": "List your AI agent on WasiAI and earn USDC per call.",
  "publishButton": "Publish Agent →",
  "successTitle": "Agent Published!",
}
"dashboard": {
  "noCallsSubtitle": "Calls to your agents will appear here in real time.",
}
```

**1.3 — Corregir terminología modelo→agente en `es.json` (solo valores, misma key):**
```json
"publish": {
  "title": "Publicar un Agente",
  "subtitle": "Lista tu agente de IA en WasiAI y gana USDC por cada llamada.",
  "publishButton": "Publicar Agente →",
  "successTitle": "¡Agente Publicado!",
}
"dashboard": {
  "noCallsSubtitle": "Las llamadas a tus agentes aparecerán aquí en tiempo real.",
}
"analytics": {
  "title": "Analítica",
  "earnings": "Ganancias",
}
```

### Fase 2 — Renombrado de keys (requiere actualizar componentes simultáneamente)

Antes de cada rename, ejecutar:
```bash
grep -rn "publish\.modelName\|dashboard\.totalModels\|dashboard\.yourModels\|dashboard\.publishModel\|dashboard\.noModels\|dashboard\.noModelsSubtitle" src/
```

**Renombres a realizar (en ambos JSON + todos los componentes que las usan):**

| Key vieja | Key nueva |
|-----------|----------|
| `publish.modelName` | `publish.agentName` |
| `dashboard.totalModels` | `dashboard.totalAgents` |
| `dashboard.yourModels` | `dashboard.yourAgents` |
| `dashboard.publishModel` | `dashboard.publishAgent` |
| `dashboard.noModels` | `dashboard.noAgents` |
| `dashboard.noModelsSubtitle` | `dashboard.noAgentsSubtitle` |

Ejecutar `next build` después de cada rename para confirmar sin errores TypeScript.

### Fase 3 — Migración de componentes a `useTranslations`

**Orden por impacto/complejidad:**

1. **`WasiNavBar.tsx`** — Nav labels y auth buttons (alta visibilidad, baja complejidad)
   - Añadir `const t = useTranslations('nav')` y `useTranslations('auth')`
   - Agregar keys `nav.marketplace`, `nav.dashboard`, `nav.docs`, `auth.signOut`, `auth.signUp` a ambos JSON

2. **`CreatorAnalytics.tsx`** — Heading y filtro "Todos los agentes"
   - Añadir `useTranslations('analytics')`
   - Reemplazar hardcodes con `t('title')` y `t('all_agents')`

3. **`src/app/[locale]/creator/dashboard/page.tsx`** — StatCards y EmptyState
   - Añadir `useTranslations('dashboard')`
   - Reemplazar `"Total Models"` con `t('totalAgents')`, etc.

4. **`src/app/[locale]/models/[slug]/page.tsx`** — Ficha de agente
   - Añadir keys bajo `marketplace.agentDetail.*`: `protocol`, `network`, `currency`, `totalCalls`, `creatorEarns`
   - Migrar 5 `<span>` hardcodeados

5. **`src/app/[locale]/agent-keys/page.tsx`** — Página de API keys
   - Añadir sección `agentKeys.*` en ambos JSON con todas las strings identificadas
   - Migrar los ~8 strings hardcodeados

6. **`PayToCallButton.tsx`**, **`FreeTrialToggle.tsx`**, **`EditAgentForm.tsx`** — Formularios y CTAs
   - Revisar cada componente, mapear strings, añadir al JSON, migrar

7. **`CodeExamples.tsx`** — Labels de código (Copy, How to use, etc.)
   - Añadir bajo `codeExamples.*` o `common.*`

8. **Docs content** (`src/features/docs/content/*.tsx`) — Labels de navegación y UI
   - Solo labels/UI, no el contenido técnico del código

### Fase 4 — Verificación y cierre

1. `pnpm build` (o `next build`) → 0 errores TypeScript
2. Revisión visual de cada página en modo ES (ver §5)
3. Script de auditoría automática (ver §5)

---

## 5. Criterio de verificación: cómo confirmar 0 strings sin traducir

### 5.1 Script de auditoría de paridad JSON

```bash
# Ejecutar desde raíz del proyecto
node -e "
const en = require('./messages/en.json');
const es = require('./messages/es.json');
function flat(obj, p='') {
  return Object.entries(obj).flatMap(([k,v]) =>
    typeof v === 'object' ? flat(v, p ? p+'.'+k : k) : [[p ? p+'.'+k : k, v]]
  );
}
const enF = Object.fromEntries(flat(en));
const esF = Object.fromEntries(flat(es));
const enKeys = Object.keys(enF);
const esKeys = Object.keys(esF);
const missingInEs = enKeys.filter(k => !esKeys.includes(k));
const untranslated = enKeys.filter(k => esKeys.includes(k) && enF[k] === esF[k] && !['WasiAI','404','SDK Node.js','SDK Python','Audio','Multimodal','Marketplace','Uptime (24h)','— USDC/call','Slug (URL)'].includes(enF[k]));
console.log('Missing in ES:', missingInEs);
console.log('Possibly untranslated:', untranslated);
"
```

**Criterio de pase:** `Missing in ES: []` y `Possibly untranslated: []`

### 5.2 Grep de hardcodes residuales

```bash
# Detectar strings visibles en JSX que no pasan por t()
# Buscar texto visible hardcodeado EN inglés en componentes bajo [locale]
grep -rn --include="*.tsx" -E \
  '>(Analytics|Earnings|Total (Models|Agents|Calls)|Your (Models|Agents)|Publish (Model|Agent)|No (models|agents) yet|Sign (out|up)|Marketplace|Dashboard|Protocol|Network|Currency|Creator earns|Total calls)<' \
  src/ | grep -v "//\|t(\|useTranslations"
```

**Criterio de pase:** 0 resultados (o solo en comentarios).

### 5.3 Revisión visual por página (checklist)

| Página | URL (modo ES) | Items a verificar |
|--------|--------------|-------------------|
| Home | `/?locale=es` | Hero, CTAs, stats, tabs |
| Marketplace | `/marketplace?locale=es` | Categorías, cards, filtros, paginación |
| Ficha agente | `/models/[slug]?locale=es` | Labels metadata, botones, trial |
| Dashboard | `/creator/dashboard?locale=es` | Stats, tabla de agentes, analytics |
| Publicar | `/creator/publish?locale=es` | Form completo, steps, preview |
| Agent Keys | `/agent-keys?locale=es` | Todos los modales y warnings |
| Docs | `/docs?locale=es` | Nav lateral, labels de Try it |
| 404 | `/ruta-inexistente` (ES) | Título, mensaje, CTA |

**Criterio de pase:** 0 strings en inglés visibles en UI al navegar en modo ES.

### 5.4 Build check final

```bash
pnpm build
# Criterio: exit code 0, 0 TypeScript errors, 0 warnings sobre missing keys de next-intl
```

---

## 6. Sin migrations de DB

✅ Esta HU es **100% frontend/copy**. No se toca:
- Supabase (tablas, RLS, funciones)
- Contratos on-chain
- API routes (solo si producen mensajes de error visibles en UI — esos van a JSON)
- Variables de entorno

---

## 7. Definition of Done

- [ ] `analytics.title` = "Analítica" en es.json
- [ ] `analytics.earnings` = "Ganancias" en es.json  
- [ ] `publish.capabilityNumber` = "Capacidad {n}" en es.json
- [ ] Todos los valores "modelo" → "agente" corregidos en ambos JSON (publish.*, dashboard.*)
- [ ] Keys renombradas (`totalModels→totalAgents`, etc.) en JSON **y** en todos los componentes que las consumen
- [ ] `WasiNavBar.tsx` — nav labels y auth buttons usando `useTranslations`
- [ ] `CreatorAnalytics.tsx` — "Analytics" heading y "Todos los agentes" usando `useTranslations`
- [ ] `creator/dashboard/page.tsx` — StatCards y EmptyState usando `useTranslations`
- [ ] `models/[slug]/page.tsx` — 5 labels de metadata usando `useTranslations`
- [ ] `agent-keys/page.tsx` — todos los strings hardcodeados migrados a JSON
- [ ] `PayToCallButton.tsx`, `FreeTrialToggle.tsx`, `EditAgentForm.tsx` auditados y migrados
- [ ] Script de auditoría retorna 0 keys faltantes y 0 sin traducir
- [ ] Grep de hardcodes retorna 0 resultados
- [ ] Revisión visual completa: todas las páginas en modo ES sin texto inglés visible
- [ ] `pnpm build` limpio (exit 0, 0 errores TypeScript)
- [ ] Deploy en Vercel validado con URL de preview en ES

---

## 8. Implementation Readiness Check

| Check | Estado | Notas |
|-------|--------|-------|
| S0 aprobado (HU_APPROVED) | ⏳ Pendiente | Requiere aprobación explícita de Fer |
| Scope claro y acotado | ✅ | Solo UI/copy, sin DB, sin nuevos idiomas |
| Auditoría de keys completada | ✅ | 0 keys faltantes; 2-3 sin traducir identificadas |
| Terminología incorrecta mapeada | ✅ | 13 keys/valores documentados con rename exacto |
| Hardcodes identificados | ✅ | 9 archivos con strings hardcodeados documentados |
| Plan de implementación ordenado | ✅ | 4 fases en orden seguro (JSON → rename → componentes → verify) |
| Criterio de verificación definido | ✅ | Script + grep + visual + build |
| Sin dependencias externas | ✅ | No requiere nuevas dependencias npm |
| Sin riesgo de regresión en EN | ✅ | Cambios en ES son aditivos; EN se corrige terminología únicamente |
| Riesgo renombrado de keys | ⚠️ | Mitigado con grep previo + build check tras cada rename |
| Branch sugerido | `feat/i18n-01-translation-audit` | |
| Estimación | 2-3 sesiones dev | Fase 1 (30min) + Fase 2-3 (2-3h) + Fase 4 (1h) |

---

*Generado por San (agente PM BMAD) · 2026-02-27*  
*Gate siguiente: SPEC_APPROVED explícito de Fer antes de proceder a Story (SM)*
