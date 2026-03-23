# Story File — #094: WAS-256 Autonomous Agent Demo

> SDD: .nexus/sprints/was-256-autonomous-demo/sdd.md
> Fecha: 2026-03-21
> SPEC_APPROVED: sí

---

## Goal

Construir un endpoint `/api/v1/demo/autonomous` y una UI en `/[locale]/demo` que permite al usuario describir un goal en lenguaje natural y el sistema automáticamente descubre qué agentes de DeFi necesita, los ejecuta en pipeline, y devuelve un reporte estructurado. Es el demo diferencial para el hackathon Aleph.

---

## Acceptance Criteria (EARS)

**AC1** WHEN POST `/api/v1/demo/autonomous` con body `{goal: string}` y header `x-api-key` presente, THEN el sistema responde HTTP 200 con `{report, phases, total_cost_usdc, pipeline_id}`.

**AC2** WHEN fase Discovery, THEN el LLM planner genera `ComposeStep[]` usando ÚNICAMENTE agentes de la colección `defi-chat` con status `active`.

**AC3** WHEN fase Planning, THEN el sistema normaliza pasos: strip `input` si `pass_output:true`, `agent`→`agent_slug`, filtra slugs inválidos.

**AC4** WHEN fase Execution, THEN el sistema llama internamente a `/api/v1/compose` con `fetch` con AbortController de 50000ms.

**AC5** WHEN fase Report, THEN el LLM genera `report` en lenguaje natural con precio, riesgo y recomendación (max 300 palabras).

**AC6** WHEN respuesta 200, THEN `phases` es array de `{name: string, status: 'ok'|'error', detail?: string}` para las fases: discovery, planning, execution, report.

**AC7** WHEN header `x-api-key` falta, THEN HTTP 401 `{error: 'Agent Key required', code: 'missing_key'}`.

**AC8** WHEN `goal` está vacío o solo whitespace, THEN HTTP 400 `{error: 'goal must be a non-empty string', code: 'missing_goal'}`.

**AC9** WHEN LLM planner retorna array vacío, THEN HTTP 422 `{error: 'I can only analyze DeFi/crypto topics', code: 'no_agents_matched'}`.

**AC10** WHEN compose retorna error, THEN HTTP 502 `{error, code: 'execution_failed', phases}`.

**AC11** WHEN UI en `/[locale]/demo`, THEN existe textarea para goal, campo key type=password con toggle Eye/EyeOff, botón "Run Demo", spinner "Running..." durante loading, y display de report + phases + total_cost_usdc.

**AC12** WHEN `npx tsc --noEmit`, THEN pasa sin errores.

---

## Files to Modify/Create

| # | Archivo | Acción | Qué hacer | Exemplar |
|---|---------|--------|-----------|----------|
| 1 | `src/lib/agents/collection-agents.ts` | **CREAR** | Extraer EXACTAMENTE de `chat/route.ts`: interface `CollectionAgent`, cache vars (`cachedAgents`, `cacheExpiresAt`, `CACHE_TTL_MS`), función privada `extractAgent`, export `getCollectionAgents`, export `buildPlannerPrompt` | `chat/route.ts` líneas 6-100 |
| 2 | `src/app/api/v1/chat/route.ts` | **MODIFICAR** | Eliminar el código extraído al #1. Añadir import: `import { CollectionAgent, getCollectionAgents, buildPlannerPrompt } from '@/lib/agents/collection-agents'` | — |
| 3 | `src/app/api/v1/demo/autonomous/route.ts` | **CREAR** | Endpoint POST con 4 fases (ver Waves y Exemplar 1) | `chat/route.ts` |
| 4 | `src/app/[locale]/demo/page.tsx` | **CREAR** | Server Component wrapper mínimo | `src/app/[locale]/chat/page.tsx` |
| 5 | `src/app/[locale]/demo/_components/DemoPageClient.tsx` | **CREAR** | Client component UI (ver Exemplar 2) | `src/app/[locale]/chat/_components/ChatPageClient.tsx` |
| 6 | `src/components/WasiNavBar.tsx` | **MODIFICAR** | Añadir `{ path: '/demo', label: 'Demo' }` al array `primaryLinks` después de `collections` | — |

---

## Exemplars

### Exemplar 1: chat/route.ts — patrón completo del endpoint

**Archivo**: `src/app/api/v1/chat/route.ts`
**Usar para**: Archivo #3 (`demo/autonomous/route.ts`)

**Patrón a seguir en el endpoint demo:**
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { callLLM } from '@/lib/agents/llm'
import { createServiceClient } from '@/lib/supabase/server'   // solo si necesitas algo fuera de collection-agents
import { CollectionAgent, getCollectionAgents, buildPlannerPrompt } from '@/lib/agents/collection-agents'

