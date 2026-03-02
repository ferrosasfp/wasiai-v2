# Story WAS-77: Capabilities estructuradas en agentes DeFi Risk

**Status:** ready-for-dev  
**Sprint:** 14 | **Épica:** Epic UX — Marketplace Quality  
**Prioridad:** P2 | **Estimación:** S (~1–2 horas)  
**Dependencias:** Ninguna

---

## Historia de usuario

Como usuario del marketplace, cuando visito la página de un agente DeFi de WasiAI, quiero ver la sección "Capabilities & Schema" con información estructurada de input/output y ejemplos reales, para entender exactamente cómo invocar el agente sin tener que adivinar.

---

## Contexto del problema

Los 5 agentes DeFi Risk fueron creados via `migration 024` con capabilities como simple array de tags:

```json
["chainlink", "on-chain", "price-feed"]
```

La UI de `/models/[slug]` espera capabilities en formato estructurado:

```json
[{
  "name": "string",
  "description": "string",
  "input_type": "text|json|...",
  "output_type": "text|json|...",
  "example_input": "string",
  "example_output": "string"
}]
```

Resultado actual: la sección "Capabilities & Schema" aparece vacía o con el fallback "No capabilities defined" en los 5 agentes DeFi.

---

## Acceptance Criteria

1. Los 5 agentes DeFi muestran la sección **Capabilities & Schema** completa en su página de detalle.
2. Cada capability tiene: nombre, descripción, input_type, output_type, ejemplo de input y ejemplo de output.
3. Los ejemplos son **reales y funcionales** — no placeholders.
4. La migration es **idempotente** (ON CONFLICT DO UPDATE safe to re-run).
5. Compatible con `CapabilitiesEditor` del publish form (mismo schema JSONB).

---

## Capabilities a definir por agente

### wasi-chainlink-price
```json
[{
  "name": "Read Chainlink Price Feed",
  "description": "Lee el precio actual y snapshot de 7 rondas históricas desde Chainlink AggregatorV3Interface en Avalanche.",
  "input_type": "json",
  "output_type": "json",
  "example_input": "{ \"feed_address\": \"0x86d67c3D38D2bCeE722E601025C25a575021c6EA\", \"token_symbol\": \"AVAX\" }",
  "example_output": "{ \"price\": 38.42, \"decimals\": 8, \"timestamp\": 1709123456, \"rounds\": [...] }"
}]
```

### wasi-onchain-analyzer
```json
[{
  "name": "Analyze ERC-20 Token On-Chain",
  "description": "Analiza holders, concentración top-10, age del contrato y flags de riesgo (mint activo, owner renounced, paused).",
  "input_type": "json",
  "output_type": "json",
  "example_input": "{ \"token_address\": \"0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E\" }",
  "example_output": "{ \"holders\": 12453, \"top10_concentration\": 0.34, \"mint_active\": false, \"owner_renounced\": true, \"risk_flags\": [] }"
}]
```

### wasi-contract-auditor
```json
[{
  "name": "Audit Smart Contract",
  "description": "Detecta patrones de rug pull, honeypot, permisos peligrosos y vulnerabilidades. Powered by Groq LLM llama-3.3-70b.",
  "input_type": "json",
  "output_type": "json",
  "example_input": "{ \"token_address\": \"0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E\" }",
  "example_output": "{ \"risk_score\": 15, \"findings\": [], \"verdict\": \"SAFE\", \"summary\": \"No critical issues found.\" }"
}]
```

### wasi-defi-sentiment
```json
[{
  "name": "DeFi Token Sentiment Analysis",
  "description": "Detecta red flags textuales en nombre, símbolo y descripción del token. Retorna score de sentimiento y señales de alerta.",
  "input_type": "json",
  "output_type": "json",
  "example_input": "{ \"token_name\": \"SafeMoon Inu\", \"token_symbol\": \"SAFEMOONI\", \"description\": \"100x guaranteed\" }",
  "example_output": "{ \"sentiment_score\": 22, \"red_flags\": [\"guaranteed returns\", \"meme combo\"], \"rating\": \"AVOID\" }"
}]
```

