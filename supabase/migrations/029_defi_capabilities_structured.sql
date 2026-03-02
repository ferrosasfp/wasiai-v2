-- Migration 029: Structured capabilities for DeFi Risk agents (WAS-116)
-- Replaces simple tag arrays with full capability objects (JSONB structured)
-- Idempotente: safe to re-run

UPDATE agents SET capabilities = '[
  {
    "name": "Read Chainlink Price Feed",
    "description": "Lee el precio actual y snapshot de 7 rondas históricas desde Chainlink AggregatorV3Interface en Avalanche.",
    "input_type": "json",
    "output_type": "json",
    "example_input": "{\"feed_address\":\"0x86d67c3D38D2bCeE722E601025C25a575021c6EA\",\"token_symbol\":\"AVAX\"}",
    "example_output": "{\"price\":38.42,\"decimals\":8,\"timestamp\":1709123456,\"rounds\":[{\"roundId\":1,\"price\":38.10},{\"roundId\":2,\"price\":38.25}]}"
  }
]'::jsonb
WHERE slug = 'wasi-chainlink-price';

UPDATE agents SET capabilities = '[
  {
    "name": "Analyze ERC-20 Token On-Chain",
    "description": "Analiza holders, concentración top-10, age del contrato y flags de riesgo (mint activo, owner renounced, paused).",
    "input_type": "json",
    "output_type": "json",
    "example_input": "{\"token_address\":\"0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E\"}",
    "example_output": "{\"holders\":12453,\"top10_concentration\":0.34,\"mint_active\":false,\"owner_renounced\":true,\"risk_flags\":[]}"
  }
]'::jsonb
WHERE slug = 'wasi-onchain-analyzer';

UPDATE agents SET capabilities = '[
  {
    "name": "Audit Smart Contract",
    "description": "Detecta patrones de rug pull, honeypot, permisos peligrosos y vulnerabilidades. Powered by Groq LLM llama-3.3-70b.",
    "input_type": "json",
    "output_type": "json",
    "example_input": "{\"token_address\":\"0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E\"}",
    "example_output": "{\"risk_score\":15,\"findings\":[],\"verdict\":\"SAFE\",\"summary\":\"No critical issues found.\"}"
  }
]'::jsonb
WHERE slug = 'wasi-contract-auditor';

UPDATE agents SET capabilities = '[
  {
    "name": "DeFi Token Sentiment Analysis",
    "description": "Detecta red flags textuales en nombre, símbolo y descripción del token. Retorna score de sentimiento y señales de alerta.",
    "input_type": "json",
    "output_type": "json",
    "example_input": "{\"token_name\":\"SafeMoon Inu\",\"token_symbol\":\"SAFEMOONI\",\"description\":\"100x guaranteed\"}",
    "example_output": "{\"sentiment_score\":22,\"red_flags\":[\"guaranteed returns\",\"meme combo\"],\"rating\":\"AVOID\"}"
  }
]'::jsonb
WHERE slug = 'wasi-defi-sentiment';

UPDATE agents SET capabilities = '[
  {
    "name": "DeFi Risk Report",
    "description": "Pipeline completo: agrega Chainlink price, on-chain metrics, auditoría de contrato y sentimiento en un reporte con score 0-100 y rating SAFE/CAUTION/AVOID.",
    "input_type": "json",
    "output_type": "json",
    "example_input": "{\"token_address\":\"0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E\",\"feed_address\":\"0x86d67c3D38D2bCeE722E601025C25a575021c6EA\",\"token_name\":\"USD Coin\",\"token_symbol\":\"USDC\"}",
    "example_output": "{\"score\":85,\"rating\":\"SAFE\",\"price_usd\":1.00,\"on_chain\":{\"holders\":12453,\"top10_concentration\":0.34},\"audit\":{\"verdict\":\"SAFE\"},\"sentiment\":{\"rating\":\"NEUTRAL\"}}"
  }
]'::jsonb
WHERE slug = 'wasi-risk-report';
