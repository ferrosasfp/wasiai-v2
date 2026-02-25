-- ════════════════════════════════════════════════════════════════
-- WasiAI Demo Agents Seed
-- Run in Supabase Dashboard → SQL Editor AFTER migration 006
--
-- SEEDING METHOD:
--   • wasi-summarizer   → seeded directly (this script)
--   • wasi-extractor    → seeded directly (this script)
--   • wasi-translator   → publish via /publish form  (test golden path)
--   • wasi-coder        → publish via /publish form  (test golden path)
--   • wasi-sentiment    → register via POST /api/v1/agents/register (test self-registration)
-- ════════════════════════════════════════════════════════════════

-- Create WasiAI system creator profile (if not exists)
INSERT INTO creator_profiles (id, username, display_name, bio, verified)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'wasiai',
  'WasiAI',
  'Official WasiAI demo agents. Powered by Groq + Llama 3.1.',
  true
)
ON CONFLICT (id) DO NOTHING;

-- ── Agent 1: WasiSummarizer (direct seed) ──────────────────────────────────
-- HAL-005: renamed models → agents (migration 006)
INSERT INTO agents (
  id, creator_id, name, slug, description, category,
  price_per_call, currency, chain, endpoint_url,
  capabilities, status, is_featured, agent_type,
  mcp_tool_name, mcp_description,
  metadata
) VALUES (
  '11111111-1111-1111-1111-111111111111',
  '00000000-0000-0000-0000-000000000001',
  'WasiSummarizer',
  'wasi-summarizer',
  'Summarizes any text into a concise paragraph. Ideal for agents that need to compress large documents, news articles, or research papers.',
  'nlp',
  0.01, 'USDC', 'avalanche',
  'https://wasiai.io/api/demo/agents/wasi-summarizer',
  '[{"name":"summarize","description":"Summarize text","inputType":"text","outputType":"text","example":{"input":"Long article text...","output":"A concise summary in 2-4 sentences."}}]',
  'active', true, 'agent',
  'wasi_summarizer', 'Summarize any text into a concise paragraph',
  '{"powered_by":"groq","model":"llama-3.1-8b-instant","registered_via":"seed"}'
)
ON CONFLICT (slug) DO NOTHING;

-- ── Agent 2: WasiExtractor (direct seed) ───────────────────────────────────
-- HAL-005: renamed models → agents (migration 006)
INSERT INTO agents (
  id, creator_id, name, slug, description, category,
  price_per_call, currency, chain, endpoint_url,
  capabilities, status, is_featured, agent_type,
  mcp_tool_name, mcp_description,
  metadata
) VALUES (
  '22222222-2222-2222-2222-222222222222',
  '00000000-0000-0000-0000-000000000001',
  'WasiExtractor',
  'wasi-extractor',
  'Extracts structured JSON data from unstructured text. Parses emails, invoices, documents, and web pages. Ideal for agents building automated data pipelines.',
  'data',
  0.02, 'USDC', 'avalanche',
  'https://wasiai.io/api/demo/agents/wasi-extractor',
  '[{"name":"extract","description":"Extract structured data as JSON","inputType":"text","outputType":"json","example":{"input":"Invoice from Acme Corp, Jan 15 2025, $1,250.00","output":"{\"vendor\":\"Acme Corp\",\"date\":\"2025-01-15\",\"amount\":1250.00}"}}]',
  'active', true, 'agent',
  'wasi_extractor', 'Extract structured JSON data from any unstructured text',
  '{"powered_by":"groq","model":"llama-3.1-8b-instant","registered_via":"seed"}'
)
ON CONFLICT (slug) DO NOTHING;

-- ════════════════════════════════════════════════════════════════
-- After running this seed:
--
-- 1. wasi-summarizer + wasi-extractor → live in marketplace
--
-- 2. Publish via form (/publish):
--    - WasiTranslator  | nlp    | $0.01 | https://wasiai.io/api/demo/agents/wasi-translator
--    - WasiCoder       | code   | $0.02 | https://wasiai.io/api/demo/agents/wasi-coder
--
-- 3. Self-register via API:
--    POST /api/v1/agents/register
--    {
--      "name": "WasiSentiment",
--      "slug": "wasi-sentiment",
--      "category": "data",
--      "price_per_call": 0.01,
--      "endpoint_url": "https://wasiai.io/api/demo/agents/wasi-sentiment",
--      "description": "Analyzes sentiment and emotional tone...",
--      "agent_type": "agent",
--      "mcp_tool_name": "wasi_sentiment",
--      "framework": "wasiai-demo"
--    }
-- ════════════════════════════════════════════════════════════════
