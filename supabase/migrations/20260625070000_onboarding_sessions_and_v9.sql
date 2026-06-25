-- ============================================================
-- Migration: 20260625070000_onboarding_sessions_and_v9
--
-- BUG DE CONFIG (auditoría 2026-06-25): la tabla `onboarding_sessions` existe en
-- la DB `caldz` (102 sesiones históricas) pero NO en `bdwv`, que es la DB que
-- wasiai-v2 usa en runtime (createServiceClient → NEXT_PUBLIC_SUPABASE_URL=bdwv).
-- Resultado: `POST /api/v1/onboard/start` daba 500 "Failed to create session" y
-- TODO el wizard de onboarding estaba roto en prod. Esta migración recrea la
-- tabla en bdwv con el schema EXACTO de caldz (tabla vacía; las sesiones viejas
-- eran históricas/expiradas y no se migran).
--
-- Además aplica V9 (idempotencia del onboarding): columna `step_lock_at` +
-- claim_onboard_step / release_onboard_step_claim (CAS con FOR UPDATE) para que
-- un retry del step terminal no dispare doble registro.
-- ============================================================

-- ── Tabla (schema idéntico a caldz) ──────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_sessions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ip           TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'active'
                 CHECK (status = ANY (ARRAY['active', 'completed', 'expired'])),
  current_step INTEGER     NOT NULL DEFAULT 1,
  data         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes')
);

-- WKH-SEC-02 (defensa en profundidad): RLS deny-by-default. El service client
-- (SUPABASE_SERVICE_ROLE_KEY) bypassea RLS; el onboarding nunca usa client anon.
ALTER TABLE public.onboarding_sessions ENABLE ROW LEVEL SECURITY;

-- ── V9: lock de step para idempotencia ───────────────────────
ALTER TABLE onboarding_sessions
  ADD COLUMN IF NOT EXISTS step_lock_at TIMESTAMPTZ;

-- Claim del step terminal para exactamente un request concurrente. Lock stale a
-- los 60s (cubre un winner que crashea mid-flight). SECURITY DEFINER + search_path.
CREATE OR REPLACE FUNCTION claim_onboard_step(
  p_session_id UUID,
  p_step       INT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status   TEXT;
  v_step     INT;
  v_lock_at  TIMESTAMPTZ;
BEGIN
  SELECT status, current_step, step_lock_at
    INTO v_status, v_step, v_lock_at
    FROM onboarding_sessions
    WHERE id = p_session_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_status = 'completed' OR v_step <> p_step THEN
    RETURN false;
  END IF;

  IF v_lock_at IS NOT NULL AND v_lock_at > now() - interval '60 seconds' THEN
    RETURN false;
  END IF;

  UPDATE onboarding_sessions
    SET step_lock_at = now()
    WHERE id = p_session_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION release_onboard_step_claim(
  p_session_id UUID
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE onboarding_sessions
    SET step_lock_at = NULL
    WHERE id = p_session_id
      AND status <> 'completed';
END;
$$;
