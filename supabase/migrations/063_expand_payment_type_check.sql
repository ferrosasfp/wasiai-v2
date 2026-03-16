-- WAS-220: Expand payment_type CHECK constraint to include api_key, free_trial, unknown
-- Previous constraint only allowed ('x402', 'sandbox') — api_key and free_trial would fail

ALTER TABLE agent_calls DROP CONSTRAINT IF EXISTS agent_calls_payment_type_check;

ALTER TABLE agent_calls
  ADD CONSTRAINT agent_calls_payment_type_check
  CHECK (payment_type IN ('x402', 'sandbox', 'api_key', 'free_trial', 'unknown'));
