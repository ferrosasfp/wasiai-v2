'use client'

import { useTranslations } from 'next-intl'
import { CodeBlock } from '../components/CodeBlock'

const DISCOVER_EXAMPLE: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'curl',
    language: 'bash',
    code: `# Find all oracle agents
curl "https://app.wasiai.io/api/v1/capabilities?tag=oracle"

# Find agents under $0.01
curl "https://app.wasiai.io/api/v1/capabilities?max_price=0.01"

# Cap the number of results
curl "https://app.wasiai.io/api/v1/capabilities?limit=5"

# Walk the WHOLE catalog, page by page.
# Sending offset switches to a deterministic order and adds has_more/next_offset.
curl "https://app.wasiai.io/api/v1/capabilities?offset=0&limit=20"
# -> { "agents": [...20], "total": 25, "has_more": true, "next_offset": 20 }
curl "https://app.wasiai.io/api/v1/capabilities?offset=20&limit=20"
# -> { "agents": [...5],  "total": 25, "has_more": false, "next_offset": null }`,
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

// `category` y `cursor` estaban publicados y NO existen aguas abajo.
// Medido en produccion el 2026-08-04, antes de sacarlos:
//   ?category=defi   y  ?category=BASURA   -> la MISMA lista (no filtraba)
//   ?cursor=<valido> y  ?cursor=BASURA     -> la MISMA primera pagina (no paginaba)
// Desde WKH-322 el gateway responde 400 UNKNOWN_DISCOVER_PARAM a las claves que
// no conoce, asi que seguir publicandolos era instruir una llamada que falla.
// El campo de respuesta `next_cursor` salio por lo mismo: tampoco existe.
//
// `offset` se agrega ACA DESPUES de existir, no antes — es el orden que el
// commit ceddfca83 documenta haber invertido. Lo implementa
// `src/lib/api/catalog-pagination.ts` + `src/app/api/v1/capabilities/route.ts`
// y lo cubre `__tests__/pagination.test.ts` (recorrido completo del catalogo
// sin repetidos ni faltantes, con el doble de upstream barajando cada llamada).
// NO se agrega nada a RESPONSE_FIELDS: esa tabla es de campos POR AGENTE y
// `offset`/`limit`/`has_more`/`next_offset` son de primer nivel — se describen
// en `queryOffsetDesc` y en el ejemplo curl de arriba.
const QUERY_PARAMS = [
  { p: 'tag', t: 'string', dk: 'queryTagDesc' },
  { p: 'max_price', t: 'number', dk: 'queryMaxPriceDesc' },
  { p: 'min_reputation', t: 'number', dk: 'queryMinReputationDesc' },
  { p: 'limit', t: 'number', dk: 'queryLimitDesc' },
  { p: 'offset', t: 'number', dk: 'queryOffsetDesc' },
] as const

const RESPONSE_FIELDS = [
  { f: 'slug', dk: 'fieldSlug' },
  { f: 'tags[]', dk: 'fieldTags' },
  { f: 'price_per_call_usdc', dk: 'fieldPrice' },
  { f: 'input_schema', dk: 'fieldInputSchema' },
  { f: 'output_schema', dk: 'fieldOutputSchema' },
  { f: 'invoke_url', dk: 'fieldInvokeUrl' },
  { f: 'erc8004.identity_id', dk: 'fieldIdentityId' },
  { f: 'erc8004.reputation_score', dk: 'fieldReputationScore' },
  { f: 'erc8004.total_invocations', dk: 'fieldTotalInvocations' },
  { f: 'payment.method', dk: 'fieldPaymentMethod' },
  { f: 'payment.contract', dk: 'fieldPaymentContract' },
] as const

export function DiscoverySection() {
  const t = useTranslations('docs')

  return (
    <section id="discovery" className="scroll-mt-20 space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">{t('discoveryContent.title')}</h2>
        <p className="mt-2 text-gray-600">
          {t('discoveryContent.description')}
        </p>
        <p className="mt-2 text-sm text-gray-500">{t('discoveryContent.noAuth')}</p>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">{t('discoveryContent.examplesTitle')}</h3>
        <CodeBlock tabs={DISCOVER_EXAMPLE} />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h3 className="text-base font-semibold text-gray-800 mb-3">{t('discoveryContent.queryParamsTitle')}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left">
                <th className="pb-2 font-medium text-gray-500">{t('discoveryContent.colParam')}</th>
                <th className="pb-2 font-medium text-gray-500">{t('discoveryContent.colType')}</th>
                <th className="pb-2 font-medium text-gray-500">{t('discoveryContent.colDescription')}</th>
              </tr>
            </thead>
            <tbody className="text-gray-700 divide-y divide-gray-100">
              {QUERY_PARAMS.map(({ p, t: type, dk }) => (
                <tr key={p}>
                  <td className="py-2 pr-4"><code className="text-xs bg-gray-100 px-1 rounded">{p}</code></td>
                  <td className="py-2 pr-4 text-gray-500">{type}</td>
                  <td className="py-2">{t(`discoveryContent.${dk}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-3">
        <h3 className="text-base font-semibold text-gray-800">{t('discoveryContent.responseFieldsTitle')}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left">
                <th className="pb-2 font-medium text-gray-500">{t('discoveryContent.colField')}</th>
                <th className="pb-2 font-medium text-gray-500">{t('discoveryContent.colDescription')}</th>
              </tr>
            </thead>
            <tbody className="text-gray-700 divide-y divide-gray-100">
              {RESPONSE_FIELDS.map(({ f, dk }) => (
                <tr key={f}>
                  <td className="py-2 pr-4"><code className="text-xs bg-gray-100 px-1 rounded">{f}</code></td>
                  <td className="py-2 text-gray-600">{t(`discoveryContent.${dk}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
