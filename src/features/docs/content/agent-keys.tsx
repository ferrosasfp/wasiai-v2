'use client'

import { useTranslations } from 'next-intl'
import { CodeBlock } from '../components/CodeBlock'

const CREATE_KEY: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'curl',
    language: 'bash',
    code: `# Via dashboard: app.wasiai.io/en/agent-keys

# Or via API (requires authenticated session):
curl -X POST https://app.wasiai.io/api/agent-keys \\
  -H "Content-Type: application/json" \\
  -H "Cookie: <session>" \\
  -d '{"name": "my-trading-bot", "budget_usdc": 10}'

# Response:
{
  "key": "wasi_xxxxxxxxxxxx",
  "budget_usdc": 10
}
# ⚠️ The key is shown ONCE. Store it in a safe place.`,
  },
]

const USE_KEY: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'curl',
    language: 'bash',
    code: `curl -X POST https://app.wasiai.io/api/v1/models/wasi-defi-sentiment/invoke \\
  -H "Content-Type: application/json" \\
  -H "x-agent-key: wasi_xxxxxxxxxxxx" \\
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
    code: `curl https://app.wasiai.io/api/v1/agent-keys/me \\
  -H "x-agent-key: wasi_xxxxxxxxxxxx"

# Response:
{
  "key_id": "uuid",
  "name": "my-trading-bot",
  "budget_usdc": "10.00",
  "spent_usdc": "2.35",
  "remaining_usdc": "7.65",
  "created_at": "2026-01-15T10:00:00Z"
}`,
  },
]

const SCOPED_KEY: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'curl',
    language: 'bash',
    code: `# Create a key scoped to specific agents
curl -X POST https://app.wasiai.io/api/agent-keys \\
  -H "Content-Type: application/json" \\
  -H "Cookie: <session>" \\
  -d '{
    "name": "defi-only-bot",
    "budget_usdc": 10,
    "allowed_slugs": ["wasi-defi-sentiment", "wasi-chainlink-price"],
    "allowed_categories": ["defi"]
  }'

# If this key tries to invoke an agent outside its scope:
# HTTP 403 { "code": "agent_not_in_scope", "message": "..." }`,
  },
]

export function AgentKeysSection() {
  const t = useTranslations('docs')

  return (
    <section id="agent-keys" className="scroll-mt-20 space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">{t('agentKeysContent.title')}</h2>
        <p className="mt-2 text-gray-600">
          {t('agentKeysContent.description')}
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">{t('agentKeysContent.createTitle')}</h3>
        <CodeBlock tabs={CREATE_KEY} />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">{t('agentKeysContent.useTitle')}</h3>
        <p className="text-sm text-gray-600">
          {t('agentKeysContent.useDescription')}
        </p>
        <CodeBlock tabs={USE_KEY} />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">{t('agentKeysContent.balanceTitle')}</h3>
        <CodeBlock tabs={BALANCE} />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">{t('agentKeysContent.scopingTitle')}</h3>
        <p className="text-sm text-gray-600">
          {t('agentKeysContent.scopingDescription')}
        </p>
        <CodeBlock tabs={SCOPED_KEY} />
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
          {t('agentKeysContent.scopingNote')}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">{t('agentKeysContent.fundTitle')}</h3>
        <p className="text-sm text-gray-600">
          {t('agentKeysContent.fundDescription')}{' '}
          <a href="https://app.wasiai.io/en/agent-keys" className="text-avax-600 underline hover:text-avax-700">
            app.wasiai.io/en/agent-keys
          </a>
          {t('agentKeysContent.fundSuffix')}
        </p>
      </div>

      <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 text-sm space-y-2">
        <p className="font-semibold text-gray-800">{t('agentKeysContent.limitsTitle')}</p>
        <ul className="list-disc list-inside text-gray-600 space-y-0.5">
          <li>{t('agentKeysContent.limit1')}</li>
          <li>{t('agentKeysContent.limit2')}</li>
          <li>{t('agentKeysContent.limit3')}</li>
          <li>{t('agentKeysContent.limit4')}</li>
        </ul>
      </div>
    </section>
  )
}
