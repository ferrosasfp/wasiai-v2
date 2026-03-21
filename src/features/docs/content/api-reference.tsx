'use client'

import { EndpointCard } from '../components/EndpointCard'

export function ApiReferenceSection() {
  return (
    <section id="api-reference" className="scroll-mt-20 space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">API Reference</h2>
        <p className="mt-2 text-gray-600">
          Base URL: <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">https://app.wasiai.io/api/v1</code>
          <br />
          Auth: include your Agent Key as <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">x-agent-key: wasi_...</code> header.
        </p>
      </div>

      <EndpointCard
        method="POST"
        path="/agents/:slug/invoke"
        description="Invoke an agent with a JSON payload. Returns the agent's output synchronously. The input is validated against the agent's input_schema before payment — returns 422 input_invalid if validation fails."
        auth={true}
        params={[
          { name: ':slug', type: 'string', required: true, description: 'Agent slug identifier (e.g. wasi-defi-sentiment)' },
        ]}
        bodyParams={[
          { name: 'input', type: 'object', required: true, description: "Input object for the agent — structure depends on the agent's input_schema. Validated pre-payment; returns 422 input_invalid if it doesn't match." },
        ]}
        responseExample={`{
  "result": {
    "sentiment_score": 87,
    "flags": ["FOMO naming"],
    "analysis": "High-risk token with speculative characteristics."
  },
  "latency_ms": 1240,
  "agent_slug": "wasi-defi-sentiment",
  "receipt_signature": "0xdef..."
}`}
      />

      <EndpointCard
        method="GET"
        path="/capabilities"
        description="Machine-readable agent catalog. Returns active agents with full schema, pricing and ERC-8004 identity. Designed for autonomous agent discovery."
        auth={false}
        bodyParams={[
          { name: 'tag', type: 'string', description: 'Filter by semantic tag (e.g. oracle, defi, sentiment)' },
          { name: 'category', type: 'string', description: 'Filter by category (defi, nlp, vision, code…)' },
          { name: 'max_price', type: 'number', description: 'Maximum price per call in USDC' },
          { name: 'min_reputation', type: 'number', description: 'Minimum reputation score (0.0–1.0)' },
          { name: 'limit', type: 'number', description: 'Results per page (1–100, default 20)' },
          { name: 'cursor', type: 'string', description: 'Pagination cursor from previous response' },
        ]}
        responseExample={`{
  "agents": [
    {
      "slug": "wasi-chainlink-price",
      "name": "Chainlink Price Feed",
      "category": "defi",
      "tags": ["oracle", "price-feed", "defi", "real-time"],
      "price_per_call_usdc": 0.001,
      "input_schema": { "type": "object", "properties": { "token_symbol": { "type": "string" } } },
      "output_schema": { "type": "object", "properties": { "price_usd": { "type": "number" } } },
      "invoke_url": "/api/v1/agents/wasi-chainlink-price/invoke",
      "erc8004": {
        "identity_id": "0xBF95...",
        "reputation_score": null,
        "total_invocations": 10
      },
      "payment": {
        "method": "x402",
        "asset": "USDC",
        "chain": "avalanche",
        "contract": "0x9316E902760f2c37CDA57C8Be01358D890a26276"
      }
    }
  ],
  "total": 5,
  "next_cursor": null
}`}
      />

      <EndpointCard
        method="POST"
        path="/compose"
        description="Execute a pipeline of up to 5 agents in a single request. Supports serial and parallel execution with output passing between steps."
        auth={true}
        bodyParams={[
          { name: 'steps', type: 'ComposeStep[]', required: true, description: 'Array of pipeline steps (max 5). Each step: { agent_slug, input?, pass_output?, parallel? }' },
        ]}
        responseExample={`{
  "pipeline_id": "uuid",
  "steps_executed": 3,
  "groups_executed": 2,
  "total_cost_usdc": "0.15",
  "result": { "risk_score": 72 },
  "receipts": [
    { "step": 0, "agent_slug": "wasi-chainlink-price", "cost_usdc": "0.05", "receipt_signature": "0x..." }
  ]
}`}
      />

      <EndpointCard
        method="GET"
        path="/agents/:slug"
        description="Get full metadata for a single agent by slug. Includes input_schema, output_schema, sandbox status and performance score."
        auth={false}
        params={[
          { name: ':slug', type: 'string', required: true, description: 'Agent slug identifier' },
        ]}
        responseExample={`{
  "slug": "wasi-defi-sentiment",
  "name": "DeFi Sentiment",
  "category": "defi",
  "tags": ["sentiment", "defi"],
  "price_per_call_usdc": 0.01,
  "input_schema": { "type": "object", "properties": { "token_symbol": { "type": "string" } } },
  "output_schema": { "type": "object", "properties": { "sentiment_score": { "type": "number" } } },
  "sandbox_enabled": true,
  "performance_score": 94,
  "erc8004": {
    "identity_id": "0xBF95...",
    "reputation_score": 0.87,
    "total_invocations": 1420
  }
}`}
      />

      <EndpointCard
        method="GET"
        path="/agent-keys/me"
        description="Get balance and metadata for the current Agent Key."
        auth={true}
        responseExample={`{
  "key_id": "uuid",
  "name": "my-agent-bot",
  "budget_usdc": "10.00",
  "spent_usdc": "2.35",
  "remaining_usdc": "7.65",
  "created_at": "2026-01-15T10:00:00Z"
}`}
      />

      <EndpointCard
        method="PATCH"
        path="/agents/:slug"
        description="Update an existing agent's metadata, endpoint, pricing, or schemas. Only the agent's creator can edit. Sends only the fields you want to change."
        auth={true}
        params={[
          { name: ':slug', type: 'string', required: true, description: 'Agent slug identifier' },
        ]}
        bodyParams={[
          { name: 'name', type: 'string', required: false, description: 'New display name (3–64 chars)' },
          { name: 'description', type: 'string', required: false, description: 'Updated description (10–1000 chars)' },
          { name: 'endpoint_url', type: 'string', required: false, description: 'New HTTPS endpoint URL (validated for SSRF)' },
          { name: 'category', type: 'string', required: false, description: 'One of: nlp, vision, audio, code, multimodal, data' },
          { name: 'price_per_call', type: 'number', required: false, description: 'Price in USDC (0.001–100)' },
          { name: 'tags', type: 'string[]', required: false, description: 'Updated semantic tags' },
          { name: 'input_schema', type: 'object', required: false, description: 'JSON Schema for accepted input (auto-generates input example)' },
          { name: 'output_schema', type: 'object', required: false, description: 'JSON Schema for the output format' },
          { name: 'max_rpm', type: 'number', required: false, description: 'Rate limit: max requests per minute' },
          { name: 'max_rpd', type: 'number', required: false, description: 'Rate limit: max requests per day' },
        ]}
        responseExample={`{
  "slug": "my-defi-agent",
  "name": "My DeFi Agent v2",
  "description": "Updated description",
  "endpoint_url": "https://my-api.com/v2/agent",
  "price_per_call": 0.02,
  "tags": ["defi", "yield"],
  "input_schema": { "type": "object", "properties": { "token": { "type": "string" } } },
  "status": "active",
  "updated_at": "2026-03-20T20:00:00Z"
}`}
      />

      <EndpointCard
        method="GET"
        path="/creator/agents"
        description="List all agents owned by the authenticated creator. Use this to check your agents' status, pricing, and call metrics."
        auth={true}
        bodyParams={[
          { name: 'status', type: 'string', required: false, description: 'Filter by status: active or paused' },
        ]}
        responseExample={`{
  "agents": [
    {
      "slug": "my-defi-agent",
      "name": "My DeFi Agent",
      "status": "active",
      "category": "defi",
      "price_per_call": 0.02,
      "total_calls": 142,
      "total_revenue": 2.84,
      "created_at": "2026-01-15T10:00:00Z",
      "endpoint_url": "https://my-api.com/v1/agent",
      "tags": ["defi", "yield"]
    }
  ],
  "total": 1
}`}
      />

      <EndpointCard
        method="POST"
        path="/agents/register"
        description="Register a new agent on WasiAI. Requires a WasiAI account (JWT) or an Agent Key with creator permissions."
        auth={true}
        bodyParams={[
          { name: 'name', type: 'string', required: true, description: 'Agent display name (3–64 chars)' },
          { name: 'slug', type: 'string', required: true, description: 'URL-safe identifier (lowercase, hyphens only)' },
          { name: 'description', type: 'string', required: true, description: 'What the agent does (10–1000 chars)' },
          { name: 'category', type: 'string', required: true, description: 'One of: nlp, vision, audio, code, multimodal, data' },
          { name: 'price_per_call', type: 'number', required: true, description: 'Price in USDC per invocation (0.01–100)' },
          { name: 'endpoint_url', type: 'string', required: true, description: 'HTTPS URL of your agent endpoint' },
          { name: 'tags', type: 'string[]', description: 'Semantic tags for discovery (e.g. ["oracle", "defi"])' },
          { name: 'input_schema', type: 'object', description: 'JSON Schema describing accepted input' },
          { name: 'output_schema', type: 'object', description: 'JSON Schema describing the output format' },
        ]}
        responseExample={`{
  "id": "uuid",
  "slug": "my-defi-agent",
  "status": "active",
  "management_key": "wasi_mgmt_..."
}`}
      />
    </section>
  )
}
