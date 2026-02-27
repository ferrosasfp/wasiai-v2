# Story: i18n-01 — Traducción Completa de la DApp

**Estado:** READY_FOR_DEV  
**Épica:** Calidad de Producto / UX  
**Prioridad:** P1 (bloquea lanzamiento con audiencia latina)  
**Branch:** `feat/i18n-01-translation-audit`  
**Estimación:** ~4h (Fase 1: 30min · Fase 2: 45min · Fase 3: 2h · Fase 4: 45min)  
**Fecha:** 2026-02-27  

---

## Contexto (por qué existe esta story)

WasiAI tiene i18n con next-intl (EN/ES) pero presenta dos clases de problemas:

- **Clase A — Terminología incorrecta:** El copy mezcla "modelo/model" con "agente/agent". El producto es un marketplace de *agentes*, no de *modelos* (término heredado del template NexusFactory). Confunde al usuario y diluye el posicionamiento.
- **Clase B — Strings sin traducir:** Algunas keys de `es.json` tienen el mismo valor que `en.json` (no fueron traducidas). Varios componentes tienen texto hardcodeado en JSX que no pasa por `useTranslations`.

**Impacto:** Un creator latinoamericano que llega en español ve mezcla de inglés/español, y términos incorrectos. Frena conversión y el pitch a comunidades Web3/AI latinas.

**Scope:** 100% frontend/copy. Sin migrations de DB. Sin cambios a contratos. Sin nuevos idiomas.

---

## User Stories

- **US-01 (Creator ES):** Como creator latinoamericano, quiero ver toda la interfaz en español correcto y consistente, para sentir que WasiAI es un producto terminado.
- **US-02 (Consumer ES):** Como developer que prefiere español, quiero que el marketplace, fichas de agente y errores estén completamente en español cuando selecciono ES.
- **US-03 (Usuario EN):** Como developer angloparlante, quiero ver "agent" (no "model") en toda la UI en modo EN.
- **US-04 (Dev/PM):** Como dev o PM, quiero todo el copy en los archivos JSON (sin hardcodes en JSX), para poder iterar copy sin tocar componentes.

---

## Criterios de Aceptación

- [ ] **AC-01** — Toda key con "model/modelo" como concepto de producto renombrada/corregida a "agent/agente" en ambos JSON y en los componentes que las consumen.
- [ ] **AC-02** — `analytics.title` = "Analítica" en es.json (era "Analytics").
- [ ] **AC-03** — `analytics.earnings` = "Ganancias" en es.json (era "Earnings").
- [ ] **AC-04** — `publish.capabilityNumber` = "Capacidad {n}" en es.json (era "Capability {n}").
- [ ] **AC-05** — `WasiNavBar.tsx`: nav labels y auth buttons usando `useTranslations` (no hardcodeados).
- [ ] **AC-06** — `CreatorAnalytics.tsx`: heading "Analytics" y filtro "Todos los agentes" usando `useTranslations`.
- [ ] **AC-07** — `creator/dashboard/page.tsx`: StatCards y EmptyState usando `useTranslations`.
- [ ] **AC-08** — `models/[slug]/page.tsx`: 5 labels de metadata usando `useTranslations`.
- [ ] **AC-09** — `agent-keys/page.tsx`: todos los strings hardcodeados migrados a JSON y `useTranslations`.
- [ ] **AC-10** — `PayToCallButton.tsx`, `FreeTrialToggle.tsx`, `EditAgentForm.tsx`: auditados y migrados si tienen hardcodes.
- [ ] **AC-11** — `CodeExamples.tsx`: auditado y migrado si tiene hardcodes.
- [ ] **AC-12** — Script de auditoría JSON retorna 0 keys faltantes y 0 sin traducir (ver §6).
- [ ] **AC-13** — `pnpm build` limpio: exit 0, 0 errores TypeScript, 0 warnings de next-intl sobre keys faltantes.
- [ ] **AC-14** — Revisión visual: todas las páginas listadas en §7 muestran 0 strings en inglés al navegar en modo ES.
- [ ] **AC-15** — Deploy en Vercel validado con URL de preview en modo ES.

