-- 032_sandbox_credits.sql

-- Tabla de créditos sandbox por usuario
CREATE TABLE IF NOT EXISTS sandbox_credits (
  user_id       UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  balance_usdc  NUMERIC(18,6) NOT NULL DEFAULT 0.5,
  total_granted NUMERIC(18,6) NOT NULL DEFAULT 0.5,
  total_used    NUMERIC(18,6) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: solo el owner puede leer su propio balance
ALTER TABLE sandbox_credits ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "users_own_sandbox_credits" ON sandbox_credits
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Columna payment_type en agent_calls (sin romper registros existentes)
ALTER TABLE agent_calls
  ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'x402'
  CHECK (payment_type IN ('x402', 'sandbox'));

-- Función atómica para deducir balance (evita race condition)
CREATE OR REPLACE FUNCTION deduct_sandbox_balance(
  p_user_id UUID,
  p_amount  NUMERIC
) RETURNS BOOLEAN AS $$
DECLARE
  v_balance NUMERIC;
BEGIN
  SELECT balance_usdc INTO v_balance
  FROM sandbox_credits
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_balance < p_amount THEN
    RETURN FALSE;
  END IF;

  UPDATE sandbox_credits
  SET balance_usdc = balance_usdc - p_amount,
      total_used   = total_used + p_amount,
      updated_at   = now()
  WHERE user_id = p_user_id;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función atómica para reembolsar balance (INCREMENT, evita race condition)
CREATE OR REPLACE FUNCTION refund_sandbox_balance(
  p_user_id UUID,
  p_amount  NUMERIC
) RETURNS VOID AS $$
BEGIN
  UPDATE sandbox_credits
  SET balance_usdc = balance_usdc + p_amount,
      updated_at   = now()
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
