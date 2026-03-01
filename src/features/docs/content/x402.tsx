import { CodeBlock } from '../components/CodeBlock'

const FLOW: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'Flujo x402',
    language: 'bash',
    code: `# 1. POST sin header de pago → 402 Payment Required
curl -X POST https://wasiai-v2.vercel.app/api/v1/models/wasi-defi-sentiment/invoke \\
  -H "Content-Type: application/json" \\
  -d '{"input": "{\\"token_name\\":\\"AVAX\\",\\"token_symbol\\":\\"AVAX\\"}"}'
# → HTTP 402 + { amount, recipient, chain }

# 2. Firmar ERC-3009 con viem (ver código abajo)

# 3. Re-enviar con X-402-Payment header
curl -X POST https://wasiai-v2.vercel.app/api/v1/models/wasi-defi-sentiment/invoke \\
  -H "Content-Type: application/json" \\
  -H "X-402-Payment: <base64_payload>" \\
  -d '{"input": "{\\"token_name\\":\\"AVAX\\",\\"token_symbol\\":\\"AVAX\\"}"}'
# → 200 OK + resultado + receipt_signature`,
  },
]

const SIGN: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'pay.ts',
    language: 'javascript',
    code: `import { createWalletClient, http, parseUnits } from 'viem'
import { avalancheFuji } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const MARKETPLACE = '0x9d8Eb04Df6Bd271491Bcdbb96b81Ab3103C0CD8E'
const USDC_FUJI   = '0x5425890298aed601595a70AB815c96711a31Bc65'

export async function signERC3009Payment({
  walletClient,
  from,
  priceUsdc,  // e.g. 0.05
}: { walletClient: any; from: \`0x\${string}\`; priceUsdc: number }) {
  const value      = parseUnits(priceUsdc.toString(), 6) // USDC 6 decimals
  const validAfter = BigInt(0)
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600)
  const nonce      = crypto.getRandomValues(new Uint8Array(32))

  const signature = await walletClient.signTypedData({
    account: from,
    domain: {
      name: 'USD Coin',
      version: '2',
      chainId: 43113, // Avalanche Fuji
      verifyingContract: USDC_FUJI,
    },
    types: {
      TransferWithAuthorization: [
        { name: 'from',        type: 'address' },
        { name: 'to',          type: 'address' },
        { name: 'value',       type: 'uint256' },
        { name: 'validAfter',  type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce',       type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: { from, to: MARKETPLACE, value, validAfter, validBefore, nonce: \`0x\${Buffer.from(nonce).toString('hex')}\` },
  })

  const payload = {
    from, to: MARKETPLACE,
    value: value.toString(),
    validAfter: validAfter.toString(),
    validBefore: validBefore.toString(),
    nonce: \`0x\${Buffer.from(nonce).toString('hex')}\`,
    v: parseInt(signature.slice(130, 132), 16),
    r: signature.slice(0, 66),
    s: \`0x\${signature.slice(66, 130)}\`,
  }
  return Buffer.from(JSON.stringify(payload)).toString('base64')
}`,
  },
]

const CONTRACTS: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'Contratos Fuji',
    language: 'bash',
    code: `# Avalanche Fuji Testnet (chainId: 43113)
Marketplace: 0x9d8Eb04Df6Bd271491Bcdbb96b81Ab3103C0CD8E
USDC Fuji:   0x5425890298aed601595a70AB815c96711a31Bc65`,
  },
]

export function X402Section() {
  return (
    <section id="x402" className="scroll-mt-20 space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">x402 Payments</h2>
        <p className="mt-2 text-gray-600">
          x402 es un protocolo de micropagos HTTP nativo basado en el código de estado{' '}
          <code className="bg-gray-100 px-1 rounded text-xs">402 Payment Required</code>.
          WasiAI lo implementa sobre <strong>Avalanche C-Chain</strong> con <strong>USDC</strong>{' '}
          usando firmas ERC-3009 (transferWithAuthorization).
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">¿Cuándo se usa?</h3>
        <ul className="text-sm text-gray-600 list-disc list-inside space-y-1">
          <li>Cuando invocas un agente <strong>sin Agent Key</strong> — pago on-demand por llamada.</li>
          <li>Para agentes autónomos que descubren y pagan otros agentes sin intervención humana.</li>
          <li>Para builds donde prefieres no gestionar un presupuesto pre-fondeado.</li>
        </ul>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Flujo completo</h3>
        <CodeBlock tabs={FLOW} />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Firmar ERC-3009 con viem</h3>
        <p className="text-sm text-gray-600">
          El header <code className="bg-gray-100 px-1 rounded text-xs">X-402-Payment</code> es un JSON Base64
          con la firma ERC-3009. WasiAI verifica la firma y ejecuta{' '}
          <code className="bg-gray-100 px-1 rounded text-xs">transferWithAuthorization</code> on-chain.
        </p>
        <CodeBlock tabs={SIGN} />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Verificar el receipt</h3>
        <p className="text-sm text-gray-600">
          Cada respuesta exitosa incluye un{' '}
          <code className="bg-gray-100 px-1 rounded text-xs">receipt_signature</code>: firma ECDSA del
          operador WasiAI que confirma la ejecución. Puedes verificarla on-chain contra la dirección del
          contrato Marketplace.
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Contratos Fuji Testnet</h3>
        <CodeBlock tabs={CONTRACTS} />
      </div>
    </section>
  )
}
