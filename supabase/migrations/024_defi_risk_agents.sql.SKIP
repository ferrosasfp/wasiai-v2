-- Migration 024: DeFi Risk Intelligence Agents (HU-7.6)
-- Registra los 5 agentes oficiales de WasiAI en el marketplace
-- Idempotente: ON CONFLICT DO UPDATE — safe to re-run

INSERT INTO agents (
  slug,
  name,
  description,
  category,
  price_per_call,
  currency,
  chain,
  status,
  endpoint_url,
  capabilities,
  created_at
) VALUES
(
  'wasi-chainlink-price',
  'Chainlink Price Feed Reader',
  'Lee precios on-chain desde Chainlink AggregatorV3Interface en Avalanche. Retorna precio actual, timestamp, y snapshot histórico de 7 rondas. Input: { feed_address, token_symbol? }',
  'defi-risk',
  0.05,
  'USDC',
  'avalanche-fuji',
  'active',
  'https://wasiai-v2.vercel.app/api/v1/agents-internal/wasi-chainlink-price',
  '["chainlink","on-chain","price-feed"]',
  NOW()
),
(
  'wasi-onchain-analyzer',
  'On-Chain Token Analyzer',
  'Analiza métricas on-chain de cualquier token ERC-20 en Avalanche: holders, concentración top-10, age del contrato, flags de riesgo (mint activo, owner renounced, paused). Input: { token_address }',
  'defi-risk',
  0.10,
  'USDC',
  'avalanche-fuji',
  'active',
  'https://wasiai-v2.vercel.app/api/v1/agents-internal/wasi-onchain-analyzer',
  '["on-chain","holders","contract-analysis"]',
  NOW()
),
(
  'wasi-contract-auditor',
  'Smart Contract Auditor',
  'Audita contratos EVM buscando patrones de rug pull, honeypot, permisos peligrosos y vulnerabilidades. Powered by Groq LLM (llama-3.3-70b-versatile). Input: { token_address, contract_source? }',
  'defi-risk',
  0.20,
  'USDC',
  'avalanche-fuji',
  'active',
  'https://wasiai-v2.vercel.app/api/v1/agents-internal/wasi-contract-auditor',
  '["audit","security","llm"]',
  NOW()
),
(
  'wasi-defi-sentiment',
  'DeFi Sentiment Analyzer',
  'Analiza el nombre, símbolo, descripción y metadata del token para detectar red flags textuales y score de sentimiento. Input: { token_name, token_symbol, description? }',
  'defi-risk',
  0.05,
  'USDC',
  'avalanche-fuji',
  'active',
  'https://wasiai-v2.vercel.app/api/v1/agents-internal/wasi-defi-sentiment',
  '["sentiment","nlp","defi"]',
  NOW()
),
(
  'wasi-risk-report',
  'DeFi Risk Report Generator',
  'Pipeline completo de análisis de riesgo DeFi. Agrega Chainlink price, on-chain metrics, auditoría de contrato y sentimiento en un reporte estructurado con score 0-100 y rating SAFE/CAUTION/AVOID. Input: { token_address, feed_address?, token_name?, token_symbol?, description? }',
  'defi-risk',
  0.35,
  'USDC',
  'avalanche-fuji',
  'active',
  'https://wasiai-v2.vercel.app/api/v1/agents-internal/wasi-risk-report',
  '["risk","pipeline","chainlink","audit","sentiment"]',
  NOW()
)
ON CONFLICT (slug) DO UPDATE SET
  status         = EXCLUDED.status,
  endpoint_url   = EXCLUDED.endpoint_url,
  description    = EXCLUDED.description,
  price_per_call = EXCLUDED.price_per_call;
