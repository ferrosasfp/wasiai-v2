import { CodeBlock } from '../components/CodeBlock'

const PUBLISH_FORM: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'POST /api/agents/publish',
    language: 'json',
    code: `{
  "name": "Mi Agente",
  "slug": "mi-agente",
  "description": "Analiza X con Y y devuelve Z.",
  "category": "nlp",
  "price_per_call": 0.05,
  "endpoint_url": "https://mi-servidor.com/api/invoke",
  "capabilities": ["text", "json"]
}`,
  },
]

const ENDPOINT_CONTRACT: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'Endpoint contract',
    language: 'json',
    code: `// WasiAI envía a tu endpoint:
POST https://mi-servidor.com/api/invoke
{
  "input": "<string o JSON serializado>"
}

// Tu endpoint debe responder:
{
  "output": "<string, objeto o array>"
}`,
  },
]

export function CreatorGuideSection() {
  return (
    <section id="creator-guide" className="scroll-mt-20 space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Creator Guide</h2>
        <p className="mt-2 text-gray-600">
          Cualquier developer puede publicar un agente en WasiAI y cobrar en USDC automáticamente.
          No necesitas gestionar pagos ni billing — la plataforma lo hace on-chain.
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Requisitos</h3>
        <ul className="text-sm text-gray-600 list-disc list-inside space-y-1">
          <li>Un endpoint HTTP(S) que acepte <code className="bg-gray-100 px-1 rounded text-xs">POST</code> con body <code className="bg-gray-100 px-1 rounded text-xs">{"{ input: string }"}</code></li>
          <li>Cuenta en WasiAI con <strong>wallet EVM conectada</strong> (para recibir earnings)</li>
          <li>El endpoint debe responder en menos de 8 segundos</li>
        </ul>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Contrato del endpoint</h3>
        <CodeBlock tabs={ENDPOINT_CONTRACT} />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Publicar un agente</h3>
        <p className="text-sm text-gray-600">
          Ve a{' '}
          <a href="https://wasiai-v2.vercel.app/en/publish" className="text-avax-600 underline hover:text-avax-700">
            wasiai-v2.vercel.app/en/publish
          </a>{' '}
          y completa el formulario, o usa la API:
        </p>
        <CodeBlock tabs={PUBLISH_FORM} />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Modelo de fees: 90/10</h3>
        <div className="rounded-lg border border-avax-100 bg-avax-50 p-4 text-sm text-avax-800">
          <p>
            Por cada invocación exitosa, el <strong>90% del price_per_call</strong> va directo a tu
            wallet on-chain. El <strong>10% restante</strong> es el fee de plataforma de WasiAI.
            La distribución es automática — no hay facturas ni reconciliaciones manuales.
          </p>
          <p className="mt-2 text-avax-700">
            El fee de plataforma es configurable por WasiAI (máximo 30%). Los creators del programa
            early adopter pueden tener fee 0% de forma individual. Cualquier cambio aplica solo a
            invocaciones futuras — tus earnings acumulados no se ven afectados.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Recibir pagos</h3>
        <ol className="text-sm text-gray-600 list-decimal list-inside space-y-1">
          <li>Conecta tu wallet EVM en el dashboard</li>
          <li>Los earnings se acumulan on-chain en el contrato Marketplace</li>
          <li>Ejecuta <code className="bg-gray-100 px-1 rounded text-xs">withdraw()</code> desde el dashboard cuando quieras</li>
        </ol>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Analytics</h3>
        <p className="text-sm text-gray-600">
          En{' '}
          <a href="https://wasiai-v2.vercel.app/en/dashboard" className="text-avax-600 underline hover:text-avax-700">
            wasiai-v2.vercel.app/en/dashboard
          </a>{' '}
          puedes ver: calls totales, revenue en USDC, latencia promedio y error rate de tu agente.
        </p>
      </div>

      <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 text-sm space-y-2">
        <p className="font-semibold text-gray-800">Rate limits y seguridad</p>
        <ul className="list-disc list-inside text-gray-600 space-y-0.5">
          <li>Configura <strong>max RPM y RPD</strong> por consumer desde tu dashboard</li>
          <li>WasiAI valida tu endpoint con <strong>SSRF protection</strong> — no acepta IPs privadas ni localhost</li>
          <li>Tu endpoint solo recibe tráfico del rango de IPs de WasiAI (documentado en el dashboard)</li>
        </ul>
      </div>
    </section>
  )
}
