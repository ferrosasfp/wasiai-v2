# Code Review — Sprint 8 (commits 85887f3 + d3d5e3a)
**Fecha:** 2026-02-27  
**Revisor:** Agente CR (BMAD Method v6)  
**Scope:** HU-4.3 (AgentExamples CRUD), HU-4.4 (Reputation), HU-MOBILE-NAV  
**Veredicto general:** ⚠️ CONDICIONAL — 3 DEBE CORREGIR, 4 SUGERENCIAS

---

## Confirmación de fixes AR

Antes del review de calidad, verificar que los problemas del AR fueron resueltos en commit d3d5e3a:

| Issue AR | Estado |
|----------|--------|
| B-01 — Race condition límite ejemplos | ✅ Resuelto — `022_ar_fixes.sql` crea `insert_agent_example()` RPC con INSERT condicional atómico |
| M-01 — RLS `WITH CHECK` implícito | ✅ Resuelto — 021 ya lo tiene explícito; 022 lo dropa/recrea limpiamente |
| M-02 — Service client para datos públicos | ✅ Resuelto — `AgentExamplesDisplay.tsx` ahora usa `createClient()` (anon) |
| M-03 — Dead code en WasiNavBar | ✅ Resuelto — `WasiNavBar.tsx` no contiene `menuOpen`, hamburger ni bloque `{false &&}` |
| M-04 — `fetchExamples` duplicado | ✅ Resuelto — `useEffect` usa `fetchExamples` vía `useCallback`; lógica unificada |

---

## DEBE CORREGIR

### ❌ CR-01 — Strings hardcodeados en español en `AgentExamples.tsx`

**Archivo:** `src/features/creator/components/AgentExamples.tsx`  
**Severidad:** DEBE CORREGIR — viola la regla absoluta de i18n del proyecto

El componente declara `t = useTranslations('examples')` pero tiene ~10 strings hardcodeados en español en la UI:

```tsx
// loading state — línea ~73
return <div className="py-4 text-sm text-gray-400">Cargando ejemplos...</div>

// form header — no traducido
<h4 className="text-sm font-medium text-gray-700">
  {editingId ? 'Editando ejemplo' : t('add')}   // ← 'Editando ejemplo' hardcoded
</h4>

// botones de acción
<button ...>{submitting ? 'Guardando...' : editingId ? 'Guardar cambios' : t('add')}</button>
<button ...>Cancelar</button>

// botones inline en lista
<button ...>Editar</button>
<button ...>Eliminar</button>

// confirm dialog
if (!confirm('¿Eliminar este ejemplo?')) return

// error fallback
setError(msg ?? 'Error desconocido')

// labels con hints
<span className="text-gray-400">(máx. 500 chars)</span>
<span className="text-gray-400">(máx. 1000 chars)</span>
```

**Fix requerido:** Mover todos los strings al namespace `examples` en `/messages/es.json` y `/messages/en.json`, y referenciarlos vía `t('keyName')`.

Claves sugeridas a añadir:
```json
"examples": {
  "loading": "Cargando ejemplos...",
  "editing": "Editando ejemplo",
  "saving": "Guardando...",
  "saveChanges": "Guardar cambios",
  "cancel": "Cancelar",
  "edit": "Editar",
  "delete": "Eliminar",
  "deleteConfirm": "¿Eliminar este ejemplo?",
  "unknownError": "Error desconocido",
  "maxInputChars": "(máx. 500 chars)",
  "maxOutputChars": "(máx. 1000 chars)"
}
```

---

### ❌ CR-02 — String `(aprox)` hardcodeado en `ReputationMetrics.tsx`

**Archivo:** `src/features/models/components/ReputationMetrics.tsx`  
**Severidad:** DEBE CORREGIR — i18n violation

```tsx
{rep.usingFallback && rep.p50Ms !== null && (
  <span className="text-xs text-gray-400 ml-1">(aprox)</span>   // ← hardcoded ES
)}
```

El resto del componente usa `t()` correctamente. Este string se escapó.

**Fix requerido:**
```tsx
<span className="text-xs text-gray-400 ml-1">{t('approx')}</span>
```

Añadir `"approx": "(aprox)"` / `"approx": "(approx)"` al namespace `reputation` en es/en.

---

### ❌ CR-03 — `aria-label` en inglés hardcodeados en `WasiNavBar.tsx`

**Archivo:** `src/components/WasiNavBar.tsx`  
**Severidad:** DEBE CORREGIR — accessibility + i18n inconsistente

El componente usa `tAuth` y `tNav` para todos los textos visibles pero tiene 4 aria-labels en inglés hardcodeados:

