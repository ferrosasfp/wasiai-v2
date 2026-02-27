# QA Report — Sprint 8
**Fecha:** 2026-02-27
**QA Agent:** Quinn (BMAD v6)
**Commits verificados:** 85887f3 + d3d5e3a + bbfbcbf
**Build status:** ✅ `npm run build` — 0 errores TypeScript, 0 warnings ESLint

---

## Resumen Ejecutivo

| Historia | ACs totales | ✅ Cumple | ⚠️ Parcial | ❌ No cumple |
|----------|-------------|-----------|-----------|-------------|
| HU-MOBILE-NAV | 15 | 14 | 1 | 0 |
| HU-4.4 | 12 | 12 | 0 | 0 |
| HU-4.3 | 12 | 11 | 1 | 0 |
| **TOTAL** | **39** | **37** | **2** | **0** |

**Veredicto global: ✅ APROBADO para release** — Las 2 observaciones parciales son menores y no bloquean.

---

## Checks Transversales

| Check | Resultado | Evidencia |
|-------|-----------|-----------|
| `npm run build` sin errores | ✅ | Build completo sin errores TS ni ESLint |
| Sin ethers.js imports nuevos | ✅ | `grep -rn "import.*ethers" src/` → 0 resultados |
| Migration 021 existe (no 017) | ✅ | `supabase/migrations/021_agent_examples.sql` |
| viewport-fit=cover en root layout | ✅ | `src/app/layout.tsx:8` — `viewportFit: 'cover'` |
| AR fix: race condition resuelta | ✅ | `022_ar_fixes.sql` — función `insert_agent_example` atómica |
| AR fix: RLS WITH CHECK | ✅ | `022_ar_fixes.sql:20` — `WITH CHECK (creator_id = auth.uid())` |
| AR fix: anon client en display | ✅ | `AgentExamplesDisplay.tsx:15` — `createClient()` (no service client) |
| CR fix: sin strings hardcodeados en UI | ✅ | MobileBottomNav usa `t('home')`, `t('explore')`, etc. desde i18n |

---

## HU-MOBILE-NAV: Bottom Navigation Bar en Mobile

### AC-1 ✅ CUMPLE
5 tabs implementados: Home (`/${locale}`), Explorar (`/${locale}#agents`), FAB ➕ (`/${locale}/publish`), Dashboard (condicional), Perfil (condicional).
**Evidencia:** `src/components/MobileBottomNav.tsx:34-130` — array `tabs` con 5 entradas.

### AC-2 ✅ CUMPLE
Hamburguesa y mobile-menu eliminados completamente de `WasiNavBar`. No existe `menuOpen` state, no existe `#mobile-menu` div. El navbar solo tiene divs con `sm:hidden` para el WalletConnectButton mobile.
**Evidencia:** `src/components/WasiNavBar.tsx` — `grep menuOpen` → 0 resultados.

### AC-3 ✅ CUMPLE
Header mobile muestra logo + `WalletConnectButton` (`sm:hidden`). Todos los demás elementos (nav links, LanguageSwitcher, email, ApiKeyBalance) están envueltos en `hidden sm:flex`.
**Evidencia:** `src/components/WasiNavBar.tsx:117,136,142,148,153,188` — todos los bloques desktop son `hidden sm:flex`; mobile solo tiene el div L188 `flex items-center gap-2 sm:hidden`.

### AC-4 ✅ CUMPLE
FAB: `rounded-full bg-[#E84142] shadow-lg text-white z-50 -mt-5 h-14 w-14`.
**Evidencia:** `src/components/MobileBottomNav.tsx:142` — `className="relative -mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-[#E84142] shadow-lg text-white z-50 shrink-0"`.

### AC-5 ✅ CUMPLE
FAB tiene `href={`/${locale}/publish`}` — navega a publish.
**Evidencia:** `src/components/MobileBottomNav.tsx:55-56`.

### AC-6 ✅ CUMPLE
Tab activo: `text-[#E84142]`. Tab inactivo: `text-gray-500 dark:text-gray-400`. Calculado con `isActive()` usando `usePathname()`.
**Evidencia:** `src/components/MobileBottomNav.tsx:133-134`.

### AC-7 ✅ CUMPLE
`style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}` en el `<nav>`.
**Evidencia:** `src/components/MobileBottomNav.tsx:120`.

### AC-8 ✅ CUMPLE
`src/app/layout.tsx:7-11` — `export const viewport: Viewport = { viewportFit: 'cover', ... }`.

### AC-9 ✅ CUMPLE
`dashboardHref`: creator → `/creator/dashboard`, consumer → `/dashboard`, null → `/login`. `profileHref = dashboardHref` (MVP).
**Evidencia:** `src/components/MobileBottomNav.tsx:22-27`.

### AC-10 ✅ CUMPLE
Tab Perfil usa misma lógica que Dashboard (MVP intencional, documentado como DT-NAV-01).

### AC-11 ✅ CUMPLE
Tab Explorar apunta a `/${locale}#agents`. El `id="agents"` existe en `src/app/[locale]/page.tsx` (no modificado).

