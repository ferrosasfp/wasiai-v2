-- Migración 060: añadir nonce para idempotency off-chain (WAS-132)
--
-- Contexto WAS-132:
--   Supabase es la fuente de verdad para accounting de pagos x402.
--   recordInvocationOnChain() fue desactivado intencionalmente:
--   el costo de gas (~$0.002–0.05/tx en L2) no justifica el valor
--   para el volumen actual de invocaciones.
--   Se reevaluará cuando: >500 invocaciones/día O cuando wasiai se
--   posicione como protocolo abierto que requiera verificabilidad on-chain.
--
--   El nonce EIP-3009 del X-PAYMENT header se guarda aquí para detectar
--   intentos de replay antes de que lleguen a usdcSettler.ts.
--   logCall() aún no pasa el nonce — eso es trabajo futuro (S6-02+).
--   La columna queda nullable para no romper inserts existentes.

ALTER TABLE agent_calls
  ADD COLUMN IF NOT EXISTS nonce TEXT;

-- Índice único parcial: solo cuando nonce es conocido (payment_type='x402')
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_calls_nonce_unique
  ON agent_calls (nonce)
  WHERE nonce IS NOT NULL;