```tsx
<nav aria-label="Main navigation">           // ← hardcoded EN
<Link aria-label="WasiAI — go to homepage">  // ← hardcoded EN
<div aria-label="Loading user...">           // ← hardcoded EN
<button aria-label="Sign out of your account"> // ← hardcoded EN
```

Contraste: `MobileBottomNav.tsx` usa `aria-label="Navegación principal mobile"` en español. La inconsistencia es visible.

**Fix requerido:** Mover estos strings al namespace `nav` o `aria` en los archivos de mensajes y usar `tNav('ariaMain')`, etc.

---

## SUGERENCIAS

### 💡 CR-S01 — Extracción de locale por `pathname.split` en WasiNavBar vs `useLocale()`

**Archivo:** `src/components/WasiNavBar.tsx`

```tsx
const locale = pathname.split('/')[1] || 'en'  // ← frágil
```

Funciona en la estructura actual (`/en/...`, `/es/...`) pero si cambia el routing o se añade un prefijo de path, silenciosamente extrae el segmento equivocado sin error. `next-intl` expone `useLocale()` exactamente para esto.

```tsx
import { useLocale } from 'next-intl'
const locale = useLocale()
```

Cambio de 1 línea, más robusto.

---

### 💡 CR-S02 — `label: undefined` redundante en `NAV_PATHS`

**Archivo:** `src/components/WasiNavBar.tsx`

```tsx
const NAV_PATHS = [
  { path: '/publish',    tKey: 'publish' as const, label: undefined },  // ← ruido
  { path: '/agent-keys', tKey: 'agentKeys' as const, label: undefined },
]
```

Si `tKey` está definido, `label` nunca se usa (la lógica del `.map()` devuelve `tNav(tKey)` cuando `tKey` existe). Las asignaciones `label: undefined` son ruido que confunde la estructura. Eliminar esas entradas o tipar el objeto sin `label` cuando hay `tKey`.

---

### 💡 CR-S03 — `insert_agent_example` no recibe `sort_order`

**Archivo:** `supabase/migrations/022_ar_fixes.sql`

La función RPC fija el `sort_order` en su default (`0`) para todos los ejemplos nuevos:

```sql
INSERT INTO agent_examples (agent_id, creator_id, input, output, label)
-- ↑ sort_order no incluido → DEFAULT 0 en todos
```

El display actual ordena por `created_at ASC` (índice `idx_agent_examples_agent_created`), así que no hay bug visible. Pero `sort_order` fue diseñado para permitir drag-and-drop futuro. Si se implementa sin actualizar la RPC, los ejemplos creados vía RPC empezarán todos con `sort_order=0` y el reordenamiento no tendrá baseline correcto.

**Sugerencia:** Añadir `p_sort_order INTEGER DEFAULT 0` al signature de la función para dejar el camino abierto:
```sql
CREATE OR REPLACE FUNCTION insert_agent_example(
  p_agent_id    UUID,
  p_creator_id  UUID,
  p_input       TEXT,
  p_output      TEXT,
  p_label       TEXT,
  p_sort_order  INTEGER DEFAULT 0   -- ← añadir
)
```

---

### 💡 CR-S04 — `catch {}` silencioso en fallback de `getAgentReputation`

**Archivo:** `src/lib/reputation.ts`

```ts
} catch {
  // PERCENTILE_CONT no disponible o RPC no existe → fallback
}
```

El catch silencioso es intencional (degradación limpia al fallback), pero en staging/dev puede enmascarar errores inesperados (e.g., RPC existe pero tiene un bug de parámetros). Considerar log condicional:

```ts
} catch (err) {
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[reputation] RPC fallback triggered:', err)
  }
}
```

---

## ✅ CORRECTO

