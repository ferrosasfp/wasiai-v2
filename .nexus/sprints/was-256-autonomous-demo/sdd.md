# SDD #094: WAS-256 — Autonomous Agent Demo

> SPEC_APPROVED: no
> Fecha: 2026-03-21
> Tipo: feature
> SDD_MODE: full
> Hackathon: Aleph — track Avalanche — deadline 2026-03-22

---

## 1. Resumen

Se construye un endpoint `/api/v1/demo/autonomous` y una UI en `/[locale]/demo` que demuestra la capacidad de WasiAI de orquestar múltiples agentes para resolver un goal en lenguaje natural, sin que el usuario defina los pasos. El sistema sigue 4 fases: Discovery (LLM planner), Planning (validación + normalización), Execution (compose pipeline), Report (LLM summary). Es el diferencial técnico del hackathon Aleph.

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | 094 |
| **Tipo** | feature |
| **SDD_MODE** | full |
| **Objetivo** | Endpoint + UI de demo autónomo: goal → pipeline → report |
| **Reglas de negocio** | Reusar colección defi-chat; billing via compose; auth pass-through |
| **Scope IN** | API route, shared module, UI page, nav link |
| **Scope OUT** | No crear nueva colección, no nuevo billing, no websockets/streaming |
| **Missing Inputs** | N/A |

### Acceptance Criteria (EARS)

**AC1** WHEN POST `/api/v1/demo/autonomous` con body `{goal: string}` y header `x-api-key` presente, THEN el sistema responde HTTP 200 con `{report, phases, total_cost_usdc, pipeline_id}`.

**AC2** WHEN fase Discovery, THEN el LLM planner genera `ComposeStep[]` usando ÚNICAMENTE agentes de la colección `defi-chat` con status `active`.

**AC3** WHEN fase Planning, THEN el sistema normaliza pasos: strip `input` si `pass_output:true`, `agent`→`agent_slug`, filtra slugs inválidos.

**AC4** WHEN fase Execution, THEN el sistema llama internamente a `/api/v1/compose` con `fetch` con timeout de 50s.

**AC5** WHEN fase Report, THEN el LLM genera `report` en lenguaje natural (≤300 palabras) con precio, riesgo y recomendación.

**AC6** WHEN respuesta 200, THEN `phases` es array de `{name: string, status: 'ok'|'error', detail?: string}` para discovery, planning, execution, report.

**AC7** WHEN header `x-api-key` falta, THEN HTTP 401 `{error, code:'missing_key'}`.

**AC8** WHEN `goal` está vacío, THEN HTTP 400 `{error, code:'missing_goal'}`.

**AC9** WHEN LLM planner retorna array vacío (goal no-DeFi), THEN HTTP 422 `{error, code:'no_agents_matched'}`.

**AC10** WHEN compose retorna error, THEN HTTP 502 `{error, code:'execution_failed', phases}`.

**AC11** WHEN UI en `/[locale]/demo`, THEN existe textarea para goal, campo key type=password con toggle show/hide, botón submit, spinner durante ejecución, y display de report + phases + total_cost_usdc.

**AC12** WHEN `npx tsc --noEmit`, THEN pasa sin errores.

---

## 3. Context Map

### Archivos leídos

| Archivo | Por qué | Patrón extraído |
|---------|---------|-----------------|
| `src/app/api/v1/chat/route.ts` | Exemplar principal: planner→compose→summary | `getCollectionAgents`, `buildPlannerPrompt`, normalización, compose fetch, callLLM summary |
| `src/components/WasiNavBar.tsx` | Cómo añadir nav items | `primaryLinks` array con `{path, label}` |
| `src/app/[locale]/chat/_components/ChatPageClient.tsx` | Exemplar UI | useState, Eye/EyeOff toggle, localStorage STORAGE_KEY, fetch, result state |

### Exemplars

| Para crear/modificar | Seguir patrón de | Razón |
|---------------------|------------------|-------|
| `src/lib/agents/collection-agents.ts` | Código extraído de `chat/route.ts` líneas 8-68 | Mover sin cambiar lógica |
| `src/app/api/v1/demo/autonomous/route.ts` | `src/app/api/v1/chat/route.ts` | Mismo flujo, 4 fases, mismas utilidades |
| `src/app/[locale]/demo/_components/DemoPageClient.tsx` | `src/app/[locale]/chat/_components/ChatPageClient.tsx` | Mismo patrón UI |
| `src/app/[locale]/demo/page.tsx` | `src/app/[locale]/chat/page.tsx` | Mismo patrón Server Component wrapper |