---

## FASE 1 — Correcciones en JSON (sin riesgo de build break)

Hacer estos cambios primero. No tocan componentes. Se pueden hacer y commitear de forma segura.

### 1.1 — Keys sin traducir en `es.json` (3 cambios)

Abrir `messages/es.json` y aplicar exactamente:

```json
// analytics (buscar "analytics": { ... })
"analytics": {
  "title": "Analítica",      // CAMBIAR: era "Analytics"
  "earnings": "Ganancias",   // CAMBIAR: era "Earnings"
  ...
}

// publish (buscar "capabilityNumber")
"publish": {
  ...
  "capabilityNumber": "Capacidad {n}",  // CAMBIAR: era "Capability {n}"
  ...
}
```

### 1.2 — Corregir terminología modelo→agente en `en.json` (solo valores, misma key)

Los siguientes valores deben cambiarse en `messages/en.json`. Las keys NO se renombran todavía en este paso (eso es Fase 2).

| Key | Valor actual | Valor nuevo |
|-----|-------------|-------------|
| `publish.title` | `"Publish a Model"` | `"Publish an Agent"` |
| `publish.subtitle` | `"List your AI model on WasiAI and earn USDC per call."` | `"List your AI agent on WasiAI and earn USDC per call."` |
| `publish.publishButton` | `"Publish Model →"` | `"Publish Agent →"` |
| `publish.successTitle` | `"Model Published!"` | `"Agent Published!"` |
| `dashboard.noCallsSubtitle` | `"Calls to your models will appear here in real time."` | `"Calls to your agents will appear here in real time."` |

> ⚠️ NO cambiar `publish.step2.baseModel` ni `publish.step2.subtitle`. "base model" aquí refiere al LLM subyacente (GPT-4, Claude, etc.), no al producto WasiAI.

### 1.3 — Corregir terminología modelo→agente en `es.json` (solo valores, misma key)

Los siguientes valores deben cambiarse en `messages/es.json`. Las keys NO se renombran todavía (eso es Fase 2).

| Key | Valor actual | Valor nuevo |
|-----|-------------|-------------|
| `publish.title` | `"Publicar un Modelo"` | `"Publicar un Agente"` |
| `publish.subtitle` | `"Lista tu modelo de IA en WasiAI y gana USDC por cada llamada."` | `"Lista tu agente de IA en WasiAI y gana USDC por cada llamada."` |
| `publish.publishButton` | `"Publicar Modelo →"` | `"Publicar Agente →"` |
| `publish.successTitle` | `"¡Modelo Publicado!"` | `"¡Agente Publicado!"` |
| `dashboard.noCallsSubtitle` | `"Las llamadas a tus modelos aparecerán aquí en tiempo real."` | `"Las llamadas a tus agentes aparecerán aquí en tiempo real."` |
| `analytics.title` | `"Analytics"` | `"Analítica"` |
| `analytics.earnings` | `"Earnings"` | `"Ganancias"` |
| `publish.capabilityNumber` | `"Capability {n}"` | `"Capacidad {n}"` |

> ⚠️ NO cambiar `publish.step2.baseModel` ("Modelo base") ni `publish.step2.subtitle` ("Precio, modelo base y capacidades").

---

## FASE 2 — Renombrado de keys (requiere actualizar JSON + componentes simultáneamente)

Las siguientes keys deben renombrarse en AMBOS JSON y en todos los componentes que las consumen.

### 2.1 — Tabla de renombres

