# Spec Review — SDD #094 (WAS-256)

**Reviewer:** Spec Reviewer — NexusAgile v1.3  
**Fecha:** 2026-03-21  
**SDD:** `/was-256-autonomous-demo/sdd.md`

---

## Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| **0.1** Fix ya existe? | ✅ NO existe | `demo/autonomous` no está en el codebase. `src/app/api/demo/agents/[slug]` existe pero es ruta distinta, sin conflicto. |
| **0.2a** `src/lib/agents/llm.ts` existe + exporta `callLLM` | ✅ OK | `export async function callLLM` en línea 98. |
| **0.2b** `src/lib/supabase/server.ts` existe + exporta `createServiceClient` | ✅ OK | `export function createServiceClient()` en línea 42. |
| **0.2c** `chat/route.ts` existe + `getCollectionAgents` local sin export | ✅ OK | `async function getCollectionAgents()` en línea 45 (sin `export`). |
| **0.2d** `collection-agents.ts` NO existe | ✅ OK | Archivo ausente — lista para crearse. |
| **0.2e** `src/app/[locale]/demo/` NO existe | ✅ OK | Solo existe `src/app/[locale]/chat/`. No hay colisión. |
| **0.2f** `WasiNavBar.tsx` existe + tiene `primaryLinks` | ✅ OK | Array `primaryLinks` definido en línea 93, con `{path, label}`. |
| **0.2g** `lucide-react` tiene `Eye`, `EyeOff` | ✅ OK | Importado y usado en `ChatPageClient.tsx` línea 7. |
| **0.3a** `callLLM` acepta `{messages, temperature, maxTokens}` | ✅ OK | `LLMOptions` interface tiene `messages`, `temperature?`, `maxTokens?`. |
| **0.3a** `createServiceClient()` retorna cliente con `.from()` | ✅ OK | Retorna `createClient(supabaseUrl, supabaseServiceKey)` — cliente standard. |
| **0.3a** `chat/route.ts` usa `NEXT_PUBLIC_SITE_URL` para compose fetch | ✅ OK | Línea 239: `process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.wasiai.io'`. |
| **0.3a** `primaryLinks` acepta `{path, label}` | ✅ OK | Todos los items siguen el patrón. `label` es `string` → hardcode `'Demo'` es válido. |
| **0.3b** Query Supabase `.eq('collections.slug', 'defi-chat')` | ✅ OK | Línea 53 de `chat/route.ts`: `.eq('collections.slug', 'defi-chat')` con `!inner` join — sintaxis correcta en PostgREST. |
| **0.4** WAS-254 y WAS-255 commiteados | ✅ OK | WAS-254: `8e4b65bc4`, WAS-255: `20dfd7391` — ambos en git log. |
| **0.5a** `REPORT_SYSTEM` prompt definido | ✅ OK | Sección 4.4 del SDD incluye el prompt completo. |
| **0.5b** Nav i18n resuelto | ⚠️ PARCIAL | SDD dice "hardcode OK" pero no prescribe definitivamente. Verificado: `primaryLinks.label` es `string` → hardcode `'Demo'` funciona sin `tNav()`. **No requiere acción — confirmado.** |
| **0.5c** `phases` array tiene estructura clara | ✅ OK | `{name: string, status: 'ok'\|'error', detail?: string}` definido en AC6 y sección 4.4. |

---

## Coherencia SDD

| Check | Resultado | Detalle |
|-------|-----------|---------|
| AC1-AC12 cubiertos por al menos una Wave | ✅ OK | AC1-AC10 → Wave 2; AC11 → Wave 3; AC12 → build gates W1+W3. |
| Cada Wave con build gate | ✅ OK | W1: `tsc --noEmit`; W2: `tsc --noEmit`; W3: `npm run build`. W0/W4 son pre-flight y git (no requieren gate). |
| Rollback ejecutable | ✅ OK | `git revert HEAD` + `trash` de archivos nuevos — pasos concretos. |
| ≥ 3 PROHIBIDO en Constraint Directives | ✅ OK | 7 PROHIBIDO listados. |

---

## Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| F1 | **MEDIUM** | `buildPlannerPrompt` — SDD da dos opciones: "reusar desde collection-agents O duplicar en shared module". Ambigüedad. Si se duplica, `demo/autonomous/route.ts` importa desde su propia copia y hay divergencia futura. Si no se incluye en el shared module, el Builder debe tomarlo de `chat/route.ts` (que no lo exportará). | **Prescribir**: incluir `buildPlannerPrompt` en `collection-agents.ts` como `export function buildPlannerPrompt(agents: CollectionAgent[]): string`. Chat/route.ts lo importa igual que `getCollectionAgents`. Demo lo importa también. Único source of truth. |
| F2 | **LOW** | Wave 3.3 añade `{ path: '/demo', label: 'Demo' }` a `primaryLinks`. La nota del SDD dice "verificar en Wave 0". El Spec Reviewer confirma: `label` es `string` — hardcode válido. Sin embargo, el archivo `messages/es.json` queda sin traducción si algún día se migra a i18n. No bloquea el build. | Documentar en Wave 3.3: "Añadir `{ path: '/demo', label: 'Demo' }` directamente (hardcode, sin `tNav()`). Confirmado válido por Spec Reviewer." Agregar TODO comment en el navbar. |
| F3 | **LOW** | `src/app/api/demo/` ya existe (ruta vieja de demo agents). Si alguien navega a `/api/demo/...` vs `/api/v1/demo/autonomous` podría haber confusión en logs. No es bloqueante. | Informativo. No acción requerida. Considerar añadir una nota en el SDD para el Builder. |
| F4 | **INFO** | El SDD en sección 4.3 lista las vars de caché como "module-level" pero no especifica los nombres exactos (`cachedAgents`, `cacheExpiresAt`, `CACHE_TTL_MS`). El Builder debe inferirlos de `chat/route.ts`. | OK siempre que el Exemplar sea claro (chat/route.ts líneas 8-68). No acción si el Builder lee el exemplar. |

---

## Veredicto

**LISTO CON CONDICIÓN**

El SDD es técnicamente sólido y puede entrar a Builder. **La única condición antes de iniciar Wave 1:**

> **F1 debe resolverse en el SDD**: el autor debe prescribir explícitamente que `buildPlannerPrompt` va en `collection-agents.ts` como función exportada (no duplicar, no dejar en chat/route.ts). Esto evita que el Builder tome la decisión equivocada bajo presión de hackathon.

F2 y F3 son informativos — no bloquean el build. F4 es no-acción.

---

*Spec Review generado por Spec Reviewer — NexusAgile v1.3*
