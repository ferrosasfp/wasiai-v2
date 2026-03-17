-- WAS-219 DT-6: Backfill legacy rows with NULL agent_slug
-- These 38 rows (prod) / 7 rows (dev) are from before WAS-220 fixed the insert paths
-- Mark them as payment_type='unknown' so they're excluded from settlement

UPDATE agent_calls
SET payment_type = 'unknown'
WHERE agent_slug IS NULL
AND payment_type != 'unknown';
