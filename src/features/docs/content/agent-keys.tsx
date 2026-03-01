import { CodeBlock } from '../components/CodeBlock'

const CREATE_KEY: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'curl',
    language: 'bash',
    code: `# Via dashboard: wasiai-v2.vercel.app/en/agent-keys

# O via API (requiere sesión autenticada):
curl -X POST https://wasiai-v2.vercel.app/api/agent-keys \\
  -H "Content-Type: application/json" \\
  -H "Cookie: <session>" \\
  -d '{"name": "mi-agente-bot", "budget_usdc": 10}'

# Response:
{
  "key": "wai_xxxxxxxxxxxx",
  "budget_usdc": 10
}
# ⚠️ La key solo se muestra UNA VEZ. Guárdala en un lugar seguro.`,
  },
]

const USE_KEY: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'curl',
    language: 'bash',
    code: `curl -X POST https://wasiai-v2.vercel.app/api/v1/models/wasi-defi-sentiment/invoke \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: wai_xxxxxxxxxxxx" \\
  -d '{"input": "{\\"token_name\\":\\"AVAX\\",\\"token_symbol\\":\\"AVAX\\"}"}'`,
  },
  {
    label: 'Node.js',
    language: 'javascript',
    code: `const { WasiAI } = require('@wasiai/sdk')

const client = new WasiAI({ apiKey: process.env.WASIAI_API_KEY })

const result = await client.agents.invoke('wasi-defi-sentiment', {
  input: JSON.stringify({ token_name: 'AVAX', token_symbol: 'AVAX' })
})
console.log(result.output)`,
  },
]

const BALANCE: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'curl',
    language: 'bash',
    code: `curl https://wasiai-v2.vercel.app/api/v1/agent-keys/me \\
  -H "X-API-Key: wai_xxxxxxxxxxxx"

# Response:
{
  "key_id": "uuid",
  "name": "mi-agente-bot",
  "budget_usdc": "10.00",
  "spent_usdc": "2.35",
  "remaining_usdc": "7.65",
  "created_at": "2026-01-15T10:00:00Z"
}`,
  },
]

export function AgentKeysSection() {
  return (
    <section id="agent-keys" className="scroll-mt-20 space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Agent Keys</h2>
        <p className="mt-2 text-gray-600">
          Las Agent Keys son credenciales de autenticación con <strong>prepago en USDC</strong>.
          Crea una key con un budget, y cada llamada deduce automáticamente el{' '}
          <code className="bg-gray-100 px-1 rounded text-xs">price_per_call</code> del agente invocado.
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Crear una Agent Key</h3>
        <CodeBlock tabs={CREATE_KEY} />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Usar la key</h3>
        <p className="text-sm text-gray-600">
          Incluye el header <code className="bg-gray-100 px-1 rounded text-xs">X-API-Key: wai_...</code> en
          cada request al API.
        </p>
        <CodeBlock tabs={USE_KEY} />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Ver balance</h3>
        <CodeBlock tabs={BALANCE} />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Fondear on-chain</h3>
        <p className="text-sm text-gray-600">
          Para depositar USDC en tu key, ve al dashboard en{' '}
          <a href="https://wasiai-v2.vercel.app/en/agent-keys" className="text-avax-600 underline hover:text-avax-700">
            wasiai-v2.vercel.app/en/agent-keys
          </a>
          . El dashboard gestiona automáticamente la transferencia ERC-3009 desde tu wallet conectada.
        </p>
      </div>

      <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 text-sm space-y-2">
        <p className="font-semibold text-gray-800">Límites y lifecycle</p>
        <ul className="list-disc list-inside text-gray-600 space-y-0.5">
          <li>Budget mínimo: <strong>1 USDC</strong> / máximo: <strong>1000 USDC</strong> por key</li>
          <li>Estado: <strong>activa</strong> → low balance warning → <strong>agotada</strong></li>
          <li>Cuando se agota: las llamadas devuelven <code className="bg-gray-100 px-1 rounded text-xs">402 INSUFFICIENT_BALANCE</code></li>
          <li>Refund disponible desde el dashboard si la key no ha sido usada recientemente</li>
        </ul>
      </div>
    </section>
  )
}
