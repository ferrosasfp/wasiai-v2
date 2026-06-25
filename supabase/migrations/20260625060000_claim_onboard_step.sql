-- V9 (audit 2026-06-25): make onboarding terminal-step completion idempotent.
--
-- Problem: /api/v1/onboard/step, in the agent-key flow (step 7) and the email
-- flow (step 8), creates a key + agent (+ possibly a user) and only AFTER the
-- side-effects marks the session status='completed'. If the client retries the
-- SAME step on a network timeout BEFORE the 'completed' UPDATE lands, the
-- status==='completed' guard at the top of the handler still sees the old
-- status and re-executes everything → a second agent (random slug suffix) + a
-- second key (+ in step 8 a possible second createUser). Double registration.
--
-- Fix: a dedicated lock column (step_lock_at) under our control — we do NOT
-- depend on the unknown status enum / default of onboarding_sessions, which is
-- created outside the tracked migrations. claim_onboard_step takes a row lock
-- (SELECT ... FOR UPDATE) and, only if the session is not yet completed and not
-- already locked for this step, stamps step_lock_at = now() and returns true
-- (the winner). A concurrent retry blocks on the lock, then sees the stamp and
-- returns false (the loser) WITHOUT running any side-effect.
--
-- On success the route marks status='completed' as before (the lock just gates
-- entry). On failure the route calls release_onboard_step_claim to clear the
-- lock so the user can retry. Happy path (one request) is unchanged: the single
-- request wins the CAS and proceeds exactly as today.

ALTER TABLE onboarding_sessions
  ADD COLUMN IF NOT EXISTS step_lock_at TIMESTAMPTZ;

-- Claim the terminal step for exactly one concurrent request.
-- A lock is considered stale after 60s (covers a winner that crashed mid-flight)
-- so a legitimate retry is never permanently blocked.
-- M3 (fix-pack): SET search_path pinned (SECURITY DEFINER hardening).
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

  -- Already completed, or another request advanced past this step → loser.
  IF v_status = 'completed' OR v_step <> p_step THEN
    RETURN false;
  END IF;

  -- A fresh lock is held by a concurrent winner → loser. Stale (>60s) → reclaim.
  IF v_lock_at IS NOT NULL AND v_lock_at > now() - interval '60 seconds' THEN
    RETURN false;
  END IF;

  UPDATE onboarding_sessions
    SET step_lock_at = now()
    WHERE id = p_session_id;

  RETURN true;
END;
$$;

-- Release the lock so the user can retry when the winner's side-effects fail.
-- M3 (fix-pack): SET search_path pinned (SECURITY DEFINER hardening).
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
