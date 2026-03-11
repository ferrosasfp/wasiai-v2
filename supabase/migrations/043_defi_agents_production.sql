-- Migration 043: DeFi Risk Intelligence Agents for Production
-- Registra los 5 agentes oficiales de WasiAI en mainnet
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
  'Reads on-chain prices from Chainlink AggregatorV3Interface on Avalanche. Returns current price, timestamp, and 7-round historical snapshot. Input: { feed_address, token_symbol? }',
  'defi-risk',
  0.05,
  'USDC',
  'avalanche',
  'active',
  'https://wasiai-prod.vercel.app/api/v1/agents-internal/wasi-chainlink-price',
  '["chainlink","on-chain","price-feed"]',
  NOW()
),
(
  'wasi-onchain-analyzer',
  'On-Chain Token Analyzer',
  'Analyzes on-chain metrics of any ERC-20 token on Avalanche: holders, top-10 concentration, contract age, risk flags (active mint, owner renounced, paused). Input: { token_address }',
  'defi-risk',
  0.10,
  'USDC',
  'avalanche',
  'active',
  'https://wasiai-prod.vercel.app/api/v1/agents-internal/wasi-onchain-analyzer',
  '["on-chain","holders","contract-analysis"]',
  NOW()
),
(
  'wasi-contract-auditor',
  'Smart Contract Auditor',
  'Audits EVM contracts for rug pull patterns, honeypots, dangerous permissions and vulnerabilities. Powered by Groq LLM (llama-3.3-70b-versatile). Input: { token_address, contract_source? }',
  'defi-risk',
  0.20,
  'USDC',
  'avalanche',
  'active',
  'https://wasiai-prod.vercel.app/api/v1/agents-internal/wasi-contract-auditor',
  '["audit","security","llm"]',
  NOW()
),
(
  'wasi-defi-sentiment',
  'DeFi Sentiment Analyzer',
  'Analyzes token name, symbol, description and metadata to detect textual red flags and sentiment score. Input: { token_name, token_symbol, description? }',
  'defi-risk',
  0.05,
  'USDC',
  'avalanche',
  'active',
  'https://wasiai-prod.vercel.app/api/v1/agents-internal/wasi-defi-sentiment',
  '["sentiment","nlp","defi"]',
  NOW()
),
(
  'wasi-risk-report',
  'DeFi Risk Report Generator',
  'Complete DeFi risk analysis pipeline. Aggregates Chainlink price, on-chain metrics, contract audit and sentiment into a structured report with 0-100 score and SAFE/CAUTION/AVOID rating. Input: { token_address, feed_address?, token_name?, token_symbol?, description? }',
  'defi-risk',
  0.35,
  'USDC',
  'avalanche',
  'active',
  'https://wasiai-prod.vercel.app/api/v1/agents-internal/wasi-risk-report',
  '["risk","pipeline","chainlink","audit","sentiment"]',
  NOW()
)
ON CONFLICT (slug) DO UPDATE SET
  status         = EXCLUDED.status,
  endpoint_url   = EXCLUDED.endpoint_url,
  description    = EXCLUDED.description,
  price_per_call = EXCLUDED.price_per_call,
  chain          = EXCLUDED.chain;
