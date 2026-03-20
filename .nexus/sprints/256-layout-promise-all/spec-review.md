# Spec Review — SDD #256 — Layout Promise.all

**Fecha:** 2026-03-20  
**Reviewer:** Spec Reviewer NexusAgil v1.3  
**Archivo objetivo:** `src/app/[locale]/layout.tsx`

---

## Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix existe | ✅ PASS (NOT implemented) | El archivo usa `await getMessages()` + `await createClient()` secuenciales — el fix aún no está aplicado |
| 0.2 Archivos existen | ✅ PASS | `src/app/[locale]/layout.tsx` existe y contiene exactamente el código referenciado en el SDD |
| 0.3a Tipos correctos | ✅ PASS | `createClient()` retorna `Promise<SupabaseClient>` — destructurar como `supabase` en el array de Promise.all mantiene el tipo correcto. `supabase.auth.getUser()` subsiguiente es válido. |
| 0.3b Imports correctos | ✅ PASS | `getMessages` (from `next-intl/server`) y `createClient` (from `@/lib/supabase/server`) ya están importados en el archivo |
| 0.4 Dependencias | ✅ PASS | SDD #256 no depende de ningún otro SDD |
| 0.5 Completitud | ⚠️ PARCIAL | Waves W0/W1/W2 definidas pero **sin rollback ejecutable** especificado en ninguna wave |

---

## Coherencia

| Check | Resultado | Detalle |
|-------|-----------|---------|
| AC → Wave trazabilidad | ✅ PASS | AC1-2 cubiertos en W1, AC3 verificable en W2, AC4 implícito (Next.js error boundary hereda), AC5 (tsc) en W1 |
| Build gates | ✅ PASS | W1 incluye tsc, W2 incluye build completo |
| Rollback | ❌ FAIL | El SDD no especifica pasos de rollback ejecutables. Para un layout crítico, es imprescindible: `git stash` o `git checkout -- src/app/[locale]/layout.tsx` |
| Constraints (≥3 PROHIBIDO) | ✅ PASS | 4 restricciones PROHIBIDO definidas (otros archivos, cambiar JSX, props WasiNavBar/BottomTabBar, props NextIntlClientProvider, manejo errores extra) |

---

## Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| F1 | 🟡 MEDIUM | **Rollback ausente**: El SDD no incluye instrucción de rollback ejecutable en ninguna wave. Si el build falla post-implementación, el Builder no tiene instrucción clara. | Agregar en W1: "Rollback: `git checkout -- src/app/[locale]/layout.tsx`" |
| F2 | 🟢 LOW | **AC4 trazabilidad implícita**: AC4 ("error SHALL propagate to error boundary") no tiene wave explícita que lo verifique — se asume por comportamiento por defecto de `async` Server Components en Next.js. Si hay un error boundary custom, debería verificarse. | Agregar nota en W2: "Verificar que errores de Promise.all alcanzan el error boundary de Next.js (comportamiento default de Server Components)" |

---

## Veredicto

**LISTO** — con observaciones menores.

El fix es técnicamente correcto y seguro. El código actual coincide exactamente con lo descrito en el SDD, los imports ya existen, los tipos son compatibles. Las 2 findings son de documentación/proceso (rollback y trazabilidad AC4) y no bloquean la implementación.

> **Nota al Builder:** Agregar rollback al inicio del trabajo — `git stash` antes de modificar o tomar nota del commit actual.