### Estado de BD relevante

| Tabla | Existe | Relevancia |
|-------|--------|-----------|
| `collection_agents` | Sí | JOIN con `collections` para filtrar `defi-chat` |
| `collections` | Sí | Filter por `slug='defi-chat'` |
| `agents` | Sí | `slug, name, description, status, input_schema` |

### Componentes reutilizables

- `callLLM` en `src/lib/agents/llm.ts` — reusar para planner y report
- `createServiceClient` en `src/lib/supabase/server.ts` — reusar en shared module
- `CollectionAgent` interface + `getCollectionAgents()` → extraer a shared module
- `Eye`, `EyeOff` de `lucide-react` — ya usados en ChatPageClient

---

## 4. Diseño Técnico

### 4.1 Archivos a crear/modificar

| Archivo | Acción | Descripción | Exemplar |
|---------|--------|-------------|----------|
| `src/lib/agents/collection-agents.ts` | **CREAR** | Exportar `CollectionAgent` + `getCollectionAgents()` extraídos de chat/route.ts | `chat/route.ts` líneas 8-68 |
| `src/app/api/v1/chat/route.ts` | **MODIFICAR** | Eliminar definición local de `CollectionAgent` e `getCollectionAgents`; importar desde `@/lib/agents/collection-agents` | — |
| `src/app/api/v1/demo/autonomous/route.ts` | **CREAR** | Endpoint POST: 4 fases, maxDuration=60 | `chat/route.ts` |
| `src/app/[locale]/demo/page.tsx` | **CREAR** | Server Component wrapper (no auth required) | `src/app/[locale]/chat/page.tsx` |
| `src/app/[locale]/demo/_components/DemoPageClient.tsx` | **CREAR** | Client component con UI | `ChatPageClient.tsx` |
| `src/components/WasiNavBar.tsx` | **MODIFICAR** | Añadir "Demo" a `primaryLinks` | — |

### 4.2 Modelo de datos

N/A — sin cambios de BD. Solo lecturas a tablas existentes.

### 4.3 Shared Module: `collection-agents.ts`

```
export interface CollectionAgent { slug, name, description, status, input_schema }
// Variables de caché module-level: cachedAgents, cacheExpiresAt, CACHE_TTL_MS=60_000
// function extractAgent(row): CollectionAgent | null  (privada, no exportar)
// export async function getCollectionAgents(): Promise<CollectionAgent[]>
// export function buildPlannerPrompt(agents: CollectionAgent[]): string
```

El chat/route.ts elimina su código local e importa `{ CollectionAgent, getCollectionAgents, buildPlannerPrompt }` desde `@/lib/agents/collection-agents`.
El demo/autonomous/route.ts también importa `{ CollectionAgent, getCollectionAgents, buildPlannerPrompt }` desde `@/lib/agents/collection-agents`.

**OBLIGATORIO:** `buildPlannerPrompt` DEBE exportarse desde `collection-agents.ts` — NO duplicar, NO reescribir.

**Efecto del cache compartido:** chat y demo comparten el mismo módulo. El cache de 60s se comparte — menos llamadas a DB. Correcto por diseño.

### 4.4 API Route: `demo/autonomous/route.ts`

```
export const maxDuration = 60

POST /api/v1/demo/autonomous
Body: { goal: string }
Header: x-api-key: wasi_xxx

Respuesta 200:
{
  report: string,
  phases: Phase[],       // [{name, status, detail?}]
  total_cost_usdc: string,
  pipeline_id: string
}

Respuesta error:
{ error: string, code: string, phases?: Phase[] }
```

**Fases (en orden):**

1. **discovery** — callLLM planner con prompt de agentes disponibles → `ComposeStep[]`
2. **planning** — normalizar steps (mismo código que chat/route.ts), filtrar slugs válidos
3. **execution** — fetch a `${NEXT_PUBLIC_SITE_URL}/api/v1/compose` con AbortController 50s
4. **report** — callLLM summary con REPORT_SYSTEM prompt

