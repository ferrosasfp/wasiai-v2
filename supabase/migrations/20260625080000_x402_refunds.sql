-- 20260625080000_x402_refunds.sql
-- V6: Refund automático cuando el settlement x402 sale OK pero el upstream falla.
--
-- Caso "cobro sin servicio" (Route B / x402): el USDC del caller ya se transfirió
-- on-chain (settle OK), pero el agente upstream falló → el caller pagó y no recibió
-- nada. Esta tabla registra la obligación de devolverle el monto al caller. Un
-- procesador async (mirror de runSettlement) hace el transfer on-chain desde el
-- operator wallet hacia el payer_address y marca el refund 'done'.
--
-- INVARIANTE ANTI DOBLE-REFUND:
--   UNIQUE(settlement_tx_hash) → un settlement fallido genera A LO SUMO un refund.
--   El procesador hace un claim atómico (pending → processing vía UPDATE
--   condicional) antes del transfer; solo marca 'done' tras confirmación on-chain.

CREATE TABLE IF NOT EXISTS refunds (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Idempotency key: un settlement fallido = a lo sumo UN refund.
  settlement_tx_hash  TEXT NOT NULL UNIQUE,
  payer_address       TEXT NOT NULL,        -- authorization.from (a quién devolver)
  amount_usdc         NUMERIC(20,6) NOT NULL, -- monto que el caller PAGÓ (settled amount, total)
  agent_slug          TEXT,
  agent_call_id       UUID,
  -- pending → processing → done | failed
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  refund_tx_hash      TEXT,                 -- tx del transfer de devolución (set al marcar 'done')
  error_reason        TEXT,
  attempts            INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at        TIMESTAMPTZ
);

-- Índice para el procesador: barre los pendientes por antigüedad.
CREATE INDEX IF NOT EXISTS idx_refunds_pending
  ON refunds (created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_refunds_settlement_tx
  ON refunds (settlement_tx_hash);

-- RLS: tabla financiera — acceso solo vía service_role (backend).
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "refunds_service_only"
  ON refunds
  FOR ALL
  TO authenticated, anon
  USING (false);

-- Claim atómico de un refund pending → processing.
-- Devuelve la fila reclamada (0 filas si otro worker la tomó primero).
-- Garantiza que un refund se procese una sola vez incluso con workers concurrentes.
CREATE OR REPLACE FUNCTION claim_refund(p_id UUID)
RETURNS SETOF refunds
LANGUAGE sql
AS $$
  UPDATE refunds
  SET status = 'processing',
      attempts = attempts + 1
  WHERE id = p_id
    AND status = 'pending'
  RETURNING *;
$$;

REVOKE EXECUTE ON FUNCTION claim_refund(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_refund(UUID) TO service_role;
