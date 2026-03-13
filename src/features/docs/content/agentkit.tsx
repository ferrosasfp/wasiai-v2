import { CodeBlock } from '../components/CodeBlock'

const FLOW: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'Flow AgentKit',
    language: 'bash',
    code: `CDP Wallet (AgentKit)
  → descubrir precio en catálogo WasiAI (GET /api/v1/agents/wasi-defi-sentiment)
  → firmar ERC-3009 transferWithAuthorization (viem)
  → invocar agente con X-402-Payment header
  → recibir resultado + receipt_signature`,
  },
]

const WALLET_CODE: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'wallet.ts',
    language: 'javascript',
    code: `import { CdpWalletProvider } from '@coinbase/agentkit'

// Configura la CDP wallet con tus credenciales
const provider = await CdpWalletProvider.configureWithWallet({
  apiKeyName:       process.env.CDP_API_KEY_ID,
  apiKeyPrivateKey: process.env.CDP_API_KEY_SECRET,
})

const agentAddress = provider.getAddress()
console.log('Agent wallet:', agentAddress)
// Asegúrate de tener USDC en esta dirección`,
  },
]

const INDEX_CODE: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'index.ts',
    language: 'javascript',
    code: `import { getCatalogAgent } from './catalog'
import { signERC3009Payment } from './pay'
import { invokeAgent } from './invoke'

const BASE_URL = 'https://app.wasiai.io'

async function main() {
  // 1. Descubrir el agente en el catálogo
  const agent = await getCatalogAgent(BASE_URL, 'wasi-defi-sentiment')
  console.log(\`Price: \${agent.price_usdc} USDC\`)

  // 2. Firmar el pago ERC-3009
  const payment = await signERC3009Payment({
    walletClient,
    from:      agentAddress,
    to:        '0x24be31D0F538C5551c536b09C85907C43c24d062', // Marketplace Mainnet
    priceUsdc: agent.price_usdc,
  })

  // 3. Invocar el agente con el payment header
  const result = await invokeAgent({
    invokeUrl: agent.invoke_url,
    payment,
    input: JSON.stringify({
      token_name:   'SafeMoonElonGem',
      token_symbol: 'SMEG',
      description:  '100x guaranteed returns!',
    }),
  })

  console.log('Sentiment score:', result.output.sentiment_score)
  console.log('Flags:', result.output.flags)
  console.log('Receipt:', result.receipt_signature)
}

main().catch(console.error)`,
  },
]

const PREREQS: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: '.env',
    language: 'bash',
    code: `# Coinbase Developer Platform
CDP_API_KEY_ID=your_cdp_key_id
CDP_API_KEY_SECRET=your_cdp_key_secret

# La wallet CDP necesita USDC en Avalanche C-Chain
# Red: Avalanche C-Chain (chainId 43114)`,
  },
]

export function AgentKitSection() {
  return (
    <section id="agentkit" className="scroll-mt-20 space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">AgentKit</h2>
        <p className="mt-2 text-gray-600">
          Build autonomous agents that <strong>discover, pay and invoke</strong> otros agentes WasiAI
          sin intervención humana. &quot;Agent paying agent&quot; — el patrón nativo de x402.
        </p>
        <p className="mt-2 text-sm text-gray-500">
          Stack: <strong>Coinbase AgentKit</strong> + <strong>viem</strong> + <strong>x402 protocol</strong>
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Flow</h3>
        <CodeBlock tabs={FLOW} />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Configure the CDP wallet</h3>
        <CodeBlock tabs={WALLET_CODE} />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Flow completo — index.ts</h3>
        <CodeBlock tabs={INDEX_CODE} />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Prerequisites</h3>
        <ol className="text-sm text-gray-600 list-decimal list-inside space-y-1">
          <li>
            Get your <strong>CDP API Key</strong> en{' '}
            <a href="https://portal.cdp.coinbase.com" target="_blank" rel="noopener noreferrer" className="text-avax-600 underline hover:text-avax-700">
              portal.cdp.coinbase.com
            </a>
          </li>
          <li>Fund the wallet with <strong>USDC Mainnet</strong> (Avalanche C-Chain, chainId 43114)</li>
          <li>Clona el ejemplo completo del repo</li>
        </ol>
        <CodeBlock tabs={PREREQS} />
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm space-y-2">
        <p className="font-semibold text-gray-800">Repositorio de ejemplo</p>
        <ul className="list-disc list-inside text-gray-600 space-y-0.5">
          <li>
            Repo:{' '}
            <a href="https://github.com/ferrosasfp/wasiai-agents" target="_blank" rel="noopener noreferrer" className="text-avax-600 underline hover:text-avax-700">
              github.com/ferrosasfp/wasiai-agents
            </a>
          </li>
          <li>Path del ejemplo: <code className="bg-gray-100 px-1 rounded text-xs">wasiai-agents/agents/agentkit-example/</code></li>
          <li>Incluye README completo con setup step-by-step</li>
        </ul>
      </div>
    </section>
  )
}
