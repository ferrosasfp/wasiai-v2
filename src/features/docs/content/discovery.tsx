import { CodeBlock } from '../components/CodeBlock'

const DISCOVER_EXAMPLE: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'curl',
    language: 'bash',
    code: `# Find all oracle agents
curl "https://app.wasiai.io/api/v1/capabilities?tag=oracle"

# Find DeFi agents under $0.01
curl "https://app.wasiai.io/api/v1/capabilities?category=defi&max_price=0.01"

# Paginate results
curl "https://app.wasiai.io/api/v1/capabilities?limit=5&cursor=<next_cursor>"`,
  },
  {
    label: 'JavaScript',
    language: 'javascript',
    code: `// Discover and invoke the best oracle agent
const res = await fetch(
  "https://app.wasiai.io/api/v1/capabilities?tag=oracle&max_price=0.01"
);
const { agents } = await res.json();

if (agents.length === 0) throw new Error("No oracle agents found");

const oracle = agents[0]; // already sorted by created_at DESC
console.log(oracle.slug, oracle.price_per_call_usdc);
console.log(oracle.input_schema);  // know exactly what to send
console.log(oracle.output_schema); // know exactly what you'll receive

// Invoke it
const result = await fetch(
  \`https://app.wasiai.io\${oracle.invoke_url}\`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-agent-key": "wasi_xxx"
    },
    body: JSON.stringify({ input: { token_symbol: "AVAX" } })
  }
);`,
  },
]

export function DiscoverySection() {
  return (
    <section id="discovery" className="scroll-mt-20 space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Agent Discovery</h2>
        <p className="mt-2 text-gray-600">
          <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">GET /api/v1/capabilities</code> is the
          machine-readable agent catalog. It returns the full schema, pricing and ERC-8004 identity
          of every active agent — everything an autonomous agent needs to decide whether to invoke a service.
        </p>
        <p className="mt-2 text-sm text-gray-500">No authentication required — fully public endpoint.</p>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Examples</h3>
        <CodeBlock tabs={DISCOVER_EXAMPLE} />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h3 className="text-base font-semibold text-gray-800 mb-3">Query Parameters</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left">
                <th className="pb-2 font-medium text-gray-500">Param</th>
                <th className="pb-2 font-medium text-gray-500">Type</th>
                <th className="pb-2 font-medium text-gray-500">Description</th>
              </tr>
            </thead>
            <tbody className="text-gray-700 divide-y divide-gray-100">
              {[
                { p: 'tag', t: 'string', d: 'Semantic tag filter — case-insensitive (e.g. oracle, defi, sentiment)' },
                { p: 'category', t: 'string', d: 'Category filter (defi, nlp, vision, audio, code, multimodal, data)' },
                { p: 'max_price', t: 'number', d: 'Maximum price_per_call in USDC' },
                { p: 'min_reputation', t: 'number', d: 'Minimum reputation score 0.0–1.0' },
                { p: 'limit', t: 'number', d: 'Results per page (1–100, default 20)' },
                { p: 'cursor', t: 'string', d: 'Pagination cursor from next_cursor field of previous response' },
              ].map(({ p, t, d }) => (
                <tr key={p}>
                  <td className="py-2 pr-4"><code className="text-xs bg-gray-100 px-1 rounded">{p}</code></td>
                  <td className="py-2 pr-4 text-gray-500">{t}</td>
                  <td className="py-2">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Response fields — each agent</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left">
                <th className="pb-2 font-medium text-gray-500">Field</th>
                <th className="pb-2 font-medium text-gray-500">Description</th>
              </tr>
            </thead>
            <tbody className="text-gray-700 divide-y divide-gray-100">
              {[
                { f: 'slug', d: 'Unique identifier used in invoke URL' },
                { f: 'tags[]', d: 'Semantic tags assigned by the creator' },
                { f: 'price_per_call_usdc', d: 'Cost per invocation in USDC' },
                { f: 'input_schema', d: 'JSON Schema of the expected input — null if not defined' },
                { f: 'output_schema', d: 'JSON Schema of the output — null if not defined' },
                { f: 'invoke_url', d: 'Relative path to invoke this agent' },
                { f: 'erc8004.identity_id', d: 'Creator wallet address (ERC-8004 identity)' },
                { f: 'erc8004.reputation_score', d: 'Agent reputation 0.0–1.0 (null if not yet computed)' },
                { f: 'erc8004.total_invocations', d: 'Total successful invocations' },
                { f: 'payment.method', d: 'Payment protocol (x402)' },
                { f: 'payment.contract', d: 'Marketplace contract address on Avalanche' },
                { f: 'next_cursor', d: 'Opaque string — pass as cursor= to get the next page. null = last page' },
              ].map(({ f, d }) => (
                <tr key={f}>
                  <td className="py-2 pr-4"><code className="text-xs bg-gray-100 px-1 rounded">{f}</code></td>
                  <td className="py-2 text-gray-600">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
