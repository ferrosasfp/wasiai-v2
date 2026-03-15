# SDD #073: WAS-182 — Agentes DeFi Oficiales: precios y badge oficial

> SPEC_APPROVED: no
> Fecha: 2026-03-15
> Tipo: improvement
> SDD_MODE: mini
> Clasificación: FAST-FIX

---

## 1. Resumen

Los 5 agentes DeFi oficiales de WasiAI (`wasi-chainlink-price`, `wasi-defi-sentiment`, `wasi-onchain-analyzer`, `wasi-contract-auditor`, `wasi-risk-report`) tienen precios de demo en DB ($0.001–$0.010). Se actualizan a los precios definidos en la especificación original. Además se marca `is_featured = true` para darles visibilidad en el marketplace como agentes oficiales.

No se crea columna nueva — `is_featured` ya existe en la tabla `agents`.

---

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | 073 / WAS-182 |
| **Tipo** | improvement |
| **Objetivo** | Actualizar precios de agentes DeFi oficiales + marcarlos como featured |
| **Scope IN** | Migration SQL UPDATE + badge "Official" en card de agente |
| **Scope OUT** | No crear columna nueva, no cambiar endpoints, no tocar creator_id |

---

## 3. Context Map

### Archivos leídos
| Archivo | Por qué | Hallazgo |
|---------|---------|----------|
| `supabase/migrations/043_defi_agents_production.sql` | Origen de los agentes | Precios originales: $0.05/$0.10/$0.20/$0.05/$0.35 |
| `src/app/[locale]/models/[slug]/page.tsx` | Badge visual existente | `is_featured` no se renderiza como badge aún |
| DB `agents` table | Estado actual | `is_featured` existe (boolean); precios actuales $0.001–$0.010 |

### Exemplar
| Para modificar | Seguir patrón de |
|---------------|------------------|
| Nueva migration SQL | `supabase/migrations/043_defi_agents_production.sql` |

---

## 4. Archivos afectados

| Archivo | Acción | Qué cambia | Exemplar |
|---------|--------|-----------|----------|
| `supabase/migrations/061_defi_agents_prices.sql` | Crear | UPDATE precios + is_featured=true para 5 slugs | `043_defi_agents_production.sql` |
| `src/app/[locale]/models/[slug]/page.tsx` | Modificar | Renderizar badge "WasiAI Official" si `is_featured=true` | badge `creator.verified` en línea 105 |
| `src/app/[locale]/models/page.tsx` (marketplace listing) | Verificar | Que `is_featured` llegue en la query SELECT | — |

---

## 5. Precios nuevos

| Slug | Precio actual | Precio nuevo |
|------|--------------|--------------|
| `wasi-chainlink-price` | $0.001 | $0.010 |
| `wasi-defi-sentiment` | $0.002 | $0.020 |
| `wasi-onchain-analyzer` | $0.002 | $0.050 |
| `wasi-contract-auditor` | $0.005 | $0.100 |
| `wasi-risk-report` | $0.010 | $0.200 |

> Nota: Los precios de la migración 043 ($0.05/$0.10/$0.20/$0.05/$0.35) eran los "target". Se toma el 50% de esos como precio de lanzamiento para ser competitivos.

---

## 6. Acceptance Criteria (EARS)

1. WHEN se aplica la migración, THE DB SHALL tener los 5 agentes con los precios nuevos y `is_featured = true`.
2. WHEN un usuario visita `/models/wasi-chainlink-price`, THE página SHALL mostrar un badge "WasiAI Official".
3. WHEN se aplica la migración sin los slugs en DB, THE SQL SHALL completar sin error (UPSERT safe).

---

## 7. Constraint Directives

### PROHIBIDO
- NO crear columna nueva en `agents`
- NO tocar `creator_id`, `endpoint_url`, ni `status`
- NO modificar lógica de facturación
- NO cambiar precios de otros agentes que no sean los 5 slugs listados

---

## 8. Waves de Implementación

### Wave 0 — Pre-flight
- [ ] W0.1: Verificar que los 5 slugs existen en DB prod: `SELECT slug FROM agents WHERE slug LIKE 'wasi-%'`
- [ ] W0.2: `npx tsc --noEmit` pasa

### Wave 1 — Migration SQL
- [ ] W1.1: Crear `061_defi_agents_prices.sql` con UPDATE precios + is_featured

### Wave 2 — UI Badge
- [ ] W2.1: Renderizar badge en `models/[slug]/page.tsx` si `is_featured=true`

### Wave 3 — Verificación
- [ ] W3.1: `npx tsc --noEmit` limpio
- [ ] W3.2: Test local: `SELECT slug, price_per_call, is_featured FROM agents WHERE slug LIKE 'wasi-%'`
