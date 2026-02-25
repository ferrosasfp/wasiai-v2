-- ═══════════════════════════════════════════════════════════════════
-- WasiAI v2 — Demo Seed
-- ═══════════════════════════════════════════════════════════════════
-- Run in Supabase Dashboard → SQL Editor
-- IMPORTANT: Run AFTER migrations 001–006 have been applied
--
-- This seed inserts 5 demo agents published by the WasiAI system
-- account so the marketplace homepage looks populated from day 1.
-- creator_id is intentionally NULL for system-owned demo agents.
-- ═══════════════════════════════════════════════════════════════════

-- ── Optional: create a "WasiAI System" creator profile ───────────────────────
-- Only run this block if you want demo agents attributed to a named creator.
-- You must first create the user manually in Supabase Auth Dashboard
-- and replace the UUID below with the real user id.
--
-- INSERT INTO creator_profiles (id, username, display_name, bio, verified)
-- VALUES (
--   'aaaaaaaa-0000-0000-0000-000000000001',
--   'wasiai',
--   'WasiAI',
--   'Agentes IA oficiales de WasiAI — el marketplace de la economía agéntica latina.',
--   true
-- ) ON CONFLICT (username) DO NOTHING;

-- ── Demo Agents ───────────────────────────────────────────────────────────────

INSERT INTO agents (
  slug, name, description, category,
  price_per_call, currency, chain,
  endpoint_url,
  capabilities, metadata,
  agent_type, mcp_tool_name, mcp_description,
  status, is_featured,
  total_calls, total_revenue
)
VALUES

-- 1. Text Summarizer
(
  'text-summarizer',
  'Text Summarizer',
  'Resume textos largos en puntos clave. Ideal para artículos, documentos, emails y reportes. Soporta ES, EN y PT. Optimizado para contextos de negocios y tecnología.',
  'nlp',
  0.001, 'USDC', 'avalanche',
  'https://wasiai.vercel.app/api/v1/models/text-summarizer/invoke',
  '[
    {"name": "summarize", "description": "Resume un texto en bullets o párrafo corto", "input": {"text": "string", "style": "bullets|paragraph", "language": "es|en|pt"}},
    {"name": "extract_key_points", "description": "Extrae los 3-5 puntos más importantes"}
  ]'::jsonb,
  '{"author": "WasiAI", "version": "1.0.0", "model_backend": "groq/llama-3.1-8b-instant", "avg_latency_ms": 420, "max_input_tokens": 4096}'::jsonb,
  'agent', 'wasiai_summarize', 'Resume texto en bullets o párrafo corto',
  'active', true,
  0, 0
),

-- 2. Language Translator
(
  'language-translator',
  'Language Translator',
  'Traducción precisa entre español, inglés y portugués con contexto cultural latinoamericano. Detecta idioma automáticamente. Perfecto para comunicaciones regionales.',
  'nlp',
  0.001, 'USDC', 'avalanche',
  'https://wasiai.vercel.app/api/v1/models/language-translator/invoke',
  '[
    {"name": "translate", "description": "Traduce texto entre ES, EN y PT", "input": {"text": "string", "target_lang": "es|en|pt", "source_lang": "auto|es|en|pt"}},
    {"name": "detect_language", "description": "Detecta el idioma de un texto"}
  ]'::jsonb,
  '{"author": "WasiAI", "version": "1.0.0", "model_backend": "groq/llama-3.1-8b-instant", "avg_latency_ms": 380, "supported_pairs": ["es-en", "en-es", "es-pt", "pt-es", "en-pt", "pt-en"]}'::jsonb,
  'agent', 'wasiai_translate', 'Traduce texto entre ES, EN y PT con contexto latinoamericano',
  'active', true,
  0, 0
),