| Key vieja | Key nueva | Valor EN nuevo | Valor ES nuevo |
|-----------|-----------|----------------|----------------|
| `publish.modelName` | `publish.agentName` | `"Agent Name"` | `"Nombre del Agente"` |
| `dashboard.totalModels` | `dashboard.totalAgents` | `"Total Agents"` | `"Total de Agentes"` |
| `dashboard.yourModels` | `dashboard.yourAgents` | `"Your Agents"` | `"Tus Agentes"` |
| `dashboard.publishModel` | `dashboard.publishAgent` | `"+ Publish Agent"` | `"+ Publicar Agente"` |
| `dashboard.noModels` | `dashboard.noAgents` | `"No agents yet"` | `"Sin agentes todavía"` |
| `dashboard.noModelsSubtitle` | `dashboard.noAgentsSubtitle` | `"Publish your first agent to start earning."` | `"Publica tu primer agente para empezar a ganar."` |

### 2.2 — Buscar usos de cada key ANTES de renombrar

Ejecutar desde la raíz del proyecto para encontrar todos los componentes que consumen estas keys:

```bash
grep -rn \
  "publish\.modelName\|dashboard\.totalModels\|dashboard\.yourModels\|dashboard\.publishModel\|dashboard\.noModels\b\|dashboard\.noModelsSubtitle" \
  src/
```

### 2.3 — Procedimiento de renombrado (por cada key)

1. Renombrar en `messages/en.json`
2. Renombrar en `messages/es.json`
3. Actualizar todos los componentes detectados en el grep anterior (cambiar `t('dashboard.totalModels')` → `t('dashboard.totalAgents')`, etc.)
4. Ejecutar `pnpm build` — debe pasar sin errores TypeScript antes de continuar con la siguiente key

---

## FASE 3 — Migración de componentes a `useTranslations`

Estos componentes tienen strings hardcodeados en JSX. Deben migrarse a `useTranslations`.

### 3.1 — `src/components/WasiNavBar.tsx`

**Strings hardcodeados detectados (líneas ~10, 12, 14, 143, 159, 215, 231):**

| String hardcodeado | Migrar a key | Valor EN | Valor ES |
|-------------------|-------------|---------|---------|
| `'Marketplace'` (nav label) | `nav.marketplace` | `"Marketplace"` | `"Marketplace"` |
| `'Dashboard'` (nav label) | `nav.dashboard` | `"Dashboard"` | `"Dashboard"` |
| `'Docs'` (nav label) | `nav.docs` | `"Docs"` | `"Docs"` |
| `"Sign out"` | `auth.signout` | ya existe en JSON | ya existe en JSON (`"Cerrar Sesión"`) |
| `"Sign up"` | `auth.signup` | ya existe en JSON | ya existe en JSON (`"Crear Cuenta"`) |

**Acción:**
1. Agregar a `messages/en.json` y `messages/es.json` bajo `"nav"`:
   ```json
   "nav": {
     "marketplace": "Marketplace",
     "dashboard": "Dashboard",
     "docs": "Docs"
   }
   ```
   > Nota: "Marketplace" y "Dashboard" y "Docs" son aceptables en español (términos técnicos Web3); no requieren traducción.

2. En `WasiNavBar.tsx`, agregar:
   ```typescript
   const t = useTranslations('nav')
   const tAuth = useTranslations('auth')
   ```
3. Reemplazar labels hardcodeados con `t('marketplace')`, `t('dashboard')`, `t('docs')`, `tAuth('signout')`, `tAuth('signup')`.

### 3.2 — `src/features/creator/components/CreatorAnalytics.tsx`

**Strings hardcodeados detectados (líneas ~96, 105):**

| String hardcodeado | Migrar a key | Notas |
|-------------------|-------------|-------|
| `"Analytics"` (heading) | `analytics.title` | Ya existe en ambos JSON; agregar `useTranslations('analytics')` |
| `"Todos los agentes"` (filtro hardcodeado en español) | `analytics.all_agents` | Ya existe en ambos JSON (`"All agents"` / `"Todos los agentes"`) |