export const maxDuration = 60

const REPORT_SYSTEM = `You are a DeFi analyst generating an autonomous agent report. Based on the pipeline results below, write a clear analysis (max 300 words) covering: current token price, risk assessment, market signals, and a recommendation. Use plain language. Include exact numbers.`

interface Phase {
  name: 'discovery' | 'planning' | 'execution' | 'report'
  status: 'ok' | 'error'
  detail?: string
}

export async function POST(req: NextRequest) {
  const phases: Phase[] = []

  // AC7 — auth
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey) return NextResponse.json({ error: 'Agent Key required', code: 'missing_key' }, { status: 401 })

  // AC8 — parse + validate goal
  let body: { goal?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'missing_goal' }, { status: 400 }) }
  const goal = body.goal
  if (typeof goal !== 'string' || goal.trim().length === 0) {
    return NextResponse.json({ error: 'goal must be a non-empty string', code: 'missing_goal' }, { status: 400 })
  }

  // --- Phase: discovery ---
  let agents: CollectionAgent[]
  try {
    agents = await getCollectionAgents()
  } catch (err) {
    phases.push({ name: 'discovery', status: 'error', detail: String(err) })
    return NextResponse.json({ error: 'Failed to load agents', code: 'execution_failed', phases }, { status: 500 })
  }

  let steps: unknown[]
  try {
    const plannerSystem = buildPlannerPrompt(agents)
    const plannerRes = await callLLM({ messages: [{ role: 'system', content: plannerSystem }, { role: 'user', content: goal }], temperature: 0, maxTokens: 512 })
    const raw = plannerRes.result.trim()
    const match = raw.match(/\[[\s\S]*\]/)
    steps = JSON.parse(match ? match[0] : raw)
    if (!Array.isArray(steps)) throw new Error('not array')
  } catch (err) {
    phases.push({ name: 'discovery', status: 'error', detail: String(err) })
    return NextResponse.json({ error: 'Failed to plan pipeline', code: 'execution_failed', phases }, { status: 500 })
  }
  phases.push({ name: 'discovery', status: 'ok' })

  // --- Phase: planning ---
  if (steps.length === 0) {
    phases.push({ name: 'planning', status: 'error', detail: 'no steps' })
    return NextResponse.json({ error: 'I can only analyze DeFi/crypto topics', code: 'no_agents_matched', phases }, { status: 422 })
  }
  // Normalize (COPY EXACTLY from chat/route.ts step 9)
  const validSlugs = new Set(agents.map(a => a.slug))
  const normalizedSteps = steps.map((s: unknown) => {
    const step = { ...(s as Record<string, unknown>) }
    if (typeof step.input === 'string') { try { step.input = JSON.parse(step.input) } catch { /* leave */ } }
    if (step.pass_output === true && step.input !== undefined) { delete step.input }
    if (!step.agent_slug && step.agent) { step.agent_slug = step.agent; delete step.agent }
    return step
  })
  const filteredSteps = normalizedSteps.filter(s => validSlugs.has((s as Record<string, unknown>).agent_slug as string))
  if (filteredSteps.length === 0) {
    phases.push({ name: 'planning', status: 'error', detail: 'no valid slugs' })
    return NextResponse.json({ error: 'I can only analyze DeFi/crypto topics', code: 'no_agents_matched', phases }, { status: 422 })
  }
  const limitedSteps = filteredSteps.slice(0, 3)
  phases.push({ name: 'planning', status: 'ok', detail: `${limitedSteps.length} steps` })

  // --- Phase: execution ---
  const composeUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.wasiai.io'}/api/v1/compose`
  let composeResult: unknown
  let composeOk = false
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 50000)
    const composeRes = await fetch(composeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ steps: limitedSteps }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    composeResult = await composeRes.json()
    composeOk = composeRes.ok
  } catch (err) {
    phases.push({ name: 'execution', status: 'error', detail: String(err) })
    return NextResponse.json({ error: 'Pipeline execution failed', code: 'execution_failed', phases }, { status: 502 })
  }
  if (!composeOk) {
    const e = composeResult as { error?: string }
    phases.push({ name: 'execution', status: 'error', detail: e?.error })
    return NextResponse.json({ error: e?.error ?? 'Pipeline execution failed', code: 'execution_failed', phases }, { status: 502 })
  }
  phases.push({ name: 'execution', status: 'ok' })

  // --- Phase: report (fail-open) ---
  let report: string
  try {
    const reportRes = await callLLM({ messages: [{ role: 'system', content: REPORT_SYSTEM }, { role: 'user', content: JSON.stringify(composeResult) }], temperature: 0.3, maxTokens: 400 })
    report = reportRes.result
    phases.push({ name: 'report', status: 'ok' })
  } catch {
    report = JSON.stringify(composeResult)
    phases.push({ name: 'report', status: 'error', detail: 'LLM unavailable, raw result returned' })
  }

  const r = composeResult as { total_cost_usdc?: string; pipeline_id?: string }
  return NextResponse.json({ report, phases, total_cost_usdc: r.total_cost_usdc ?? '0.000000', pipeline_id: r.pipeline_id ?? '' })
}
```

### Exemplar 2: ChatPageClient — patrón UI

**Archivo**: `src/app/[locale]/chat/_components/ChatPageClient.tsx`
**Usar para**: Archivo #5 (`DemoPageClient.tsx`)

**Patrones clave a seguir:**
- `'use client'` al inicio
- `import { useState, useEffect } from 'react'`
- `import { Eye, EyeOff } from 'lucide-react'`
- `const STORAGE_KEY = 'wasi_api_key'` — mismo key que chat (comparten)
- `useEffect` para cargar key de localStorage
- `showKey` state + botón toggle Eye/EyeOff dentro de div `relative`
- `setLoading(true)` antes del fetch, `setLoading(false)` en finally
- `setError(null)` al inicio del submit

**Estructura de la UI del DemoPageClient:**
```
Título: "Autonomous Agent Demo"
Subtítulo: "Describe a DeFi goal — WasiAI discovers and runs the right agents automatically."

