import { EndpointCard } from '../components/EndpointCard'
import { TryIt } from '../components/TryIt'

export function ApiReferenceSection() {
  return (
    <section id="api-reference" className="scroll-mt-20 space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">API Reference</h2>
        <p className="mt-2 text-gray-600">
          Base URL: <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">https://wasiai-v2.vercel.app/api/v1</code>
          <br />
          Auth: send your API key as <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">X-API-Key: wai_...</code> header.
        </p>
      </div>

      <EndpointCard
        method="POST"
        path="/models/:slug/invoke"
        description="Invoke an agent with a JSON payload. Returns the agent's output synchronously."
        auth={true}
        params={[
          { name: ':slug', type: 'string', required: true, description: 'Agent slug identifier (e.g. wasi-defi-sentiment)' },
        ]}
        bodyParams={[
          { name: 'input', type: 'string', required: true, description: 'JSON-serialized input string for the agent' },
        ]}
        responseExample={`{
  "output": {
    "sentiment_score": 87,
    "flags": ["FOMO naming"],
    "analysis": "High-risk token with speculative characteristics."
  },
  "latency_ms": 1240,
  "agent_slug": "wasi-defi-sentiment",
  "tx_hash": "0xabc...",
  "receipt_signature": "0xdef..."
}`}
      />

      <EndpointCard
        method="GET"
        path="/agents"
        description="List all available agents. Supports filtering by category and pagination."
        auth={false}
        bodyParams={[
          { name: 'category', type: 'string', description: 'Filter by category (defi-risk, nlp, vision…)' },
          { name: 'limit', type: 'number', description: 'Max results (default: 20, max: 100)' },
          { name: 'offset', type: 'number', description: 'Pagination offset (default: 0)' },
        ]}
        responseExample={`[
  {
    "id": "uuid",
    "slug": "wasi-defi-sentiment",
    "name": "DeFi Sentiment Analyzer",
    "category": "defi-risk",
    "price_per_call": 0.05,
    "currency": "USDC",
    "status": "active",
    "creator": { "username": "wasiai" }
  }
]`}
      />

      <EndpointCard
        method="POST"
        path="/compose"
        description="Execute a pipeline of up to 5 agents in a single request. Supports serial and parallel execution."
        auth={true}
        bodyParams={[
          { name: 'steps', type: 'ComposeStep[]', required: true, description: 'Array of pipeline steps (max 5). Each step: { agent_slug, input?, pass_output?, parallel? }' },
          { name: 'api_key', type: 'string', required: true, description: 'Your Agent Key (wai_...)' },
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
        path="/agent-keys/me"
        description="Get the balance and metadata for the current API key."
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

      {/* TryIt widget */}
      <div className="mt-8">
        <TryIt />
      </div>
    </section>
  )
}