**PLANNER_SYSTEM:** Misma lógica que `buildPlannerPrompt` en chat — reusar importando de collection-agents, o duplicar `buildPlannerPrompt` en el módulo shared.

**REPORT_SYSTEM:**
```
You are a DeFi analyst generating an autonomous agent report. Based on the pipeline results below, write a clear analysis (max 300 words) covering: current token price, risk assessment, market signals, and a recommendation. Use plain language. Include exact numbers.
```

### 4.5 Flujo principal (Happy Path)

1. Usuario envía `POST {goal: "Analyze AVAX risk"}` con `x-api-key`
2. **Discovery:** LLM genera `[{agent_slug:"wasi-chainlink-price",input:{token:"AVAX"}},{agent_slug:"wasi-risk-report",pass_output:true}]`
3. **Planning:** normalizar → filtrar por validSlugs → limitedSteps (max 3)
4. **Execution:** fetch compose → 200 + receipts
5. **Report:** LLM genera texto análisis
6. Response 200: `{report, phases:[{name:'discovery',status:'ok'},{name:'planning',status:'ok'},{name:'execution',status:'ok'},{name:'report',status:'ok'}], total_cost_usdc, pipeline_id}`

### 4.6 Flujo de error

- `x-api-key` falta → 401 inmediato, `phases:[]`
- `goal` vacío → 400 inmediato
- Discovery LLM falla → 500, phase discovery status:'error'
- Planning: steps vacíos → 422, phases incluye discovery:'ok', planning:'error'
- Execution compose falla → 502, phases incluye execution:'error'
- Report LLM falla → **fail-open**: usar `JSON.stringify(composeResult)` como report, execution:'ok', report:'error' (pero 200)

### 4.7 UI: DemoPageClient

```
Título: "Autonomous Agent Demo"
Subtitle: "Describe a goal in natural language — WasiAI discovers and runs the right agents."

Form fields:
- "Goal" — textarea, placeholder "e.g. Analyze AVAX price, safety, and market risk", max 500 chars
- "Agent Key" — input type=password con Eye/EyeOff toggle, placeholder "wasi_...", localStorage key 'wasi_api_key'
- Submit button: "Run Demo" → spinner "Running..." mientras loading

Result display (cuando result !== null):
- Report: card con título "Report" y texto del LLM
- Phases: lista de fases con icon ✅/❌ + name + detail
- Cost: "Total cost: $X.XXXXXX USDC"
- Pipeline ID: text pequeño gris

Error display: banner rojo con error.message
```

### 4.8 Navegación

| Archivo | Cambio |
|---------|--------|
| `WasiNavBar.tsx` | Añadir `{ path: '/demo', label: 'Demo' }` a `primaryLinks` (después de 'collections') |

**Nota:** No hay i18n key nueva necesaria — usar hardcode `'Demo'` o si el nav usa `tNav` key, añadir `demo: 'Demo'` a los mensajes. Verificar en Wave 0.

---

## 5. Constraint Directives

### OBLIGATORIO seguir
- Patrón auth: solo verificar presencia del header, pasar a compose que valida contra DB
- Shared module: `CollectionAgent` y `getCollectionAgents` en `src/lib/agents/collection-agents.ts`
- Cache module-level igual que en chat/route.ts — no eliminar cache
- Normalización de steps: copiar exactamente el bloque de normalización de chat/route.ts
- `maxDuration = 60` en la ruta API
- AbortController con 50000ms para el fetch a compose
- Fail-open en Report: si LLM falla, usar JSON.stringify como report (no 500)
- `Eye`, `EyeOff` de `lucide-react` (ya instalado)
- localStorage key: `'wasi_api_key'` (mismo que chat — comparten key)

### PROHIBIDO
- NO agregar dependencias npm nuevas
- NO modificar `compose/route.ts` ni ningún otro route existente salvo `chat/route.ts`
- NO hacer streaming/SSE — respuesta JSON estándar
- NO añadir auth de sesión (Supabase session) — solo `x-api-key`
- NO hardcodear slugs de agentes — siempre desde DB via `getCollectionAgents()`
- NO cambiar el modelo de billing — compose maneja todo
- NO crear nueva colección en DB

---