### wasi-risk-report
```json
[{
  "name": "DeFi Risk Report",
  "description": "Pipeline completo: agrega Chainlink price, on-chain metrics, auditoría de contrato y sentimiento en un reporte con score 0-100 y rating SAFE/CAUTION/AVOID.",
  "input_type": "json",
  "output_type": "json",
  "example_input": "{ \"token_address\": \"0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E\", \"feed_address\": \"0x86d67c3D38D2bCeE722E601025C25a575021c6EA\", \"token_name\": \"USD Coin\", \"token_symbol\": \"USDC\" }",
  "example_output": "{ \"score\": 85, \"rating\": \"SAFE\", \"price_usd\": 1.00, \"on_chain\": {...}, \"audit\": {...}, \"sentiment\": {...} }"
}]
```

---

## Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `supabase/migrations/025_defi_capabilities_structured.sql` | **NUEVO** — UPDATE capabilities con formato estructurado |

---

## Migration a crear

```sql
-- Migration 025: Structured capabilities for DeFi Risk agents
-- Replaces simple tag arrays with full capability objects
-- Idempotente: safe to re-run

UPDATE agents SET capabilities = '[{"name":"Read Chainlink Price Feed","description":"Lee precio actual y 7 rondas históricas desde Chainlink AggregatorV3Interface en Avalanche.","input_type":"json","output_type":"json","example_input":"{\"feed_address\":\"0x86d67c3D38D2bCeE722E601025C25a575021c6EA\",\"token_symbol\":\"AVAX\"}","example_output":"{\"price\":38.42,\"decimals\":8,\"timestamp\":1709123456}"}]'
WHERE slug = 'wasi-chainlink-price';

UPDATE agents SET capabilities = '[{"name":"Analyze ERC-20 Token On-Chain","description":"Analiza holders, concentración top-10, age del contrato y flags de riesgo.","input_type":"json","output_type":"json","example_input":"{\"token_address\":\"0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E\"}","example_output":"{\"holders\":12453,\"top10_concentration\":0.34,\"mint_active\":false,\"owner_renounced\":true}"}]'
WHERE slug = 'wasi-onchain-analyzer';

UPDATE agents SET capabilities = '[{"name":"Audit Smart Contract","description":"Detecta rug pull, honeypot, permisos peligrosos y vulnerabilidades via Groq LLM.","input_type":"json","output_type":"json","example_input":"{\"token_address\":\"0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E\"}","example_output":"{\"risk_score\":15,\"findings\":[],\"verdict\":\"SAFE\"}"}]'
WHERE slug = 'wasi-contract-auditor';

UPDATE agents SET capabilities = '[{"name":"DeFi Token Sentiment Analysis","description":"Detecta red flags textuales en nombre, símbolo y descripción del token.","input_type":"json","output_type":"json","example_input":"{\"token_name\":\"SafeMoon Inu\",\"token_symbol\":\"SAFEMOONI\"}","example_output":"{\"sentiment_score\":22,\"red_flags\":[\"guaranteed returns\"],\"rating\":\"AVOID\"}"}]'
WHERE slug = 'wasi-defi-sentiment';

UPDATE agents SET capabilities = '[{"name":"DeFi Risk Report","description":"Pipeline completo: Chainlink + on-chain + auditoría + sentimiento. Score 0-100 y rating SAFE/CAUTION/AVOID.","input_type":"json","output_type":"json","example_input":"{\"token_address\":\"0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E\",\"token_name\":\"USD Coin\",\"token_symbol\":\"USDC\"}","example_output":"{\"score\":85,\"rating\":\"SAFE\",\"price_usd\":1.00}"}]'
WHERE slug = 'wasi-risk-report';
```

---

## DoD — Definition of Done

- [ ] Los 5 agentes DeFi muestran "Capabilities & Schema" completo en `/models/[slug]` ✓
- [ ] Cada capability tiene nombre, descripción, input_type, output_type, ejemplo input/output ✓
- [ ] Migration 025 es idempotente ✓
- [ ] Verificado visualmente en local y en producción ✓
- [ ] `npm run build` sin errores ✓

---

## Dev Agent Record

### Agent Model Used
_(completar al implementar)_

### Completion Notes List
_(completar al implementar)_

### File List
- `supabase/migrations/025_defi_capabilities_structured.sql` — NUEVO
