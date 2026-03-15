# SDD #213: performance_score — reputación basada en invocaciones

> SPEC_APPROVED: yes — 2026-03-14
> Fecha: 2026-03-14 | Clasificación: QUALITY

## 1. Resumen

`reputation_score` (votos UP/DOWN via `trg_update_agent_reputation`) se mantiene intacto.
Se añade un campo separado `performance_score NUMERIC(5,2)` calculado desde `agent_calls`
usando la función existente `get_agent_percentile_metrics()`.
Fórmula: `ROUND((1 - error_rate_7d) * 100, 1)` — NULL si <5 calls en 7 días.

## 2. Acceptance Criteria

- **AC1:** WHEN migración 058 aplicada, `agents` SHALL tener `performance_score NUMERIC(5,2) DEFAULT NULL`.
- **AC2:** WHEN una invocación completa (status IN ('success','error')) y el agente tiene ≥5 calls en 7d, THE DB trigger SHALL recalcular `performance_score = ROUND((1 - error_rate_7d) * 100, 1)` usando `get_agent_percentile_metrics(agent_id)`.
- **AC3:** WHEN el agente tiene <5 calls en 7d, `performance_score` SHALL permanecer NULL (no 0).
- **AC4:** WHEN dos invocaciones completan simultáneamente, THE trigger SHALL ejecutarse de forma atómica (trigger de fila — no hay RMW explícito).
- **AC5:** WHEN `GET /api/v1/agents?min_reputation=X`, THE endpoint SHALL filtrar por `performance_score >= X` (escala 0–100).
- **AC6:** WHEN `GET /api/v1/agents/:slug`, THE response SHALL incluir `performance_score` junto al `reputation` existente.
- **AC7:** WHEN `get_agent_percentile_metrics` falla (error DB), THE trigger SHALL hacer `RAISE WARNING` y NO abortar la invocación principal.
- **AC8:** WHEN seed script ejecutado en entorno con agentes demo, THE query `SELECT COUNT(*) FROM agents WHERE performance_score IS NOT NULL` SHALL retornar ≥5.

## 3. Context Map

| Archivo | Rol |
|---------|-----|
| `supabase/migrations/046_percentile_metrics.sql` | `get_agent_percentile_metrics()` — fuente de datos |
| `supabase/migrations/0011_agent_ratings.sql` | `trg_update_agent_reputation` — NO tocar |
| `src/app/api/v1/agents/route.ts` | `?min_reputation` filter — modificar |
| `src/app/api/v1/agents/[slug]/route.ts` | Response del agente — añadir campo |

## 4. Diseño Técnico

### 4.1 Migración 058

```sql
-- 058_performance_score.sql
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS performance_score NUMERIC(5,2) DEFAULT NULL;

COMMENT ON COLUMN agents.performance_score IS
  'Performance score 0–100 basado en error_rate_7d de agent_calls. NULL = <5 calls. NO confundir con reputation_score (votos).';

CREATE INDEX IF NOT EXISTS idx_agents_performance_score
  ON agents(performance_score)
  WHERE performance_score IS NOT NULL;

-- Trigger function
CREATE OR REPLACE FUNCTION update_agent_performance_score()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_score NUMERIC(5,2);
  v_metrics RECORD;
BEGIN
  -- Solo calcular si el status es terminal
  IF NEW.status NOT IN ('success', 'error') THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT * INTO v_metrics
    FROM get_agent_percentile_metrics(NEW.agent_id);

    IF v_metrics.error_rate_7d IS NOT NULL THEN
      v_score := ROUND((1.0 - v_metrics.error_rate_7d) * 100.0, 1);
      v_score := GREATEST(0, LEAST(100, v_score)); -- clamp 0-100

      UPDATE agents
        SET performance_score = v_score
        WHERE id = NEW.agent_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'update_agent_performance_score failed for agent %: %', NEW.agent_id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_agent_performance_score
  AFTER INSERT OR UPDATE OF status ON agent_calls
  FOR EACH ROW
  EXECUTE FUNCTION update_agent_performance_score();
```

### 4.2 GET /api/v1/agents — ?min_reputation filter

En `src/app/api/v1/agents/route.ts`, el param `?min_reputation` actualmente no está implementado en route.ts (solo en agent-discovery.ts). Añadir:

```typescript
const minReputation = searchParams.get('min_reputation')
if (minReputation) {
  const val = parseFloat(minReputation)
  if (!isNaN(val)) {
    query = query.gte('performance_score', val)
  }
}
```

### 4.3 GET /api/v1/agents/:slug — añadir performance_score

En `src/app/api/v1/agents/[slug]/route.ts`, añadir `performance_score` al SELECT y al objeto de respuesta:

```typescript
// En el SELECT:
'..., reputation_score, reputation_count, performance_score'

// En el response object:
performance_score: agent.performance_score ?? null,
```

### 4.4 Seed script

Archivo: `scripts/seed-performance-scores.ts`
- Para cada agente demo: UPDATE agents SET performance_score = random entre 75–99 WHERE slug IN (lista de agentes demo)

## 5. Wave Plan

**Wave 1** — Migración 058 (`058_performance_score.sql`) → `npx tsc --noEmit`
**Wave 2** — Filter `?min_reputation` en `route.ts` → `npx tsc --noEmit`
**Wave 3** — Campo `performance_score` en GET `:slug` → `npx tsc --noEmit`
**Wave 4** — Seed script `scripts/seed-performance-scores.ts` → `npx tsc --noEmit`
**Wave 5** — Commit: `feat(WAS-213): performance_score basado en error_rate_7d + filter min_reputation`

## 6. Rollback

```sql
DROP TRIGGER IF EXISTS trg_update_agent_performance_score ON agent_calls;
DROP FUNCTION IF EXISTS update_agent_performance_score();
ALTER TABLE agents DROP COLUMN IF EXISTS performance_score;
```

## 7. Critical Constraints

- **OBLIGATORIO:** No tocar `reputation_score` ni `trg_update_agent_reputation`
- **OBLIGATORIO:** Trigger con EXCEPTION WHEN OTHERS para no abortar invocaciones
- **OBLIGATORIO:** Clamp de score entre 0 y 100
- **PROHIBIDO:** Escribir a `reputation_score` desde el nuevo trigger
- **PROHIBIDO:** Eliminar o modificar `get_agent_percentile_metrics()`