Form:
  - Label "Goal" + textarea (placeholder: "e.g. Analyze AVAX price, safety, and market risk", rows=3, maxLength=500)
  - Label "Agent Key" + input type=password + Eye/EyeOff toggle (mismo patrón que ChatPageClient)
  - Button "Run Demo" disabled cuando loading o goal vacío o key vacía
  - Texto "Running..." + spinner cuando loading (seguir patrón ChatPageClient)

Result (cuando result !== null):
  - Card "Report": párrafo con result.report
  - Card "Pipeline Phases": lista de phases, cada una con:
      - ✅ si status==='ok', ❌ si status==='error'
      - name (discovery / planning / execution / report)
      - detail si existe
  - "Total cost: $X.XXXXXX USDC" en text-sm text-gray-500
  - "Pipeline ID: {pipeline_id}" en text-xs text-gray-400

Error (cuando error !== null):
  - Banner rojo con el mensaje de error
```

**Interfaces TypeScript para DemoPageClient:**
```typescript
interface Phase {
  name: string
  status: 'ok' | 'error'
  detail?: string
}

interface DemoResponse {
  report: string
  phases: Phase[]
  total_cost_usdc: string
  pipeline_id: string
}
```

**Fetch al endpoint:**
```typescript
const res = await fetch('/api/v1/demo/autonomous', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
  body: JSON.stringify({ goal }),
})
const data = await res.json()
if (!res.ok) throw new Error(data.error ?? 'Request failed')
setResult(data as DemoResponse)
```

### Exemplar 3: chat/page.tsx — Server Component wrapper

**Archivo**: `src/app/[locale]/chat/page.tsx`
**Usar para**: Archivo #4 (`demo/page.tsx`)

```typescript
import type { Metadata } from 'next'
import { DemoPageClient } from './_components/DemoPageClient'  // ajustar nombre

export const metadata: Metadata = {
  title: 'Autonomous Demo — WasiAI',
}

export default function DemoPage() {
  return <DemoPageClient />
}
```

### Exemplar 4: WasiNavBar — añadir primaryLink

**Archivo**: `src/components/WasiNavBar.tsx`
**Línea objetivo**: el array `primaryLinks`

```typescript
// ANTES:
const primaryLinks = [
  { path: '', label: tNav('marketplace') },
  { path: '/collections', label: tNav('collections') },
]