**Acción:** Agregar `const t = useTranslations('analytics')` y reemplazar los dos hardcodes.

### 3.3 — `src/app/[locale]/creator/dashboard/page.tsx`

**Strings hardcodeados detectados (líneas ~104, 105, 106, 138, 218, 271):**

| String hardcodeado | Migrar a key | Notas |
|-------------------|-------------|-------|
| `"Total Models"` | `dashboard.totalAgents` | Key renombrada en Fase 2 |
| `"Active"` | `dashboard.active` | Ya existe en ambos JSON (`"Active"` / `"Activos"`) |
| `"Total Calls"` | `dashboard.totalCalls` | Ya existe en ambos JSON |
| `"No models yet"` | `dashboard.noAgents` | Key renombrada en Fase 2 |
| Subtítulo empty state | `dashboard.noAgentsSubtitle` | Key renombrada en Fase 2 |
| Copy de agentes autónomos (~línea 271) | auditar en contexto | Puede ser content estático — si es UI label, migrar |

**Acción:** Agregar `const t = useTranslations('dashboard')` y reemplazar todos los hardcodes.

### 3.4 — `src/app/[locale]/models/[slug]/page.tsx`

**Strings hardcodeados detectados (líneas ~223, 227, 231, 235, 239):**

| String hardcodeado | Migrar a key | Valor EN | Valor ES |
|-------------------|-------------|---------|---------|
| `"Protocol"` | `marketplace.protocol` | Ya existe (`"Protocol"`) | Ya existe (`"Protocolo"`) |
| `"Network"` | `marketplace.network` | Ya existe (`"Network"`) | Ya existe (`"Red"`) |
| `"Currency"` | `marketplace.currency` | Ya existe (`"Currency"`) | Ya existe (`"Moneda"`) |
| `"Total calls"` | `analytics.total_calls` | Ya existe (`"Total calls"`) | Ya existe (`"Total de llamadas"`) |
| `"Creator earns"` | `marketplace.creatorEarns` | Ya existe (`"Creator earns"`) | Ya existe (`"Creator gana"`) |

**Acción:** Agregar `const t = useTranslations('marketplace')` y/o `useTranslations('analytics')` según corresponda. Reemplazar los 5 `<span>` hardcodeados.

### 3.5 — `src/app/[locale]/agent-keys/page.tsx`

**Strings hardcodeados detectados (líneas ~183, 200, 217, 252, 313, 339, 341, 343, 472, 566, 568):**

Este componente tiene ~8-10 strings mixtos EN/ES sobre USDC, warnings de wallet, estados de API keys, etc. 

**Acción:**
1. Revisar el archivo y listar todos los strings visibles en JSX.
2. Agregar una sección `"agentKeys"` a ambos JSON con cada string identificado:
   ```json
   // en.json
   "agentKeys": {
     "title": "Agent Keys",
     "createKey": "Create Key",
     "noKeys": "No keys yet",
     // ... (completar según lo encontrado en el archivo)
   }
   // es.json  
   "agentKeys": {
     "title": "Agent Keys",
     "createKey": "Crear Key",
     "noKeys": "Sin keys todavía",
     // ...
   }
   ```
3. Migrar todos los strings a `useTranslations('agentKeys')`.

> **Nota:** Los strings de USDC/amounts (como valores numéricos) no se traducen. Solo los labels de UI.

### 3.6 — Componentes adicionales a auditar

Los siguientes componentes probablemente tienen hardcodes. Abrir cada uno, buscar strings visibles en JSX que no pasen por `t()`, y migrar si los hay:

| Archivo | Strings probables a migrar |
|---------|--------------------------|
| `src/features/payments/components/PayToCallButton.tsx` | "Loading", "Pay", estados del botón |
| `src/app/[locale]/creator/dashboard/_components/FreeTrialToggle.tsx` | Labels del toggle |
| `src/app/[locale]/creator/agents/[slug]/edit/EditAgentForm.tsx` | Labels del formulario de edición |
| `src/features/docs/content/` (archivos TSX) | Labels de navegación, "Try it", UI labels (NO el contenido técnico del código) |

