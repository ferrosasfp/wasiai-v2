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
# -> { "agents": [...5],  "total": 25, "has_more": false, "next_offset": null }

# "total" is a number OR the string "unknown", when the catalog came back
# incomplete and nobody can know the real total. It is never a truncated count
# presented as a total. Do not do arithmetic on it without checking:
# Number("unknown") is NaN, and Number("unknown") || 0 is 0, which reads as
# "no agents" next to a full page of agents.
# "totalAtLeast" is always a number: a LOWER BOUND, not a total.
# -> { "agents": [...20], "total": "unknown", "totalAtLeast": 100,
#      "catalogStatus": "truncated", "has_more": true, "next_offset": 20 }`,
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

// Ranked verified first, then reputation desc, then price asc.
const oracle = agents[0];
console.log(oracle.slug, oracle.priceUsdc);
console.log(oracle.capabilities); // the semantic tags it answers to

// Invoke it. invokeUrl is an absolute URL, so do not prefix it.
const result = await fetch(oracle.invokeUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-agent-key": "wasi_xxx"
  },
  body: JSON.stringify({ input: { token_symbol: "AVAX" } })
});`,
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
// ⚠️ ESE ARREGLO CUBRIO UNA SOLA DE LAS DOS SUPERFICIES. `category` y `cursor`
// siguieron publicados 10 dias mas en `content/api-reference.tsx:47` y `:51`,
// que documenta EL MISMO endpoint en la misma seccion de docs. Recien salieron
// de ahi el 2026-08-14. Antes de tocar una tabla de esta pagina, grepear el
// nombre del parametro o del campo en `src/features/docs/content/` COMPLETO: la
// duplicacion es real y no la avisa nada.
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

// ─── 2026-08-14: la tabla nombraba la forma LEGACY, que este endpoint ya no
// devuelve ───────────────────────────────────────────────────────────────────
// Desde que `capabilities` delega en a2a `GET /discover`, el agente que sale por
// el cable NO es el que armaba `legacyCapabilities`. Medido en produccion sobre
// los 25 agentes de `GET /api/v1/capabilities`, contando presencia campo por
// campo con jq:
//   tags               -> 0/25   (el arreglo de tags se llama `capabilities`, 25/25)
//   price_per_call_usdc-> 0/25   (se llama `priceUsdc`, 25/25)
//   invoke_url         -> 0/25   (se llama `invokeUrl`, 25/25, y es ABSOLUTA)
//   input_schema       -> 0/25   en el agente
//   output_schema      -> 0/25   en el agente
//   erc8004.*          -> 0/25   en el agente
// Los tres primeros son RENOMBRES y por eso se corrigen en vez de borrarse.
//
// Los otros tres SE BORRAN y no se reescriben como `metadata.input_schema`,
// aunque ahi aparezcan: la forma de `metadata` la decide el registry de origen y
// NO es una sola. Medido en la misma corrida: `metadata.input_schema` 21/25 y
// `metadata.inputSchema` 3/25 (los self-published), `metadata.erc8004` 22/25.
// Publicar cualquiera de las dos grafias seria una promesa que se rompe para los
// otros. Cuando el gateway unifique esa forma, vuelven a la tabla.
//
// `slug`, `payment.method` y `payment.contract` se quedan: 25/25 los tres.
const RESPONSE_FIELDS = [
  { f: 'slug', dk: 'fieldSlug' },
  { f: 'capabilities[]', dk: 'fieldTags' },
  { f: 'priceUsdc', dk: 'fieldPrice' },
  { f: 'invokeUrl', dk: 'fieldInvokeUrl' },
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
