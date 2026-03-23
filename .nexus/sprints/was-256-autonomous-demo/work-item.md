# Work Item — WAS-256: Autonomous Agent Demo

> Tipo: HU-MAJOR
> Sprint: Hackathon Aleph (20-22 marzo 2026)
> Dependencias: WAS-254 (transform layer) ✅, WAS-255 (chat) ✅
> Sprint dir: .nexus/sprints/was-256-autonomous-demo/

---

## Contexto

WasiAI necesita un endpoint de demo autónomo para el hackathon Aleph que demuestre la capacidad de la plataforma de orquestar múltiples agentes para resolver un objetivo sin que el usuario defina los pasos manualmente. El usuario describe un goal en lenguaje natural y el sistema descubre, planea, ejecuta y reporta.

## Historia de Usuario

**Como** desarrollador/evaluador evaluando WasiAI en el hackathon Aleph,
**quiero** enviar un goal en lenguaje natural (ej: "analiza el riesgo de AVAX"),
**para que** el sistema descubra automáticamente qué agentes necesita, los ejecute en pipeline y devuelva un reporte estructurado con el resultado, los pasos ejecutados y el costo total — sin que yo tenga que conocer los agentes disponibles.

## Acceptance Criteria (EARS)

**AC1** — WHEN POST /api/v1/demo/autonomous con `{goal: string}` y header `x-api-key: <key>` válida, THEN el sistema responde HTTP 200 con `{report, phases, total_cost_usdc, pipeline_id}` en ≤60 segundos.

**AC2** — WHEN fase Discovery, THEN el LLM planner genera un array de ComposeStep[] usando ÚNICAMENTE agentes de la colección `defi-chat` con status `active` en la DB.

**AC3** — WHEN fase Planning, THEN el sistema valida slugs contra DB, normaliza pasos (strip input si pass_output=true, agent→agent_slug), y retorna 422 si el goal no es DeFi/crypto.

**AC4** — WHEN fase Execution, THEN el sistema llama internamente a `/api/v1/compose` con los steps validados y retorna 502 si compose falla.

**AC5** — WHEN fase Report, THEN el LLM genera un `report` en lenguaje natural (≤300 palabras) con precio del token, análisis de riesgo y recomendación.

**AC6** — WHEN la respuesta 200, THEN `phases` contiene array de `{name, status, detail}` para cada fase (discovery, planning, execution, report).

**AC7** — WHEN la UI en `/en/demo`, THEN existe una página con textarea para el goal, campo API key (type=password con toggle), botón submit, spinner durante ejecución, y display del report + fases + costo.

**AC8** — WHEN el Chat DeFi collection card, THEN NO aparece botón a `/demo` (el demo es accesible desde navbar o URL directa).

**AC9** — `npx tsc --noEmit` y `npm run build` pasan sin errores.

## Archivos afectados

- **CREAR:** `src/lib/agents/collection-agents.ts` (extraer y exportar `getCollectionAgents()` desde chat/route.ts)
- **MODIFICAR:** `src/app/api/v1/chat/route.ts` (importar `getCollectionAgents` desde el shared module)
- **CREAR:** `src/app/api/v1/demo/autonomous/route.ts`
- **CREAR:** `src/app/[locale]/demo/page.tsx`
- **CREAR:** `src/app/[locale]/demo/_components/DemoPageClient.tsx`
- **MODIFICAR:** `src/components/WasiNavBar.tsx` (añadir link "Demo" en nav)

## ACs adicionales (fixes F1-F3)

**AC10** — WHEN API key header falta o es inválida, THEN responde HTTP 401 `{error, code: 'unauthorized'}`.

**AC11** — WHEN `goal` está vacío o es solo whitespace, THEN responde HTTP 400 `{error, code: 'missing_goal'}`.

**AC12** — WHEN fase Discovery retorna array vacío (goal no-DeFi), THEN responde HTTP 422 `{error: 'I can only analyze DeFi/crypto topics', code: 'no_agents_matched'}`.

**AC13** — WHEN compose falla o excede timeout, THEN responde HTTP 502 `{error, code: 'execution_failed', phases}` con las fases hasta ese momento.

## Constraints

- `maxDuration = 60` en la ruta API
- Timeout interno compose: 50s (margen para report LLM)
- `getCollectionAgents()` extraída a `src/lib/agents/collection-agents.ts` — chat/route.ts la importa desde allí
- Reusar `callLLM`, `createServiceClient`
- No agregar dependencias npm nuevas
- No cambiar compose route
- No git push — solo commit local
- `NEXT_PUBLIC_SITE_URL` env var usada para URL interna del compose (ya existe en Vercel)

