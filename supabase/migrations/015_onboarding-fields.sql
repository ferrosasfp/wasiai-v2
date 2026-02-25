-- Migration 015: Onboarding fields for HU-1.1
-- Adds pending earnings accumulator and wizard progress tracking to creator_profiles

ALTER TABLE creator_profiles
  ADD COLUMN pending_earnings_usdc  numeric(20,6)  NOT NULL DEFAULT 0,
  ADD COLUMN onboarding_completed   boolean        NOT NULL DEFAULT false,
  ADD COLUMN onboarding_step        int            NOT NULL DEFAULT 1;

COMMENT ON COLUMN creator_profiles.pending_earnings_usdc IS
  'Display counter: suma de earnings no liquidados por falta de wallet.
   El USDC real está en escrow del contrato. Se liquida en próximo cron
   (o settlement inmediato) una vez wallet configurada.';

-- RPC: atomic increment of pending_earnings_usdc
-- Used by cron settle-key-batches when creator has no wallet_address
CREATE OR REPLACE FUNCTION increment_pending_earnings(
  p_user_id UUID,
  p_amount  NUMERIC
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE creator_profiles
  SET pending_earnings_usdc = pending_earnings_usdc + p_amount
  WHERE id = p_user_id;
END;
$$;