**Criterio:** Si es texto visible al usuario → migrar. Si es código de ejemplo en docs → no migrar (solo los comentarios y labels de botones en español).

---

## FASE 4 — Verificación y cierre

### 4.1 — Script de auditoría de paridad JSON

Ejecutar desde la raíz del proyecto:

```bash
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
const orphanInEs = esKeys.filter(k => !enKeys.includes(k));
// Valores aceptablemente iguales (nombres de marca, términos técnicos)
const acceptable = ['WasiAI','404','SDK Node.js','SDK Python','Audio','Multimodal','Marketplace','Uptime (24h)','— USDC/call','Slug (URL)','Dashboard','Docs'];
const untranslated = enKeys.filter(k =>
  esKeys.includes(k) &&
  enF[k] === esF[k] &&
  !acceptable.includes(enF[k]) &&
  typeof enF[k] === 'string'
);
console.log('❌ Missing in ES:', missingInEs.length ? missingInEs : '✅ ninguna');
console.log('❌ Orphan in ES:', orphanInEs.length ? orphanInEs : '✅ ninguna');
console.log('⚠️  Possibly untranslated:', untranslated.length ? untranslated : '✅ ninguna');
"
```

**Criterio de pase:** Las tres líneas muestran `✅ ninguna`.

### 4.2 — Grep de hardcodes residuales

```bash
grep -rn --include="*.tsx" -E \
  '>(Analytics|Earnings|Total (Models|Agents|Calls)|Your (Models|Agents)|Publish (Model|Agent)|No (models|agents) yet|Sign out|Sign up|Protocol|Network|Currency|Creator earns|Total calls)<' \
  src/ | grep -v "//" | grep -v "t("
```

**Criterio de pase:** 0 resultados.

### 4.3 — Build check

```bash
pnpm build
```

**Criterio de pase:** Exit 0, 0 errores TypeScript, 0 warnings de next-intl.

### 4.4 — Revisión visual por página (modo ES)

Navegar manualmente con `?locale=es` (o usando el switcher de idioma):

| Página | URL ejemplo | Qué verificar |
|--------|------------|--------------|
| Home | `/?locale=es` | Hero, CTAs, stats, tabs Creator/Consumer |
| Marketplace | `/es/marketplace` | Categorías, cards, labels metadata |
| Ficha de agente | `/es/models/[slug]` | Protocol, Network, Currency, Creator earns, Total calls; trial; code examples |
| Dashboard creator | `/es/creator/dashboard` | Stats (Total Agentes, Activos, etc.), tabla de agentes, empty state |
| Publicar agente | `/es/creator/publish` (o `/publish`) | Form completo, steps, preview, botón Publicar Agente |
| Agent Keys | `/es/agent-keys` | Todos los modales, warnings, labels |
| Analytics | `/es/creator/dashboard` (tab Analytics) | Heading "Analítica", "Ganancias", gráfico |
| Docs | `/es/docs` | Nav lateral, "Pruébalo", labels de Try it |
| 404 | `/es/ruta-que-no-existe` | Título, mensaje, CTA en español |

**Criterio de pase:** 0 strings en inglés visibles en UI al navegar en modo ES (excepto términos técnicos aceptables: "WasiAI", "Avalanche", "USDC", "x402", "API key", "Marketplace", "Dashboard", "Docs", "SDK", nombres de redes).

---

## Definition of Done (DoD)

