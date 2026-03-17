'use client'
import { useTranslations } from 'next-intl'
import { CodeBlock } from '../components/CodeBlock'

const FLOW: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'x402 flow',
    language: 'bash',
    code: `# 1. POST without payment header → 402 Payment Required
curl -X POST https://app.wasiai.io/api/v1/models/wasi-defi-sentiment/invoke \\
  -H "Content-Type: application/json" \\
  -d '{"input": "{\\"token_name\\":\\"AVAX\\",\\"token_symbol\\":\\"AVAX\\"}"}'
# → HTTP 402 + { amount, recipient, chain }

# 2. Sign ERC-3009 with viem (see code below)

# 3. Retry with X-402-Payment header
curl -X POST https://app.wasiai.io/api/v1/models/wasi-defi-sentiment/invoke \\
  -H "Content-Type: application/json" \\
  -H "X-402-Payment: <base64_payload>" \\
  -d '{"input": "{\\"token_name\\":\\"AVAX\\",\\"token_symbol\\":\\"AVAX\\"}"}'
# → 200 OK + result + receipt_signature`,
  },
]

const SIGN: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'pay.ts',
    language: 'javascript',
    code: `import { createWalletClient, http, parseUnits } from 'viem'
import { avalanche } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const MARKETPLACE = '0x9316E902760f2c37CDA57C8Be01358D890a26276'
const USDC_MAINNET = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'

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
      chainId: 43114, // Avalanche C-Chain
      verifyingContract: USDC_MAINNET,
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
    label: 'Mainnet Contracts',
    language: 'bash',
    code: `# Avalanche C-Chain (chainId: 43114)
Marketplace: 0x9316E902760f2c37CDA57C8Be01358D890a26276
USDC:        0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E`,
  },
]

export function X402Section() {
  const t = useTranslations('docs.x402Content')
  return (
    <section id="x402" className="scroll-mt-20 space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">x402 Payments</h2>
        <p className="mt-2 text-gray-600">
          {t.rich('intro', {
            code: (c) => <code className="bg-gray-100 px-1 rounded text-xs">{c}</code>,
            strong: (c) => <strong>{c}</strong>,
          })}
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">{t('whenTitle')}</h3>
        <ul className="text-sm text-gray-600 list-disc list-inside space-y-1">
          <li>{t.rich('when1', { strong: (c) => <strong>{c}</strong> })}</li>
          <li>{t('when2')}</li>
          <li>{t('when3')}</li>
        </ul>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">{t('flowTitle')}</h3>
        <CodeBlock tabs={FLOW} />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">{t('signTitle')}</h3>
        <p className="text-sm text-gray-600">
          {t.rich('signDesc', {
            code: (c) => <code className="bg-gray-100 px-1 rounded text-xs">{c}</code>,
          })}
        </p>
        <CodeBlock tabs={SIGN} />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">{t('receiptTitle')}</h3>
        <p className="text-sm text-gray-600">
          {t.rich('receiptDesc', {
            code: (c) => <code className="bg-gray-100 px-1 rounded text-xs">{c}</code>,
          })}
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">{t('contractsTitle')}</h3>
        <CodeBlock tabs={CONTRACTS} />
      </div>
    </section>
  )
}
