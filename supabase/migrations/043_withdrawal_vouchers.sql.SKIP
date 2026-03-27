-- 043_withdrawal_vouchers.sql
-- HU-078: NG-V01 (audit trail vouchers) + NG-V02 (idempotencia txHash)

-- ── creator_withdrawal_vouchers — audit trail de vouchers emitidos ─────────
CREATE TABLE creator_withdrawal_vouchers (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address    TEXT        NOT NULL,
  gross_amount_usdc NUMERIC(18,6) NOT NULL,
  nonce             TEXT        NOT NULL UNIQUE,
  deadline          BIGINT      NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'claimed', 'expired')),
  tx_hash           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at        TIMESTAMPTZ
);

ALTER TABLE creator_withdrawal_vouchers ENABLE ROW LEVEL SECURITY;

-- Creators can SELECT their own vouchers
CREATE POLICY "Creators see own vouchers"
  ON creator_withdrawal_vouchers FOR SELECT
  USING (creator_id = auth.uid());

-- Creators can INSERT their own vouchers (voucher/route.ts uses createClient())
CREATE POLICY "Creators insert own vouchers"
  ON creator_withdrawal_vouchers FOR INSERT
  WITH CHECK (creator_id = auth.uid());

-- Only service_role can UPDATE (withdraw/route.ts uses createServiceClient())
-- No UPDATE policy for authenticated users

CREATE INDEX idx_vouchers_creator_status
  ON creator_withdrawal_vouchers(creator_id, status);

CREATE INDEX idx_vouchers_nonce
  ON creator_withdrawal_vouchers(nonce);

-- ── creator_withdrawals — idempotencia de txHash ──────────────────────────
CREATE TABLE creator_withdrawals (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tx_hash     TEXT        NOT NULL UNIQUE,
  amount_usdc NUMERIC(18,6) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE creator_withdrawals ENABLE ROW LEVEL SECURITY;

-- Creators can SELECT their own withdrawals
CREATE POLICY "Creators see own withdrawals"
  ON creator_withdrawals FOR SELECT
  USING (creator_id = auth.uid());

-- Only service_role can INSERT (withdraw/route.ts uses createServiceClient())
-- No INSERT policy for authenticated users

CREATE INDEX idx_withdrawals_tx_hash
  ON creator_withdrawals(tx_hash);

CREATE INDEX idx_withdrawals_creator
  ON creator_withdrawals(creator_id, created_at DESC);