| # | Componente | Check |
|---|-----------|-------|
| C-01 | `MobileBottomNav.tsx` | ✅ Totalmente i18n — todos los labels vía `t('...')` |
| C-02 | `MobileBottomNav.tsx` | ✅ No `any` — `UserRole` tipado desde `@/hooks/useUserRole` |
| C-03 | `MobileBottomNav.tsx` | ✅ Client Component marcado; `userRole` viene del server sin fetch cliente |
| C-04 | `MobileBottomNav.tsx` | ✅ `isActive()` maneja correctamente el caso de anchors (`href.includes('#')`) |
| C-05 | `MobileBottomNav.tsx` | ✅ `env(safe-area-inset-bottom)` con `viewportFit: 'cover'` en layout — patrón correcto iOS |
| C-06 | `ReputationBadge.tsx` | ✅ Server Component async — no `'use client'` |
| C-07 | `ReputationBadge.tsx` | ✅ Retorna `null` cuando no hay datos suficientes — no contamina ModelCard |
| C-08 | `ReputationBadge.tsx` | ✅ Colores semánticos correctos (≥99% verde, 95-99% amarillo, <95% rojo) |
| C-09 | `ReputationMetrics.tsx` | ✅ Server Component async con `getTranslations` de `next-intl/server` |
| C-10 | `ReputationMetrics.tsx` | ✅ `Promise.all([getAgentReputation, getTranslations])` — fetch paralelo correcto |
| C-11 | `ReputationMetrics.tsx` | ✅ `fmt()` helper claro y reutilizado internamente |
| C-12 | `ReputationMetrics.tsx` | ✅ Label condicional `latencyAvg` vs `latencyP50` según `usingFallback` |
| C-13 | `reputation.ts` | ✅ No `any` explícito — `ReputationData` completamente tipado |
| C-14 | `reputation.ts` | ✅ `unstable_cache` con `keyParts: ['agent-reputation']` + agentId como arg — cache key correcto |
| C-15 | `reputation.ts` | ✅ `MIN_CALLS_THRESHOLD = 10` como constante nombrada |
| C-16 | `reputation.ts` | ✅ Fallback a AVG cuando PERCENTILE_CONT no disponible — degradación limpia |
| C-17 | `reputation.ts` | ✅ `called_at` (no `created_at`) en filtro de 24h — comentario crítico presente |
| C-18 | `AgentExamples.tsx` | ✅ `activeRef` pattern para evitar setState post-unmount — consistente con `CreatorAnalytics` |
| C-19 | `AgentExamples.tsx` | ✅ `fetchExamples` como `useCallback` usado en `useEffect` (AR M-04 resuelto) |
| C-20 | `AgentExamples.tsx` | ✅ `canAdd || editingId` — muestra form para editar aunque límite esté alcanzado |
| C-21 | `AgentExamplesDisplay.tsx` | ✅ Server Component — `createClient()` anon (AR M-02 resuelto) |
| C-22 | `AgentExamplesDisplay.tsx` | ✅ `<details>/<summary>` accordion nativo sin JS — patrón elegante y accesible |
| C-23 | `AgentExamplesDisplay.tsx` | ✅ Retorna `null` si no hay ejemplos — sección invisible per spec |
| C-24 | `021_agent_examples.sql` | ✅ RLS habilitado + `WITH CHECK` explícito desde el inicio |
| C-25 | `021_agent_examples.sql` | ✅ Dos índices correctos: `(agent_id, sort_order)` y `(agent_id, created_at)` |
| C-26 | `021_agent_examples.sql` | ✅ `CHECK` constraints en texto alineados con validación del API (500/1000 chars) |
| C-27 | `021_agent_examples.sql` | ✅ `ON DELETE CASCADE` en ambas FKs — limpieza correcta |
| C-28 | `022_ar_fixes.sql` | ✅ `SECURITY INVOKER` — la función respeta RLS del caller, sin escalada de privilegios |
| C-29 | `022_ar_fixes.sql` | ✅ INSERT condicional atómico resuelve B-01 |
| C-30 | `WasiNavBar.tsx` | ✅ Sin dead code — `menuOpen` state, hamburger y bloque `{false &&}` eliminados (AR M-03 resuelto) |
| C-31 | `WasiNavBar.tsx` | ✅ Auth state con hydration desde server (`initialEmail` prop) sin flash |
| C-32 | `WasiNavBar.tsx` | ✅ `subscription?.unsubscribe()` con optional chain — guard contra null (T-33) |
| C-33 | `layout.tsx` | ✅ `viewportFit: 'cover'` — crítico para `env(safe-area-inset-bottom)` en iOS |
| C-34 | `layout.tsx` | ✅ `APP_URL` desde env var — sin hardcode de URL de producción |

---

## Resumen ejecutivo

El Sprint 8 llega al Code Review con todos los problemas del AR ya resueltos (commit d3d5e3a fue efectivo). Los problemas restantes son exclusivamente de calidad de código, no de seguridad.

**3 DEBE CORREGIR:** Los tres son violaciones de i18n — strings hardcodeados en español/inglés en componentes que ya usan `useTranslations`/`getTranslations`. Son fáciles de corregir (añadir claves a `/messages/es.json` y `/messages/en.json` y reemplazar strings literales). No requieren cambios de lógica.

**4 SUGERENCIAS:** Mejoras de robustez y claridad, ninguna urgente para producción.

**Acción requerida antes de QA:**
1. Resolver CR-01 — i18n en `AgentExamples.tsx` (aprox. 10 strings)
2. Resolver CR-02 — `(aprox)` en `ReputationMetrics.tsx` (1 string)
3. Resolver CR-03 — aria-labels en `WasiNavBar.tsx` (4 strings)

---
*Generado automáticamente por el agente CR del BMAD Method v6*
