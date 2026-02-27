# Sprint 8 — SDD Summary
**Agente:** Architect — BMAD v6  
**Fecha:** 2026-02-27  
**Sprint:** 8 | 2026-03-07 → 2026-03-14

---

## Estado de los SDDs

| HU | Prioridad | SDD | Estado |
|----|-----------|-----|--------|
| HU-MOBILE-NAV | P0 | `sdd-HU-MOBILE-NAV.md` | SPEC_PENDING |
| HU-4.4 | P1 | `sdd-HU-4.4.md` | SPEC_PENDING |
| HU-4.3 | P2 | `sdd-HU-4.3.md` | SPEC_PENDING |

---

## Hallazgos Críticos del Codebase

### 🚨 BLOQUEANTE — HU-4.3: Número de Migration Incorrecto

El PRD dice `017_agent_examples.sql` pero la migration 017 ya existe (`017_pipeline_executions.sql`). Las migrations actuales van hasta la 020. 

**La migration DEBE llamarse `021_agent_examples.sql`.**

El `project-context.md` está desactualizado en este punto (dice "Próxima: 017"). **Debe actualizarse a "Próxima: 021"** después de esta sprint.

---

### ✅ Verificaciones que NO requieren cambio en scope

| HU | Verificación | Resultado |
|----|-------------|-----------|
| MOBILE-NAV | `id="agents"` en page.tsx | ✅ Ya existe en `<section id="agents">` |
| MOBILE-NAV | `WalletConnectButton` path | ✅ `@/features/payments/components/WalletConnectButton` |
| 4.4 | `agent_calls.status` | ✅ `TEXT NOT NULL DEFAULT 'success'` |
| 4.4 | `agent_calls.latency_ms` | ✅ `INT nullable` |
| 4.4 | `agent_calls.is_trial` | ✅ migration 016 |
| 4.4 | Índice `(agent_id, called_at DESC)` | ✅ migration 020 |
| 4.4 | Columna `called_at` (no `created_at`) | ✅ Confirmado — Dev debe usar `called_at` en el WHERE |

---

### ⚠️ Puntos que requieren verificación antes de implementar

| HU | Punto | Acción |
|----|-------|--------|
| MOBILE-NAV | `viewport-fit=cover` en root layout | ❌ Ausente. Agregar `export const viewport: Viewport` en `src/app/layout.tsx` |
| MOBILE-NAV | Hamburguesa en mobile | 🔴 Visible. Cambiar clase del botón a `hidden`. Eliminar `#mobile-menu` block. |
| 4.4 | `PERCENTILE_CONT` disponible | ⚠️ Ejecutar `SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY 1::float);` en staging ANTES de implementar |
| 4.4 | Ruta real del detail page | ✅ Es `/models/[slug]`, no `/agents/[slug]` — verificado en codebase |
| 4.3 | Trigger `moddatetime` | ⚠️ No confirmado — usar `NOW()` en el PATCH handler para `updated_at` |
| 4.3 | Ruta de edición de agente | ⚠️ Dev debe revisar el dashboard y encontrar dónde editar agente individual |

---

## Resumen de Archivos por HU

### HU-MOBILE-NAV (P0)
**Crear:**
- `src/components/MobileBottomNav.tsx`
- `src/hooks/useUserRole.ts`

**Modificar:**
- `src/app/layout.tsx` → agregar `export const viewport`
- `src/app/[locale]/layout.tsx` → query role + pasar props a MobileBottomNav
- `src/components/WasiNavBar.tsx` → ocultar hamburguesa en mobile
- `src/messages/en.json` + `src/messages/es.json` → `mobileNav.*`

**No tocar:** `src/app/[locale]/page.tsx` (id="agents" ya existe)

### HU-4.4 (P1)
**Crear:**
- `src/lib/reputation.ts`
- `src/features/models/components/ReputationBadge.tsx`
- `src/features/models/components/ReputationMetrics.tsx`
- Función SQL `get_agent_reputation_percentile` (si PERCENTILE_CONT disponible)

**Modificar:**
- `src/features/models/components/ModelCard.tsx`
- `src/app/[locale]/models/[slug]/page.tsx`
- `src/messages/en.json` + `src/messages/es.json` → `reputation.*`

### HU-4.3 (P2)
**Crear:**
- `supabase/migrations/021_agent_examples.sql` ← número 021, no 017
- `src/features/creator/components/AgentExamples.tsx`
- `src/features/models/components/AgentExamplesDisplay.tsx`
- `src/app/api/creator/agents/[id]/examples/route.ts`
- `src/app/api/creator/agents/[id]/examples/[exId]/route.ts`

**Modificar:**
- `src/app/[locale]/creator/dashboard/page.tsx` (o ruta de edición de agente)
- `src/app/[locale]/models/[slug]/page.tsx`
- `src/messages/en.json` + `src/messages/es.json` → `examples.*`

---

## Dependencias entre HUs

```
HU-MOBILE-NAV ──────────────────────────────── independiente
HU-4.4        ──────────────────────────────── independiente  
HU-4.3        → requiere migration 021 aplicada en staging antes de codear componentes
```

Las 3 HUs son independientes entre sí. Pueden desarrollarse en paralelo con 2 devs si se quiere.

---

## Orden de Implementación Recomendado

1. **HU-4.3 primero:** Aplicar migration `021_agent_examples.sql` en staging cuanto antes para desbloquear desarrollo
2. **HU-4.4 segundo:** Verificar PERCENTILE_CONT en staging y crear función SQL si aplica
3. **HU-MOBILE-NAV tercero:** La más visual, ideal para validación QA al final del sprint

---

## Notas de Arquitectura del Sprint

### Decisiones de diseño tomadas en los SDDs

| Decisión | HU | Razón |
|----------|----|----|
| `useUserRole` usa prop drilling desde server layout | MOBILE-NAV | Evita query Supabase en cliente; el layout ya tiene `supabase.auth.getUser()` activo |
| Accordion con `<details>/<summary>` nativo | 4.3 | Sin dependencias adicionales (dnd-kit, headless-ui, etc.) |
| `called_at` (no `created_at`) en query de 24h | 4.4 | Columna real de `agent_calls` según migration 006 |
| Fallback a `AVG(latency_ms)` si no PERCENTILE_CONT | 4.4 | Resiliencia — funciona en todos los planes de Supabase |
| `updated_at` con `NOW()` en handler, sin trigger | 4.3 | `moddatetime` no confirmado en el proyecto |
| Migration número 021 | 4.3 | 017–020 ya existen; project-context.md desactualizado |

### Deuda Técnica del Sprint

| ID | HU | Descripción | Prioridad |
|----|----|-----------|----|
| DT-EXAMPLES-01 | 4.3 | Reordenamiento de ejemplos (sort_order, drag & drop, endpoint reorder) | P3 |

---

## Acción Requerida en `project-context.md`

Después de aplicar la migration 021, actualizar:
```
# ANTES (desactualizado):
*Última actualización: 2026-02-26 | Migrations aplicadas: 000–016 | Próxima: 017*

# DESPUÉS (correcto tras Sprint 8):
*Última actualización: 2026-03-14 | Migrations aplicadas: 000–021 | Próxima: 022*
```

---

*Generado por Architect — BMAD v6 — 2026-02-27*
