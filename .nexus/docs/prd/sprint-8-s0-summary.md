# Sprint 8 — Resumen S0
**Agente:** PM (John) — BMAD v6  
**Fecha:** 2026-02-27  
**Sprint:** 8 | 2026-03-07 → 2026-03-14  
**Tema:** Mobile UX & Discovery Quality  

---

## Estado de S0

| HU | Título | Prioridad | Tamaño | S0 | Revisión San | Gate |
|----|--------|-----------|--------|----|-------------|------|
| **HU-MOBILE-NAV** | Bottom nav bar mobile | P0 | M (3-5h) | ✅ [HU-MOBILE-NAV-s0.md](./HU-MOBILE-NAV-s0.md) | ✅ 2026-02-27 | ⏳ `HU_APPROVED` |
| **HU-4.4** | Reputación con datos reales | P1 | M (3-5h) | ✅ [HU-4.4-s0.md](./HU-4.4-s0.md) | ✅ 2026-02-27 | ⏳ `HU_APPROVED` |
| **HU-4.3** | Ejemplos input/output curados | P2 | M (4-6h) | ✅ [HU-4.3-s0.md](./HU-4.3-s0.md) | ✅ 2026-02-27 | ⏳ `HU_APPROVED` |

> **📋 Revisión técnica completada:** Los 3 S0 fueron revisados por San (orquestradora) el 2026-02-27 antes de pasar a Fer para HU_APPROVED. Las observaciones están integradas directamente en cada archivo S0.

> **Nota:** HU-3.2 (Playground comparativo) fue incluida en el sprint-8-planning pero excluida de este ciclo de S0 porque su scope es L y tiene dependencia en HU-MOBILE-NAV. Se puede S0-ear en el mismo sprint si HU-MOBILE-NAV se aprueba rápido.

---

## Decisiones Tomadas en Este S0

### HU-MOBILE-NAV

| Decisión | Opción elegida | Razón |
|----------|---------------|-------|
| Tab "Explorar" | `/${locale}#agents` (sin nueva ruta) | MVP: la sección de agentes ya existe en homepage. `/explore` como ruta propia es backlog P3. |
| Tab "Perfil" | Redirección condicional (creator→`/creator/dashboard`, consumer→`/dashboard`, no auth→`/login`) | Sin nueva ruta para MVP. El "perfil" del usuario ya vive en los dashboards existentes. |
| Tab "Dashboard" | Misma lógica condicional que Perfil | Redundancia aceptada y documentada. Se diferencia cuando exista `/profile`. |

---

## Dependencias entre HUs

```
HU-MOBILE-NAV  ─────────────────────────────►  HU-3.2 (depende de que nav esté lista)
HU-4.4         ─── independiente ───
HU-4.3         ─── independiente ─── (requiere migration 017 antes de codear)
```

**Orden de implementación recomendado:**
```
Día 1-2:  HU-MOBILE-NAV  (P0, base mobile)
Día 2-3:  HU-4.4         (independiente, puede ir en paralelo)
Día 3-4:  HU-4.3         (migration 017 + CRUD + UI)
Día 4-5:  HU-3.2         (si HU_APPROVED llega pronto — tiene S0 en sprint-8-planning.md)
```

---

## Checklist de Aprobación para Fer

Para activar el Gate 1 (HU_APPROVED) de cada historia, Fer debe:

1. Leer el S0 completo de cada HU
2. Escribir `HU_APPROVED HU-MOBILE-NAV` (o el nombre de la HU correspondiente)

> "Go", "Dale", "Sí", "Suena bien" **no activan el gate**. El texto debe ser exacto.

- [ ] `HU_APPROVED HU-MOBILE-NAV` — Lee: [HU-MOBILE-NAV-s0.md](./HU-MOBILE-NAV-s0.md)
- [ ] `HU_APPROVED HU-4.4` — Lee: [HU-4.4-s0.md](./HU-4.4-s0.md)
- [ ] `HU_APPROVED HU-4.3` — Lee: [HU-4.3-s0.md](./HU-4.3-s0.md)

---

## Qué sigue después de HU_APPROVED

```
HU_APPROVED
    ↓
S1: Architect genera SDD (rutas exactas, schema, componentes, DoD)
    ↓
SPEC_APPROVED (Fer lee el SDD y aprueba)
    ↓
SM genera story-HU-X.X.md (archivo autocontenido)
    ↓
Dev implementa DESDE el story file
```

---

## Puntos de Atención Pre-Implementación

1. **`viewport-fit=cover`** en `src/app/layout.tsx` (root layout) — verificar antes de tocar HU-MOBILE-NAV
2. **Anchor `#agents`** en `src/app/[locale]/page.tsx` — verificar que existe; si no, agregar
3. **Migration 017** — confirmar que no hay otra migration pendiente antes de crear `017_agent_examples.sql`
4. **Índice en `agent_calls(agent_id, created_at)`** — verificar que existe para que la query de reputación sea eficiente
5. **`PERCENTILE_CONT`** en Supabase — verificar en staging antes de implementar HU-4.4

---

---

## Cambios Post-Generación

### Revisión técnica por San (orquestradora) — 2026-02-27

Los S0 fueron revisados antes de presentarlos a Fer para HU_APPROVED. Resumen de cambios:

| HU | Observación integrada |
|----|----------------------|
| **HU-MOBILE-NAV** | `useIsCreator`/`useUserRole` no hace query a Supabase. Usa rol desde contexto de sesión existente. AC-15 agregado. Riesgo de query en cada render → marcado como mitigado. |
| **HU-4.4** | AC-12: verificar `PERCENTILE_CONT` en staging antes de implementar. DT-1: fallback completo con `AVG(latency_ms)` documentado. Riesgo de percentiles → marcado como mitigado. |
| **HU-4.3** | DT-1: sort_order usa `created_at ASC` para MVP. Sin drag & drop. AC-4 reemplazado. Endpoint `/reorder` eliminado del scope. Deuda técnica DT-EXAMPLES-01 documentada. |

---

*Generado por PM (John) — BMAD v6 — 2026-02-27*  
*Revisado y actualizado por San (orquestradora) — 2026-02-27*
