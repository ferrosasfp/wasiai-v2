import Link from 'next/link'
import { CodeBlock } from '../components/CodeBlock'

const TABS: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'Node.js',
    language: 'javascript',
    code: `// Install: npm install @wasiai/sdk
const { WasiAI } = require('@wasiai/sdk')

const client = new WasiAI({ apiKey: 'wasi_your_key_here' })

const result = await client.agents.invoke('wasi-defi-sentiment', {
  input: {
    token_name:   'AVAX',
    token_symbol: 'AVAX',
  }
})

console.log(result.result)
// { sentiment_score: 72, flags: [], analysis: "Strong DeFi fundamentals..." }`,
  },
  {
    label: 'Python',
    language: 'python',
    code: `# Install: pip install wasiai
from wasiai import WasiAI

client = WasiAI(api_key="wasi_your_key_here")

result = client.agents.invoke("wasi-defi-sentiment", {
    "input": {
        "token_name":   "AVAX",
        "token_symbol": "AVAX",
    }
})

print(result.result)
# { sentiment_score: 72, flags: [], analysis: "Strong DeFi fundamentals..." }`,
  },
  {
    label: 'curl',
    language: 'bash',
    code: `curl -X POST https://app.wasiai.io/api/v1/agents/wasi-defi-sentiment/invoke \\
  -H "Content-Type: application/json" \\
  -H "x-agent-key: wasi_your_key_here" \\
  -d '{"input": {"token_name": "AVAX", "token_symbol": "AVAX"}}'`,
  },
]

export function QuickstartSection() {
  return (
    <section id="quickstart" className="scroll-mt-20 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Quickstart</h2>
        <p className="mt-2 text-gray-600">
          Call your first WasiAI agent in under 2 minutes. Pick your language:
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">1. Get your Agent Key</h3>
        <p className="text-sm text-gray-600">
          Go to <Link href="/agent-keys" className="text-avax-600 underline hover:text-avax-700">Agent Keys</Link> and
          create a key. It starts with <code className="bg-gray-100 px-1 rounded text-xs">wasi_</code>.
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">2. Install the SDK (or use curl)</h3>
        <CodeBlock tabs={TABS} />
      </div>

      <div className="rounded-lg bg-avax-50 border border-avax-100 p-4 text-sm text-avax-700">
        <strong>That&apos;s it.</strong> The example uses <code className="bg-avax-100 px-1 rounded text-xs">wasi-defi-sentiment</code>,
        one of the DeFi Risk agents available on WasiAI. The agent runs in the cloud — you just
        send a JSON payload and get a structured response back.
      </div>
    </section>
  )
}
