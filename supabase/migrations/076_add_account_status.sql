-- WAS-282: account status + email_domain para detección de spam/multi-alias
CREATE TYPE account_status_enum AS ENUM ('active', 'pending_review', 'suspended');

ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS account_status account_status_enum NOT NULL DEFAULT 'active';

-- email_domain: necesario para el conteo de cuentas por dominio sin queries a auth.users
ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS email_domain TEXT;

-- Índices
CREATE INDEX IF NOT EXISTS creator_profiles_account_status_idx
  ON creator_profiles (account_status)
  WHERE account_status != 'active';

CREATE INDEX IF NOT EXISTS creator_profiles_email_domain_idx
  ON creator_profiles (email_domain);
