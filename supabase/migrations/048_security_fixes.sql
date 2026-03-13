-- Migration 048: Security fixes post Sprint 1 review
-- A6: refund_key_balance — add ownership validation
-- A7: get_agent_percentile_metrics — remove GRANT to anon (public data via /reputation endpoint only)

-- ─── A6: refund_key_balance con validación de ownership ───────────────────────
-- Reemplaza la versión de migration 045 que no validaba ownership
-- Agrega p_expected_user_id para prevenir que un key_id ajeno sea reembolsado

CREATE OR REPLACE FUNCTION refund_key_balance(
  p_key_id          UUID,
  p_amount          NUMERIC,
  p_expected_user_id UUID DEFAULT NULL  -- si se pasa, valida que la key pertenezca a ese user
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rows_updated INT;
BEGIN
  UPDATE agent_keys
    SET spent_usdc = GREATEST(0, spent_usdc - p_amount)
  WHERE id = p_key_id
    AND is_active = true
    AND (p_expected_user_id IS NULL OR user_id = p_expected_user_id);

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  RETURN v_rows_updated > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION refund_key_balance(UUID, NUMERIC, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refund_key_balance(UUID, NUMERIC, UUID) TO service_role;

-- Revocar la versión anterior sin el tercer parámetro (migration 045) si existe
DROP FUNCTION IF EXISTS refund_key_balance(UUID, NUMERIC);


-- ─── A7: get_agent_percentile_metrics — revocar GRANT a anon ─────────────────
-- Los datos de métricas ya son públicos via /reputation endpoint (cacheado 60s)
-- No es necesario exponer el RPC directamente a anon/authenticated desde el cliente
-- El endpoint /reputation llama con service_role vía server-side

REVOKE EXECUTE ON FUNCTION get_agent_percentile_metrics(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION get_agent_percentile_metrics(UUID) TO service_role;