- [ ] `analytics.title` = `"Analítica"` en `es.json`
- [ ] `analytics.earnings` = `"Ganancias"` en `es.json`
- [ ] `publish.capabilityNumber` = `"Capacidad {n}"` en `es.json`
- [ ] `publish.title`, `publish.subtitle`, `publish.publishButton`, `publish.successTitle` corregidos en ambos JSON (modelo→agente)
- [ ] `dashboard.noCallsSubtitle` corregido en ambos JSON (modelos→agentes)
- [ ] Key `publish.modelName` → `publish.agentName` renombrada en ambos JSON y todos los componentes que la usan
- [ ] Key `dashboard.totalModels` → `dashboard.totalAgents` renombrada en ambos JSON y todos los componentes
- [ ] Key `dashboard.yourModels` → `dashboard.yourAgents` renombrada en ambos JSON y todos los componentes
- [ ] Key `dashboard.publishModel` → `dashboard.publishAgent` renombrada en ambos JSON y todos los componentes
- [ ] Key `dashboard.noModels` → `dashboard.noAgents` renombrada en ambos JSON y todos los componentes
- [ ] Key `dashboard.noModelsSubtitle` → `dashboard.noAgentsSubtitle` renombrada en ambos JSON y todos los componentes
- [ ] `WasiNavBar.tsx` — nav labels y auth buttons usando `useTranslations` (no hardcodeados)
- [ ] `CreatorAnalytics.tsx` — "Analytics" heading y filtro usando `useTranslations`
- [ ] `creator/dashboard/page.tsx` — StatCards y EmptyState usando `useTranslations`
- [ ] `models/[slug]/page.tsx` — 5 labels de metadata usando `useTranslations`
- [ ] `agent-keys/page.tsx` — todos los strings hardcodeados migrados a JSON y `useTranslations`
- [ ] `PayToCallButton.tsx`, `FreeTrialToggle.tsx`, `EditAgentForm.tsx` — auditados; hardcodes migrados si existen
- [ ] `CodeExamples.tsx` y `docs/content/*.tsx` — auditados; labels de UI migrados si existen
- [ ] Script de auditoría JSON retorna `✅ ninguna` en las tres categorías
- [ ] Grep de hardcodes residuales retorna 0 resultados
- [ ] `pnpm build` limpio: exit 0, 0 errores TypeScript
- [ ] Revisión visual: todas las páginas en modo ES sin texto en inglés (excepto términos técnicos aceptables)
- [ ] Deploy en Vercel validado con URL de preview en modo ES
- [ ] PR creado desde `feat/i18n-01-translation-audit` → `main` con descripción de cambios

---

## Notas importantes para el Dev

1. **El orden importa:** Fase 1 (JSON) → Fase 2 (renombrado con grep previo) → Fase 3 (componentes) → Fase 4 (verificación). No mezclar.
2. **`pnpm build` tras cada rename de Fase 2:** Confirmar que TypeScript no rompe antes de continuar.
3. **No traducir:** nombres de marca (WasiAI, Avalanche, USDC, x402), términos técnicos aceptados en LA Web3 (Marketplace, Dashboard, API key, SDK, slug), código de ejemplo en docs.
4. **No cambiar:** `publish.step2.baseModel` = "Base model" / "Modelo base" — se refiere al LLM subyacente (GPT-4, Claude, etc.), no al producto WasiAI.
5. **Sin migrations SQL:** Esta HU es 100% frontend/copy. No tocar Supabase, contratos, ni variables de entorno.
6. **Si encuentras strings hardcodeados no listados:** Añadirlos a JSON y migrarlos. El criterio es: si es texto visible al usuario en UI → debe estar en JSON.
7. **Archivos JSON:** `messages/en.json` y `messages/es.json` en la raíz del proyecto.
8. **i18n en Next.js:** El proyecto usa `next-intl`. Los componentes Server usan `getTranslations`, los Client usan `useTranslations`.

---

*Generado por San (agente SM BMAD) · 2026-02-27*  
*Gates superados: HU_APPROVED ✅ · SPEC_APPROVED ✅*  
*Dev: leer solo este archivo. No necesitas leer i18n-01-s0.md ni i18n-01-sdd.md.*
