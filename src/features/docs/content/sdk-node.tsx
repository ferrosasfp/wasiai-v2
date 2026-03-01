import { CodeBlock } from '../components/CodeBlock'

const INSTALL: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'Node.js',
    language: 'bash',
    code: `npm install @wasiai/sdk
# or
yarn add @wasiai/sdk`,
  },
]

const INIT: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'Node.js',
    language: 'javascript',
    code: `const { WasiAI } = require('@wasiai/sdk')
// or ESM:
// import { WasiAI } from '@wasiai/sdk'

const client = new WasiAI({
  apiKey: process.env.WASIAI_API_KEY, // never hardcode keys!
})`,
  },
]

const INVOKE: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'Node.js',
    language: 'javascript',
    code: `const result = await client.agents.invoke('wasi-defi-sentiment', {
  input: JSON.stringify({
    token_name:   'SafeMoonElonGem',
    token_symbol: 'SMEG',
    description:  '100x guaranteed returns!',
  })
})

console.log(result.output)
// { sentiment_score: 92, flags: ["FOMO naming", "Unrealistic returns"], analysis: "..." }
console.log(result.latencyMs) // 1240`,
  },
]

const AGENTS_LIST: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'Node.js',
    language: 'javascript',
    code: `const agents = await client.agents.list({ category: 'defi-risk', limit: 10 })

for (const agent of agents) {
  console.log(agent.slug, agent.name, agent.pricePerCall)
}`,
  },
]

const AGENTS_GET: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'Node.js',
    language: 'javascript',
    code: `const agent = await client.agents.get('wasi-defi-sentiment')

console.log(agent.name)          // "DeFi Sentiment Analyzer"
console.log(agent.pricePerCall)  // 0.05`,
  },
]

const ERROR_HANDLING: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'Node.js',
    language: 'javascript',
    code: `import { WasiAIError } from '@wasiai/sdk'

try {
  const result = await client.agents.invoke('wasi-defi-sentiment', {
    input: JSON.stringify({ token_name: 'AVAX', token_symbol: 'AVAX' })
  })
} catch (err) {
  if (err instanceof WasiAIError) {
    console.error(err.status, err.code, err.message)
    // e.g. 402, 'INSUFFICIENT_BALANCE', 'Not enough credits'
  }
}`,
  },
]

export function SdkNodeSection() {
  return (
    <section id="sdk-node" className="scroll-mt-20 space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">SDK Node.js</h2>
        <p className="mt-2 text-gray-600">
          The official Node.js SDK for WasiAI. Works in Node.js 18+ and all modern runtimes.
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Installation</h3>
        <CodeBlock tabs={INSTALL} />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Initialize the client</h3>
        <CodeBlock tabs={INIT} />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Invoke an agent</h3>
        <CodeBlock tabs={INVOKE} />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">List agents</h3>
        <CodeBlock tabs={AGENTS_LIST} />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Get agent details</h3>
        <CodeBlock tabs={AGENTS_GET} />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Error handling</h3>
        <CodeBlock tabs={ERROR_HANDLING} />
      </div>
    </section>
  )
}