// DESPUÉS (añadir demo):
const primaryLinks = [
  { path: '', label: tNav('marketplace') },
  { path: '/collections', label: tNav('collections') },
  { path: '/demo', label: 'Demo' },  // hardcode OK — no requiere tNav()
]
```

---

## Constraint Directives

### OBLIGATORIO
- `buildPlannerPrompt` DEBE importarse desde `@/lib/agents/collection-agents` — NO duplicar
- `AbortController` con 50000ms timeout en el fetch a compose
- `STORAGE_KEY = 'wasi_api_key'` en DemoPageClient (mismo que chat)
- `maxDuration = 60` en `demo/autonomous/route.ts`
- Fail-open en fase Report: si LLM falla, usar `JSON.stringify(composeResult)` como report y status='error' — NO retornar 500
- `phases` array debe llenarse progresivamente — incluir siempre en respuestas de error

### PROHIBIDO
- NO agregar dependencias npm nuevas
- NO modificar `compose/route.ts` ni ningún otro route existente salvo `chat/route.ts` (solo el import)
- NO hardcodear slugs de agentes — siempre desde DB via `getCollectionAgents()`
- NO hacer streaming/SSE — respuesta JSON estándar
- NO añadir auth de sesión Supabase — solo `x-api-key`
- NO tocar archivos fuera de los 6 listados en la tabla
- NO hacer `git push` — solo commit local

---

## Test Expectations

Sin tests automatizados (hackathon). QA Verifier hará smoke test manual.

---

## Waves

### Wave 0 — Pre-flight (verificar antes de tocar código)
- [ ] W0.1: Verificar que `tsc --noEmit` pasa en el estado actual del repo
- [ ] W0.2: Verificar que `src/lib/agents/collection-agents.ts` NO existe
- [ ] W0.3: Verificar que `src/app/[locale]/demo/` NO existe
- [ ] W0.4: Confirmar que `chat/route.ts` tiene `getCollectionAgents` y `buildPlannerPrompt` definidas localmente (sin exportar)

**Si CUALQUIER check falla → STOP. Reportar con `WAVE 0 FAILED: [detalle]`.**

### Wave 1 — Shared Module (base para todo)
- [ ] W1.1: CREAR `src/lib/agents/collection-agents.ts` copiando EXACTAMENTE el código de `chat/route.ts`:
  - interface `CollectionAgent` (export)
  - `let cachedAgents`, `let cacheExpiresAt`, `const CACHE_TTL_MS` (module-level, no export)
  - `function extractAgent()` (privada, no export)
  - `async function getCollectionAgents()` (export)
  - `function buildPlannerPrompt()` (export)
  - Añadir los imports necesarios: `createServiceClient` desde `@/lib/supabase/server`
- [ ] W1.2: MODIFICAR `src/app/api/v1/chat/route.ts`:
  - Eliminar las líneas del código extraído (interface CollectionAgent + cache vars + extractAgent + getCollectionAgents + buildPlannerPrompt)
  - Mantener imports de `callLLM` y `createServiceClient` solo si aún se usan directamente en `chat/route.ts` (verificar — `createServiceClient` ya no se usa directamente, `callLLM` sí)
  - Añadir: `import { CollectionAgent, getCollectionAgents, buildPlannerPrompt } from '@/lib/agents/collection-agents'`
- [ ] **Build gate:** `npx tsc --noEmit` debe pasar. Si falla → STOP.

### Wave 2 — API Route
- [ ] W2.1: CREAR `src/app/api/v1/demo/autonomous/route.ts` siguiendo EXACTAMENTE el Exemplar 1 de este Story File
- [ ] **Build gate:** `npx tsc --noEmit` debe pasar. Si falla → STOP.

### Wave 3 — UI
- [ ] W3.1: CREAR `src/app/[locale]/demo/page.tsx` siguiendo Exemplar 3
- [ ] W3.2: CREAR `src/app/[locale]/demo/_components/DemoPageClient.tsx` siguiendo Exemplar 2
- [ ] W3.3: MODIFICAR `src/components/WasiNavBar.tsx` siguiendo Exemplar 4
- [ ] **Build gate:** `npm run build` debe pasar sin errores. Si falla → STOP.

### Wave 4 — Commit
- [ ] W4.1: `git add src/lib/agents/collection-agents.ts src/app/api/v1/chat/route.ts src/app/api/v1/demo/autonomous/route.ts "src/app/[locale]/demo/" src/components/WasiNavBar.tsx`
- [ ] W4.2: `git commit -m "feat(demo): autonomous agent demo endpoint + UI — WAS-256 SDD #094"`
- [ ] W4.3: `git push origin main && git push alephhack main`

---

## Out of Scope

- NO crear nueva colección de agentes en DB
- NO añadir rate limiting específico para `/demo`
- NO i18n completa de la UI demo (inglés hardcoded OK para hackathon)
- NO modificar compose route, sandbox, pipelines, ni ningún otro feature
- NO "mejorar" código adyacente mientras lo lees

---

## Escalation Rule

**Si algo no está en este Story File, STOP y reporta al Orquestador.**
No inventar. No asumir. No improvisar.

Situaciones de escalation:
- `chat/route.ts` tiene estructura diferente a la asumida (no encuentra `buildPlannerPrompt`)
- Import de `@/lib/agents/collection-agents` da error de tipos inesperado
- `npm run build` falla por razón no relacionada con los archivos del scope

---

*Story File generado por NexusAgil — F2.5 — SDD #094*