-- 3. Code Generator
(
  'code-generator',
  'Code Generator',
  'Genera código funcional en Python, TypeScript, Solidity y más. Incluye explicación línea a línea. Especializado en contratos inteligentes Avalanche y apps Web3.',
  'code',
  0.003, 'USDC', 'avalanche',
  'https://wasiai.vercel.app/api/v1/models/code-generator/invoke',
  '[
    {"name": "generate_code", "description": "Genera código a partir de una descripción", "input": {"prompt": "string", "language": "python|typescript|solidity|rust|go", "include_tests": "boolean"}},
    {"name": "explain_code", "description": "Explica un bloque de código paso a paso"},
    {"name": "refactor", "description": "Refactoriza código para mejor legibilidad y performance"}
  ]'::jsonb,
  '{"author": "WasiAI", "version": "1.0.0", "model_backend": "groq/llama-3.1-70b-versatile", "avg_latency_ms": 1100, "specialties": ["solidity", "avalanche", "web3", "typescript", "python"]}'::jsonb,
  'agent', 'wasiai_codegen', 'Genera código funcional con explicación, especializado en Web3/Avalanche',
  'active', true,
  0, 0
),

-- 4. Sentiment Analyzer
(
  'sentiment-analyzer',
  'Sentiment Analyzer',
  'Analiza el sentimiento de textos: positivo, negativo o neutro con score de confianza. Ideal para monitoreo de redes sociales, reviews y feedback de clientes en LATAM.',
  'nlp',
  0.0005, 'USDC', 'avalanche',
  'https://wasiai.vercel.app/api/v1/models/sentiment-analyzer/invoke',
  '[
    {"name": "analyze_sentiment", "description": "Devuelve sentimiento + score 0-1", "input": {"text": "string", "language": "auto|es|en|pt"}},
    {"name": "batch_analyze", "description": "Analiza múltiples textos en una sola llamada", "input": {"texts": "string[]"}}
  ]'::jsonb,
  '{"author": "WasiAI", "version": "1.0.0", "model_backend": "groq/llama-3.1-8b-instant", "avg_latency_ms": 290, "output_schema": {"sentiment": "positive|negative|neutral", "confidence": "number", "emotions": "string[]"}}'::jsonb,
  'agent', 'wasiai_sentiment', 'Analiza sentimiento de texto con score de confianza',
  'active', false,
  0, 0
),

-- 5. Data Extractor
(
  'data-extractor',
  'Data Extractor',
  'Extrae datos estructurados de texto no estructurado: fechas, nombres, montos, direcciones, entidades y más. Devuelve JSON limpio. Perfecto para automatizar flujos de datos.',
  'nlp',
  0.002, 'USDC', 'avalanche',
  'https://wasiai.vercel.app/api/v1/models/data-extractor/invoke',
  '[
    {"name": "extract", "description": "Extrae campos definidos de un texto", "input": {"text": "string", "fields": "string[]", "output_format": "json|csv"}},
    {"name": "extract_entities", "description": "Extrae entidades nombradas (personas, lugares, organizaciones, montos)"},
    {"name": "extract_dates", "description": "Extrae y normaliza todas las fechas mencionadas"}
  ]'::jsonb,
  '{"author": "WasiAI", "version": "1.0.0", "model_backend": "groq/llama-3.1-70b-versatile", "avg_latency_ms": 650, "output": "structured JSON"}'::jsonb,
  'agent', 'wasiai_extract', 'Extrae datos estructurados de texto no estructurado como JSON limpio',
  'active', false,
  0, 0
)

ON CONFLICT (slug) DO UPDATE SET
  name            = EXCLUDED.name,
  description     = EXCLUDED.description,
  price_per_call  = EXCLUDED.price_per_call,
  endpoint_url    = EXCLUDED.endpoint_url,
  capabilities    = EXCLUDED.capabilities,
  metadata        = EXCLUDED.metadata,
  mcp_tool_name   = EXCLUDED.mcp_tool_name,
  mcp_description = EXCLUDED.mcp_description,
  is_featured     = EXCLUDED.is_featured,
  status          = EXCLUDED.status;

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT slug, name, category, price_per_call, is_featured, agent_type
FROM agents
ORDER BY is_featured DESC, created_at ASC;
