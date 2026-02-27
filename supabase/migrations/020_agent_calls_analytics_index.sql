-- Migration 020: Índice para analytics de llamadas por día
-- Historia: UX-06 — Gráfica de llamadas por día en dashboard creator
-- Impacto: Mejora performance de la query en GET /api/creator/analytics
--   Antes: Seq scan sobre agent_calls filtrando por agent_id y called_at
--   Después: Index scan con idx_agent_calls_agent_called_at

CREATE INDEX IF NOT EXISTS idx_agent_calls_agent_called_at
  ON agent_calls (agent_id, called_at DESC);

-- Notas:
-- 1. El índice cubre la query: WHERE agent_id = ANY($1) AND called_at >= $2
-- 2. DESC en called_at optimiza el ORDER BY más común (más reciente primero)
-- 3. El planner usará este índice con el filtro de rango de fecha en analytics
-- 4. No se usa índice parcial con fecha fija porque NOW() no es inmutable en Postgres
