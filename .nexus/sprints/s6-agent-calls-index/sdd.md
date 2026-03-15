# SDD #S6-A1: Índice agent_calls(agent_id, created_at)

> SPEC_APPROVED: no
> Fecha: 2026-03-15
> Tipo: tech-task
> SDD_MODE: mini
> Branch: feat/s6-a1-agent-calls-index

---

## 1. Resumen

`calcTrend()` en `/reputation/route.ts` escanea 14 días de `agent_calls` sin índice compuesto. Con volumen real esto se vuelve un full scan por agente. Deuda de Sprint 5 Retro (acción A1).

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | S6-A1 |
| **Tipo** | tech-task |
| **Objetivo** | Añadir índice compuesto `(agent_id, called_at)` a `agent_calls` |
| **Scope IN** | Una migración SQL, un índice |
| **Scope OUT** | Todo lo demás |

## 3. Context Map

### Exemplars

| Para modificar | Seguir patrón de |
|---------------|------------------|
| Migración nueva | `058_performance_score.sql` |

## 4. Archivos afectados

| Archivo | Acción | Qué cambia | Exemplar |
|---------|--------|-----------|----------|
| `supabase/migrations/061_agent_calls_agent_id_idx.sql` | Crear | `CREATE INDEX CONCURRENTLY IF NOT EXISTS` | `058_performance_score.sql` |

## 5. SQL

```sql
-- Migración 061: índice compuesto para calcTrend() en /reputation
-- Optimiza queries WHERE agent_id = X AND called_at > Y (14d window)

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_calls_agent_created_at
  ON agent_calls (agent_id, called_at DESC);
```

**Nota:** `CONCURRENTLY` para no bloquear tabla en prod durante creación.

## 6. Acceptance Criteria (EARS)

1. WHEN migration 061 is applied, THE index `idx_agent_calls_agent_created_at` SHALL exist on `agent_calls`.
2. WHEN `EXPLAIN ANALYZE` runs on `SELECT * FROM agent_calls WHERE agent_id = X AND called_at > NOW() - INTERVAL '14 days'`, THE plan SHALL use the new index (Index Scan, not Seq Scan).

## 7. Constraint Directives

### PROHIBIDO
- NO modificar código de la aplicación
- NO eliminar índices existentes

---

*SDD generado por NexusAgil — MINI | Sprint 6*