## 6. Scope

**IN:**
- `src/lib/agents/collection-agents.ts` — shared module
- Refactor `chat/route.ts` para usar shared module (2 líneas de cambio)
- `src/app/api/v1/demo/autonomous/route.ts`
- `src/app/[locale]/demo/page.tsx`
- `src/app/[locale]/demo/_components/DemoPageClient.tsx`
- Nav link "Demo" en `WasiNavBar.tsx`

**OUT:**
- No nueva página de docs
- No analytics/tracking
- No tests automatizados (hackathon)
- No i18n completa de la página Demo (inglés hardcoded OK para hackathon)
- No rate limiting específico para `/demo` (usa el de compose)

---

## 7. Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Refactor `chat/route.ts` rompe el chat | Baja | Alto | Spec Reviewer ejecuta `tsc --noEmit` y smoke test en Wave 0 |
| Groq rate limit 429 en demo (planner + report = 2 LLM calls) | Media | Medio | Fail-open en Report; max 3 steps = menos LLM calls en compose |
| `NEXT_PUBLIC_SITE_URL` no configurado en Vercel | Baja | Alto | Fallback a `https://app.wasiai.io` igual que chat/route.ts |
| Nav i18n key falta para 'Demo' | Baja | Bajo | Hardcode 'Demo' o añadir a messages JSON — Spec Reviewer verifica |

---

## 8. Dependencias

- WAS-254 (Transform Layer) ✅
- WAS-255 (Chat + planner) ✅
- Colección `defi-chat` con agentes activos en prod ✅

---

## 9. Waves de Implementación

### Wave 0 — Pre-flight (Spec Reviewer ejecuta)
- [ ] W0.1: Verificar que `chat/route.ts` compila actualmente (`tsc --noEmit`)
- [ ] W0.2: Verificar que `src/lib/agents/collection-agents.ts` NO existe aún
- [ ] W0.3: Verificar que `src/app/[locale]/demo/` NO existe aún
- [ ] W0.4: Verificar imports disponibles: `callLLM` en `@/lib/agents/llm`, `createServiceClient` en `@/lib/supabase/server`
- [ ] W0.5: Verificar que `lucide-react` tiene `Eye`, `EyeOff` (ya verificado en ChatPageClient)
- [ ] W0.6: Verificar mensajes i18n de chat para entender patrón — `messages/en.json` key `chat.*`

### Wave 1 — Shared Module (sin dependencias)
- [ ] W1.1: Crear `src/lib/agents/collection-agents.ts` — extraer de chat/route.ts: `CollectionAgent` interface, cache vars, `extractAgent` (privada), `getCollectionAgents` (export), `buildPlannerPrompt` (export). Copiar EXACTAMENTE sin modificar lógica.
- [ ] W1.2: Modificar `chat/route.ts` — eliminar código extraído, agregar `import { CollectionAgent, getCollectionAgents, buildPlannerPrompt } from '@/lib/agents/collection-agents'`
- [ ] **Build gate:** `tsc --noEmit` debe pasar antes de continuar

### Wave 2 — API Route
- [ ] W2.1: Crear `src/app/api/v1/demo/autonomous/route.ts` — implementar 4 fases
- [ ] **Build gate:** `tsc --noEmit` debe pasar

### Wave 3 — UI
- [ ] W3.1: Crear `src/app/[locale]/demo/page.tsx` (Server Component)
- [ ] W3.2: Crear `src/app/[locale]/demo/_components/DemoPageClient.tsx`
- [ ] W3.3: Modificar `WasiNavBar.tsx` — añadir Demo a primaryLinks
- [ ] **Build gate:** `npm run build` debe pasar sin errores

### Wave 4 — Commit
- [ ] W4.1: `git add` + `git commit` con mensaje `feat(demo): autonomous agent demo endpoint + UI — WAS-256 SDD #094`
- [ ] W4.2: `git push origin main && git push alephhack main`

---

## 10. Rollback

Si el build falla después del commit:
1. `git revert HEAD` — revierte el commit de Wave 4
2. El chat route original se restaura con `getCollectionAgents` local (si Wave 1 causó el problema)
3. Archivos nuevos (`demo/`) se eliminan con `trash`

---

*SDD generado por NexusAgil — FULL — SDD #094*
