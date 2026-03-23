# Logic Audit — SDD #094 (commit 3e9b54d98)

**Auditor:** Logic Auditor subagent  
**Fecha:** 2026-03-21  
**Archivos auditados:**
- `src/lib/agents/collection-agents.ts`
- `src/app/api/v1/demo/autonomous/route.ts`
- `src/app/[locale]/demo/_components/DemoPageClient.tsx`
- `src/app/api/v1/chat/route.ts`

---

## AC Trazabilidad

| AC | Implementado | Archivo:línea | Status |
|----|-------------|--------------|--------|
| AC1 — POST 200 con {report, phases, total_cost_usdc, pipeline_id} | ✅ | `autonomous/route.ts:87` (return NextResponse.json) | ✅ OK |
| AC2 — Discovery usa SOLO agentes defi-chat activos | ✅ | `collection-agents.ts:47-50` (`.eq('collections.slug','defi-chat').eq('agents.status','active')`) + `extractAgent` status guard línea 25 | ✅ OK |
| AC3 — Planning normaliza: strip input si pass_output, agent→agent_slug, filtra slugs inválidos | ✅ | `autonomous/route.ts:51-64` | ✅ OK |
| AC4 — Execution fetch AbortController 50000ms | ✅ | `autonomous/route.ts:69-72` | ⚠️ PARCIAL — ver F2 |
| AC5 — Report LLM ≤300 palabras, precio/riesgo/recomendación | ✅ | `autonomous/route.ts:6-7` (REPORT_SYSTEM) + `route.ts:81` (maxTokens:400) | ⚠️ MENOR — ver F3 |
| AC6 — phases array {name, status, detail?} en 200 | ✅ | `autonomous/route.ts:15-18` (Phase interface) + respuesta final línea 87 | ✅ OK |
| AC7 — x-api-key falta → 401 | ✅ | `autonomous/route.ts:22-23` | ⚠️ EDGE CASE — ver F1 |
| AC8 — goal vacío → 400 | ✅ | `autonomous/route.ts:26-30` | ✅ OK |
| AC9 — planner retorna [] → 422 con phases | ✅ | `autonomous/route.ts:44-47` | ✅ OK |
| AC10 — compose falla → 502 con phases | ✅ | `autonomous/route.ts:74-82` | ✅ OK |
| AC11 — UI: textarea goal, key password+toggle, Run Demo, spinner, report+phases+cost | ✅ | `DemoPageClient.tsx:43-115` | ✅ OK |
| AC12 — tsc --noEmit pasa | No verificable en análisis estático (no se ejecutó compilador) | — | ⚠️ NO VERIFICADO |

---

## Findings

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|--------------|
| F1 | **MEDIUM** | Auth bypass edge case | `if (!apiKey)` solo bloquea `null` y `""`. Un header `x-api-key: "   "` (whitespace-only) pasa la validación (`!"   "` = `false`) y se reenvía tal cual al compose, que probablemente lo rechaza. Debería ser `if (!apiKey?.trim())`. | `autonomous/route.ts:22` |
| F2 | **LOW** | Timeout incompleto (AbortController) | `clearTimeout(timeout)` se llama justo después de que el `fetch()` resuelve, ANTES de `await composeRes.json()`. Si la lectura del body se cuelga, ya no hay timeout activo. El AbortController solo cubre la conexión/headers, no la lectura del body. Fix: mover `clearTimeout` a después de `.json()`, o usar `Promise.race`. | `autonomous/route.ts:73-74` |
| F3 | **LOW** | maxTokens vs límite de palabras | REPORT_SYSTEM exige ≤300 palabras pero `maxTokens: 400`. A ~0.75 words/token eso son ~300 palabras, coincide aproximadamente, pero no garantiza el límite. Un LLM verboso puede excederlo. No es un bug funcional pero viola el AC5 estrictamente. | `autonomous/route.ts:81` |
| F4 | **LOW** | Seguridad UI — API key en localStorage en texto plano | La API key se persiste en `localStorage` sin cifrado. Cualquier XSS puede extraerla. Riesgo aceptable para demo pero debe documentarse. | `DemoPageClient.tsx:13,32-34` |
| F5 | **MEDIUM** | chat/route.ts — compose sin AbortController | La ruta `/api/v1/chat` hace fetch a compose SIN AbortController ni timeout (a diferencia del autonomous que usa 50000ms). Un compose colgado puede bloquear indefinidamente el worker de Next.js. No es un AC de WAS-256 pero el refactor introdujo o mantuvo esta inconsistencia. | `chat/route.ts:126-135` |
| F6 | **INFO** | Discovery 'ok' agrupa dos operaciones distintas | El push `{name:'discovery', status:'ok'}` ocurre DESPUÉS de tanto `getCollectionAgents()` como `callLLM()` (planner). Si el LLM planner falla, se reporta `discovery:error` aunque el fetch de agentes fue exitoso. La granularidad es menor de lo esperado, pero es consistente con la definición del AC2 ("fase Discovery = planner usa agentes activos"). No es un bug, solo diseño a documentar. | `autonomous/route.ts:42` |
| F7 | **INFO** | AC12 no verificado en este audit | No se ejecutó `tsc --noEmit` como parte del análisis estático. Los tipos observados en el código no muestran castings peligrosos obvios (`as Record<string,unknown>` en steps está acotado). Recomendado ejecutar como parte del CI antes de merge. | — |

---

## Análisis de Regresión — chat/route.ts

El refactor extrajo `getCollectionAgents()` y `buildPlannerPrompt()` a `collection-agents.ts`. La lógica de `chat/route.ts` **NO se rompió**: los pasos 3-11 reproducen la misma normalización/filtrado que existía antes. Las diferencias vs el autonomous son esperadas (límite 5 steps vs 3, sin AbortController, sin phases). La única regresión potencial es F5 (sin timeout en compose).

---

## Veredicto

**REQUIERE CORRECCIÓN**

### Obligatorio antes de merge:
- **F1**: Cambiar `if (!apiKey)` por `if (!apiKey?.trim())` en `autonomous/route.ts:22` — evita bypass con whitespace key.

### Recomendado (no bloqueante):
- **F2**: Mover `clearTimeout(timeout)` a después de `composeRes.json()` o envolver con `Promise.race` para cubrir la lectura del body.
- **F5**: Agregar AbortController al fetch de compose en `chat/route.ts` (alinear con comportamiento de autonomous).

### Opcional / Futuro:
- **F3**: Ajustar maxTokens a ~350 o añadir instrucción de conteo explícito en REPORT_SYSTEM.
- **F4**: Evaluar cifrado de API key en localStorage para producción.
- **AC12**: Confirmar `tsc --noEmit` en pipeline CI.