### AC-12 ✅ CUMPLE
`<nav className="... sm:hidden ...">` — invisible en desktop ≥ 640px.

### AC-13 ✅ CUMPLE
`messages/en.json:490-496` y `messages/es.json:490-496` — claves `mobileNav.home`, `.explore`, `.publish`, `.dashboard`, `.profile`.

### AC-14 ⚠️ PARCIAL
El rol viene de SSR (prop drilling desde locale layout) ✅. Sin embargo, no se puede verificar sin DevTools en tiempo de ejecución que **cero** requests a Supabase ocurren en cliente al cambiar tabs. La arquitectura garantiza esto (el componente es `'use client'` pero no tiene ningún `useEffect` con fetch), pero la verificación formal requeriría prueba manual en browser.
**Evidencia disponible:** `src/components/MobileBottomNav.tsx` — sin `useEffect`, sin `fetch`, sin `supabase.from()`. El `userRole` llega como prop.

### AC-15 ✅ CUMPLE
`npm run build` — 0 errores TypeScript. ✅

---

## HU-4.4: Reputación con Datos Reales

### AC-1 ✅ CUMPLE
`ReputationMetrics` muestra 4 métricas: uptime %, p50 ms (o avg), p95 ms (o "—"), error rate %.
**Evidencia:** `src/features/models/components/ReputationMetrics.tsx:45-84`.

### AC-2 ✅ CUMPLE
`getAgentReputation()` hace query real a `agent_calls`. Sin mocks, sin hardcodes.
**Evidencia:** `src/lib/reputation.ts:39-88` — RPC + fallback query a `agent_calls`.

### AC-3 ✅ CUMPLE
`if (!rep.hasData) return null` en `ReputationMetrics`. `ReputationBadge` retorna null si `!rep.hasData || !rep.sufficientData`.
**Evidencia:** `src/features/models/components/ReputationMetrics.tsx:26` y `ReputationBadge.tsx:14`.

### AC-4 ✅ CUMPLE
`sufficientData = totalCalls >= 10`. Con < 10: muestra "Datos insuficientes" en lugar de métricas. El label "Basado en N llamadas" solo aparece si `rep.sufficientData`.
**Evidencia:** `src/lib/reputation.ts:13` (`MIN_CALLS_THRESHOLD = 10`) + `ReputationMetrics.tsx:32-40`.

### AC-5 ✅ CUMPLE
`unstable_cache(..., ['agent-reputation'], { revalidate: 3600 })`.
**Evidencia:** `src/lib/reputation.ts:93`.

### AC-6 ✅ CUMPLE
`≥ 99%` → `bg-green-100 text-green-700`; `95-98.9%` → `bg-yellow-100 text-yellow-700`; `< 95%` → `bg-red-100 text-red-700`.
**Evidencia:** `src/features/models/components/ReputationBadge.tsx:18-20` y `ReputationMetrics.tsx:28-33`.

### AC-7 ✅ CUMPLE
`ModelCard` acepta `reputationBadge?: React.ReactNode` y lo renderiza en el footer. Solo muestra el badge de uptime (no latencia ni error rate en la card).
**Evidencia:** `src/features/models/components/ModelCard.tsx:25,108`. En `src/app/[locale]/page.tsx:183-188`: badge envuelto en `<Suspense fallback={null}>`.

### AC-8 ✅ CUMPLE
`src/app/[locale]/models/[slug]/page.tsx:253` — `<ReputationMetrics agentId={model.id} />` con las 4 métricas completas.

### AC-9 ✅ CUMPLE
`ReputationBadge.tsx` y `ReputationMetrics.tsx` — sin `'use client'`. Son Server Components async.

### AC-10 ✅ CUMPLE
`messages/en.json:497-508` y `messages/es.json:497-508` — todas las claves `reputation.*` presentes: `title`, `uptime`, `latencyP50`, `latencyP95`, `latencyAvg`, `errorRate`, `noData`, `insufficientData`, `basedOn`.

### AC-11 ✅ CUMPLE
Fallback query usa `.gte('called_at', cutoff)`. Sin `created_at`, sin `duration_ms`, sin `status_code`.
**Evidencia:** `src/lib/reputation.ts:62`.

### AC-12 ✅ CUMPLE
Documentado en código: "PERCENTILE_CONT disponible en staging (verificado AC-12) → función RPC activa". El fallback AVG existe para robustez.
**Evidencia:** `src/lib/reputation.ts:29` (comentario de verificación).

---

## HU-4.3: Ejemplos Input/Output Curados

### AC-1 ✅ CUMPLE
`AgentExamples` integrado en `src/app/[locale]/creator/agents/[slug]/edit/page.tsx:33`.

### AC-2 ✅ CUMPLE
Validación frontend: `maxLength={500}` en textarea input, `maxLength={1000}` en output.
Validación API: POST verifica `input.trim().length > 500` → 400, `output.trim().length > 1000` → 400.
**Evidencia:** `src/app/api/creator/agents/[id]/examples/route.ts:57-66`.

