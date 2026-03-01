import { CodeBlock } from '../components/CodeBlock'

const INSTALL: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'Python',
    language: 'bash',
    code: `pip install wasiai
# or
poetry add wasiai`,
  },
]

const INIT: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'Python',
    language: 'python',
    code: `from wasiai import WasiAI
import os

client = WasiAI(api_key=os.environ["WASIAI_API_KEY"])`,
  },
]

const INVOKE: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'Python',
    language: 'python',
    code: `import json

result = client.agents.invoke("wasi-defi-sentiment", {
    "input": json.dumps({
        "token_name":   "SafeMoonElonGem",
        "token_symbol": "SMEG",
        "description":  "100x guaranteed returns!",
    })
})

print(result.output)
# { "sentiment_score": 92, "flags": ["FOMO naming"], "analysis": "..." }
print(result.latency_ms) # 1240`,
  },
]

const AGENTS_LIST: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'Python',
    language: 'python',
    code: `agents = client.agents.list(category="defi-risk", limit=10)

for agent in agents:
    print(agent.slug, agent.name, agent.price_per_call)`,
  },
]

const AGENTS_GET: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'Python',
    language: 'python',
    code: `agent = client.agents.get("wasi-defi-sentiment")

print(agent.name)           # "DeFi Sentiment Analyzer"
print(agent.price_per_call) # 0.05`,
  },
]

const ERROR_HANDLING: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'Python',
    language: 'python',
    code: `import json
from wasiai import WasiAI, WasiAIError

try:
    result = client.agents.invoke("wasi-defi-sentiment", {
        "input": json.dumps({"token_name": "AVAX", "token_symbol": "AVAX"})
    })
except WasiAIError as e:
    print(e.status, e.code, e.message)
    # e.g. 402, 'INSUFFICIENT_BALANCE', 'Not enough credits'`,
  },
]

export function SdkPythonSection() {
  return (
    <section id="sdk-python" className="scroll-mt-20 space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">SDK Python</h2>
        <p className="mt-2 text-gray-600">
          The official Python SDK for WasiAI. Requires Python 3.9+.
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
