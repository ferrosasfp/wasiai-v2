import { CodeBlock } from '../components/CodeBlock'

const SERIAL_EXAMPLE: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'Serial pipeline',
    language: 'json',
    code: `POST https://app.wasiai.io/api/v1/compose
X-API-Key: wai_your_key_here
{
  "steps": [
    {
      "agent_slug": "wasi-chainlink-price",
      "input": { "feed_address": "0x..", "token_symbol": "AVAX" }
    },
    {
      "agent_slug": "wasi-defi-sentiment",
      "input": { "token_name": "AVAX", "token_symbol": "AVAX" },
      "pass_output": false
    },
    {
      "agent_slug": "wasi-risk-report",
      "pass_output": true
    }
  ],
}`,
  },
]

const PARALLEL_EXAMPLE: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'Parallel pipeline',
    language: 'json',
    code: `POST https://app.wasiai.io/api/v1/compose
X-API-Key: wai_your_key_here
{
  "steps": [
    {
      "agent_slug": "wasi-chainlink-price",
      "input": { "feed_address": "0x..", "token_symbol": "AVAX" },
      "parallel": true
    },
    {
      "agent_slug": "wasi-defi-sentiment",
      "input": { "token_name": "AVAX", "token_symbol": "AVAX" },
      "parallel": true
    },
    {
      "agent_slug": "wasi-risk-report",
      "pass_output": true
    }
  ],
}`,
  },
]

const RESPONSE: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'Response',
    language: 'json',
    code: `{
  "pipeline_id": "550e8400-e29b-41d4-a716-446655440000",
  "steps_executed": 3,
  "groups_executed": 2,
  "total_cost_usdc": "0.15",
  "result": { "risk_score": 72, "recommendation": "CAUTION" },
  "receipts": [
    { "step": 0, "agent_slug": "wasi-chainlink-price", "cost_usdc": "0.05", "receipt_signature": "0x..." },
    { "step": 1, "agent_slug": "wasi-defi-sentiment",  "cost_usdc": "0.05", "receipt_signature": "0x..." },
    { "step": 2, "agent_slug": "wasi-risk-report",     "cost_usdc": "0.05", "receipt_signature": "0x..." }
  ]
}`,
  },
]

export function ComposeSection() {
  return (
    <section id="compose" className="scroll-mt-20 space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Compose API</h2>
        <p className="mt-2 text-gray-600">
          Chain up to <strong>5 agents</strong> in a single pipeline with one request.
          Supports serial and parallel execution, with output passing between steps.
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Execution modes</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="rounded-lg border border-gray-200 p-4 space-y-1">
            <p className="text-sm font-semibold text-gray-800">Serial (default)</p>
            <p className="text-sm text-gray-600">Agents run sequentially. Each step output can be passed to the next with <code className="bg-gray-100 px-1 rounded text-xs">pass_output: true</code>.</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-4 space-y-1">
            <p className="text-sm font-semibold text-gray-800">Parallel</p>
            <p className="text-sm text-gray-600">Mark multiple consecutive steps with <code className="bg-gray-100 px-1 rounded text-xs">parallel: true</code> to run them in the same group concurrently.</p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Pipeline serial — 3 agentes DeFi</h3>
        <CodeBlock tabs={SERIAL_EXAMPLE} />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Pipeline paralelo — 2 agentes en paralelo</h3>
        <p className="text-sm text-gray-600">
          Los steps con <code className="bg-gray-100 px-1 rounded text-xs">parallel: true</code> consecutivos forman un grupo y se ejecutan en paralelo. El siguiente step recibe los resultados del grupo.
        </p>
        <CodeBlock tabs={PARALLEL_EXAMPLE} />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Response</h3>
        <CodeBlock tabs={RESPONSE} />
      </div>

      <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 text-sm text-gray-700 space-y-1">
        <p className="font-semibold">Compose API limits</p>
        <ul className="list-disc list-inside text-gray-600 space-y-0.5">
          <li>Maximum <strong>5 steps</strong> por pipeline</li>
          <li>Timeout <strong>8 segundos</strong> por step individual</li>
          <li>Rate limit: <strong>10 pipelines/min</strong> por API Key</li>
          <li>Cada step deduce <code className="bg-gray-100 px-1 rounded text-xs">price_per_call</code> del agente</li>
        </ul>
      </div>
    </section>
  )
}
