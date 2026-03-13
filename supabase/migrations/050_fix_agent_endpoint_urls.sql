-- Migration 050: Actualizar endpoint_url de los agentes demo
-- El endpoint_url apuntaba a wasiai-prod.vercel.app/api/v1/agents-internal/...
-- que no existe. El servicio real es wasiai-agents.vercel.app/agents/...

UPDATE agents SET endpoint_url = 'https://wasiai-agents.vercel.app/agents/wasi-chainlink-price'
WHERE slug = 'wasi-chainlink-price';

UPDATE agents SET endpoint_url = 'https://wasiai-agents.vercel.app/agents/wasi-onchain-analyzer'
WHERE slug = 'wasi-onchain-analyzer';

UPDATE agents SET endpoint_url = 'https://wasiai-agents.vercel.app/agents/wasi-contract-auditor'
WHERE slug = 'wasi-contract-auditor';

UPDATE agents SET endpoint_url = 'https://wasiai-agents.vercel.app/agents/wasi-defi-sentiment'
WHERE slug = 'wasi-defi-sentiment';

UPDATE agents SET endpoint_url = 'https://wasiai-agents.vercel.app/agents/wasi-risk-report'
WHERE slug = 'wasi-risk-report';