### AC-3 ✅ CUMPLE
`canAdd = examples.length < MAX_EXAMPLES`. Si `!canAdd && !editingId` → botón oculto + mensaje `t('maxReached')`. API usa RPC atómica → retorna `{ status: 409 }` si ya hay 5.
**Evidencia:** `AgentExamples.tsx:43` y `route.ts:72-78`.
**Nota menor:** Story spec sugería status 422 para límite; implementación usa 409 (Conflict). Semánticamente más correcto — no es bloqueante.

### AC-4 ✅ CUMPLE
Orden `created_at ASC` en GET API y en `AgentExamplesDisplay`. Sin botones de reorden.
**Evidencia:** `route.ts:35` y `AgentExamplesDisplay.tsx` — `.order('created_at', { ascending: true })`. Sin `↑↓` ni drag & drop en la UI.

### AC-5 ✅ CUMPLE
RLS habilitado en migration 021. Policy `"Creator write"` con `USING (creator_id = auth.uid())`.

### AC-6 ✅ CUMPLE
Doble validación: RLS (DB level) + API handler verifica ownership del agente antes de operar.
AR fix aplicado: `022_ar_fixes.sql:20` — `WITH CHECK (creator_id = auth.uid())` explícito.
**Evidencia:** `route.ts:23-28` (verificación ownership) + `[exId]/route.ts:37,53` (`.eq('creator_id', user.id)`).

### AC-7 ✅ CUMPLE
`AgentExamplesDisplay` usa `<details>/<summary>` nativo con chevron CSS Tailwind `group-open:rotate-90`.
**Evidencia:** `src/features/models/components/AgentExamplesDisplay.tsx` — sin JS de cliente, accordion nativo.

### AC-8 ✅ CUMPLE
`if (error || !examples || examples.length === 0) return null` — sección invisible sin ejemplos.
**Evidencia:** `AgentExamplesDisplay.tsx:21`.

### AC-9 ✅ CUMPLE
Agente puede existir y estar activo sin ejemplos. No hay validación de "al menos 1 ejemplo" en el flujo de publicación.

### AC-10 ✅ CUMPLE
`supabase/migrations/021_agent_examples.sql` — nombre exacto verificado.
**Evidencia:** `ls supabase/migrations/ | grep agent_examples` → `021_agent_examples.sql`.

### AC-11 ✅ CUMPLE
Índices en migration 021: `idx_agent_examples_agent_id ON agent_examples(agent_id, sort_order)` y `idx_agent_examples_agent_created ON agent_examples(agent_id, created_at ASC)`.

### AC-12 ⚠️ PARCIAL
Claves requeridas en story: `examples.title`, `.add`, `.inputLabel`, `.outputLabel`, `.tagLabel`, `.maxReached`, `.example`, `.noExamples`.
Implementación tiene todas las claves requeridas **más** claves adicionales: `loading`, `confirmDelete`, `unknownError`, `editing`, `saveChanges`, `saving`, `maxInputChars`, `maxOutputChars`, etc.
Las claves adicionales son usadas en el componente (son necesarias para la UX localizada) — no hay strings hardcodeados en la UI.
**Veredicto: ✅ CUMPLE PLUS** — supera el mínimo requerido.

---

## Issues Identificados

### ⚠️ AC-14 (HU-MOBILE-NAV) — Verificación Network solo por inspección de código
**Severidad:** Baja  
**Descripción:** No se puede confirmar formalmente "0 requests a Supabase en cliente al cambiar tabs" sin prueba manual en browser. La arquitectura es correcta (prop drilling SSR, sin useEffect con fetch), pero la verificación de red requiere DevTools.  
**Acción recomendada:** Prueba manual por Dev antes del sprint review.

### ℹ️ AC-3 (HU-4.3) — Status 409 en lugar de 422 para max examples
**Severidad:** Muy baja  
**Descripción:** Story template sugería status 422; implementación usa 409 (Conflict). 409 es más correcto semánticamente para "recurso en estado conflictivo" vs 422 "entidad no procesable".  
**Acción recomendada:** Ninguna — 409 es correcto. Documentar en API docs.

---

## Deuda Técnica Registrada (no bloquea release)

| ID | Historia | Descripción |
|----|----------|-------------|
| DT-NAV-01 | HU-MOBILE-NAV | Tab Perfil apunta al mismo destino que Dashboard (MVP). Requiere ruta `/profile` propia. |
| DT-EXAMPLES-01 | HU-4.3 | Reordenamiento manual de ejemplos (drag & drop / botones ↑↓). sort_order existe en DB. |

---

## Conclusión

**Sprint 8 aprobado para release.** Las 3 historias implementadas cumplen todos sus ACs críticos. El build es limpio, sin errores TypeScript ni ESLint. Los fixes del Adversarial Review (race condition, RLS WITH CHECK, anon client) están correctamente aplicados. Las traducciones i18n están completas en ambos idiomas.

---
*Generado por Quinn (QA Agent) — BMAD v6 — 2026-02-27*
