'use client'
import { useTranslations } from 'next-intl'
import { CodeBlock } from '../components/CodeBlock'
import Link from 'next/link'

const PUBLISH_FORM: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'POST /api/v1/agents/register',
    language: 'json',
    code: `{
  "name": "My Agent",
  "slug": "my-agent",
  "description": "Analyzes X with Y and returns Z.",
  "category": "nlp",
  "price_per_call": 0.05,
  "endpoint_url": "https://my-server.com/api/invoke",
  "capabilities": ["text", "json"]
}`,
  },
]

const ENDPOINT_CONTRACT: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'Endpoint contract',
    language: 'json',
    code: `// WasiAI sends to your endpoint:
POST https://my-server.com/api/invoke
{
  "input": { "token_symbol": "AVAX" }
}

// Your endpoint must respond:
{
  "result": { "price_usd": 28.5 }
}`,
  },
]

export function CreatorGuideSection() {
  const t = useTranslations('docs.creatorGuideContent')
  return (
    <section id="creator-guide" className="scroll-mt-20 space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Creator Guide</h2>
        <p className="mt-2 text-gray-600">{t('intro')}</p>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">{t('requirementsTitle')}</h3>
        <ul className="text-sm text-gray-600 list-disc list-inside space-y-1">
          <li>{t.rich('req1', { code: (c) => <code className="bg-gray-100 px-1 rounded text-xs">{c}</code> })}</li>
          <li>{t.rich('req2', { strong: (c) => <strong>{c}</strong> })}</li>
          <li>{t('req3')}</li>
        </ul>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">{t('endpointContractTitle')}</h3>
        <CodeBlock tabs={ENDPOINT_CONTRACT} />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">{t('publishTitle')}</h3>
        <p className="text-sm text-gray-600">
          {t.rich('publishDesc', {
            a: (c) => <a href="https://app.wasiai.io/en/publish" className="text-avax-600 underline hover:text-avax-700">{c}</a>,
          })}
        </p>
        <CodeBlock tabs={PUBLISH_FORM} />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">{t('tagsTitle')}</h3>
        <p className="text-sm text-gray-600">
          {t.rich('tagsDesc', { code: (c) => <code className="bg-gray-100 px-1 rounded text-xs">{c}</code> })}
        </p>
        <div className="rounded-lg bg-gray-900 p-4">
          <pre className="text-xs text-green-400">{`"tags": ["oracle", "defi", "price-feed", "real-time"]`}</pre>
        </div>
        <p className="text-sm text-gray-500">
          {t.rich('tagsHint', {
            em: (c) => <em>{c}</em>,
            code: (c) => <code className="bg-gray-100 px-1 rounded text-xs">{c}</code>,
          })}
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">{t('feesTitle')}</h3>
        <div className="rounded-lg border border-avax-100 bg-avax-50 p-4 text-sm text-avax-800">
          <p>{t.rich('fees1', { strong: (c) => <strong>{c}</strong> })}</p>
          <p className="mt-2 text-avax-700">{t('fees2')}</p>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">{t('paymentsTitle')}</h3>
        <ol className="text-sm text-gray-600 list-decimal list-inside space-y-1">
          <li>{t('pay1')}</li>
          <li>{t('pay2')}</li>
          <li>{t.rich('pay3', { code: (c) => <code className="bg-gray-100 px-1 rounded text-xs">{c}</code> })}</li>
        </ol>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">{t('analyticsTitle')}</h3>
        <p className="text-sm text-gray-600">
          {t.rich('analyticsDesc', {
            a: (c) => <a href="https://app.wasiai.io/en/dashboard" className="text-avax-600 underline hover:text-avax-700">{c}</a>,
          })}
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Managing Your Agents</h3>
        <p className="text-sm text-gray-600">
          After registration, you can update your agent anytime using the <code className="bg-gray-100 px-1 rounded text-xs">PATCH /api/v1/agents/:slug</code> endpoint.
          You can change the endpoint URL, description, pricing, schemas, tags, and rate limits — all without re-registering.
        </p>
        <div className="rounded-lg bg-gray-900 p-4 overflow-x-auto">
          <pre className="text-sm text-green-400 whitespace-pre">{`# Update your agent's endpoint and price
curl -X PATCH https://app.wasiai.io/api/v1/agents/my-agent \\
  -H "Content-Type: application/json" \\
  -H "x-agent-key: wasi_..." \\
  -d '{
    "endpoint_url": "https://my-new-api.com/v1/agent",
    "price_per_call": 0.02
  }'

# List all your agents
curl https://app.wasiai.io/api/v1/creator/agents \\
  -H "x-agent-key: wasi_..."`}</pre>
        </div>
        <p className="text-sm text-gray-500">
          See <Link href="/en/docs#api-reference" className="text-avax-600 underline hover:text-avax-700">API Reference</Link> for full details on editable fields.
        </p>
      </div>

      <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 text-sm space-y-2">
        <p className="font-semibold text-gray-800">{t('rateLimitsTitle')}</p>
        <ul className="list-disc list-inside text-gray-600 space-y-0.5">
          <li>{t.rich('rateLimit1', { strong: (c) => <strong>{c}</strong> })}</li>
          <li>{t.rich('rateLimit2', { strong: (c) => <strong>{c}</strong> })}</li>
          <li>{t('rateLimit3')}</li>
        </ul>
      </div>
    </section>
  )
}
