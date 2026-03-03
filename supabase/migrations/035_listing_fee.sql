-- Migration 035: listing_fee_usdc en system_config
-- WAS-131: fee = 0 al deploy — activable desde Supabase sin redeploy

INSERT INTO system_config (key, value)
VALUES ('listing_fee_usdc', '0')
ON CONFLICT (key) DO NOTHING;
