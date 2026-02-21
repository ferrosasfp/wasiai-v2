# WasiAI × Coinbase AgentKit

> Integra WasiAI en un agente de Coinbase AgentKit en menos de 5 minutos.
> Tu agente podrá descubrir, pagar y llamar cualquier modelo del marketplace de forma autónoma.

## Prerrequisitos

- Node.js 18+
- Cuenta en [Coinbase Developer Platform](https://cdp.coinbase.com)
- API Key de WasiAI → [wasiai.io/agent-keys](https://wasiai.io/agent-keys)

## Setup rápido

```bash
npm create onchain-agent@latest
# Elige: Vercel AI SDK → Avalanche → CDP Smart Wallets
cd your-agent
npm install
```

Agrega tus variables de entorno en `.env.local`:

```bash
# Coinbase AgentKit
CDP_API_KEY_NAME=your_key_name
CDP_API_KEY_PRIVATE_KEY=your_private_key
NETWORK_ID=avalanche-mainnet

# WasiAI
WASIAI_API_KEY=wasi_xxxxxxxxxxxxxxxx
WASIAI_BASE_URL=https://wasiai.io
```

## Integración: WasiAI como Action Provider

Crea `src/wasiai-provider.ts`:

```typescript
import { ActionProvider, WalletProvider, CreateAction } from '@coinbase/agentkit'
import { z } from 'zod'

const WASIAI_BASE = process.env.WASIAI_BASE_URL ?? 'https://wasiai.io'
const WASIAI_KEY  = process.env.WASIAI_API_KEY ?? ''

// ── Schemas ────────────────────────────────────────────────────────────────

const DiscoverModelsInput = z.object({
  category: z.enum(['nlp', 'vision', 'audio', 'code', 'multimodal', 'data']).optional(),
  max_price: z.number().optional().describe('Max price per call in USDC'),
  query: z.string().optional().describe('Semantic search query'),
  limit: z.number().default(10),
})

const InvokeModelInput = z.object({
  slug: z.string().describe('Model slug from WasiAI marketplace'),
  input: z.unknown().describe('Input payload for the model (string, object, or array)'),
})

const CheckBudgetInput = z.object({})

// ── Action Provider ────────────────────────────────────────────────────────

export class WasiAIActionProvider extends ActionProvider {
  constructor() {
    super('wasiai', [])
  }

  @CreateAction({
    name: 'wasiai_check_budget',
    description: 'Check remaining USDC budget for this agent key before making calls.',
    schema: CheckBudgetInput,
  })
  async checkBudget(_walletProvider: WalletProvider, _args: z.infer<typeof CheckBudgetInput>) {
    const res = await fetch(`${WASIAI_BASE}/api/v1/agent-keys/me`, {
      headers: { 'x-agent-key': WASIAI_KEY },
    })
    const data = await res.json()
    return JSON.stringify(data)
  }

  @CreateAction({
    name: 'wasiai_discover_models',
    description: 'Discover AI models available on WasiAI marketplace. Use this before invoking a model to find the right one.',
    schema: DiscoverModelsInput,
  })
  async discoverModels(_walletProvider: WalletProvider, args: z.infer<typeof DiscoverModelsInput>) {
    const params = new URLSearchParams()
    if (args.category)  params.set('category', args.category)
    if (args.max_price) params.set('max_price', args.max_price.toString())
    if (args.query)     params.set('q', args.query)
    params.set('limit', args.limit.toString())

    const res = await fetch(`${WASIAI_BASE}/api/v1/models?${params}`, {
      headers: { 'x-agent-key': WASIAI_KEY },
    })
    const models = await res.json()
    return JSON.stringify(models)
  }

  @CreateAction({
    name: 'wasiai_invoke_model',
    description: 'Call an AI model on WasiAI. Pays automatically via agent key budget. Returns the model result.',
    schema: InvokeModelInput,
  })
  async invokeModel(_walletProvider: WalletProvider, args: z.infer<typeof InvokeModelInput>) {
    const res = await fetch(`${WASIAI_BASE}/api/v1/models/${args.slug}/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-key': WASIAI_KEY,
      },
      body: JSON.stringify({ input: args.input }),
    })

    if (res.status === 402) {
      const info = await res.json()
      return JSON.stringify({
        error: info.code === 'budget_exceeded'
          ? `Budget exhausted. Remaining: $${info.remaining} USDC. Needed: $${info.needed}`
          : 'Payment required — check agent key budget',
        ...info,
      })
    }

    const data = await res.json()
    return JSON.stringify(data)
  }

  supportsNetwork = () => true
}
```

## Registrar el provider en tu agente

En tu archivo principal del agente (`agent.ts` o `app/api/chat/route.ts`):

```typescript
import { AgentKit } from '@coinbase/agentkit'
import { WasiAIActionProvider } from './wasiai-provider'

const agentKit = await AgentKit.from({
  cdpApiKeyName: process.env.CDP_API_KEY_NAME!,
  cdpApiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
  actionProviders: [
    new WasiAIActionProvider(),
    // ...otros providers
  ],
})
```

## Ejemplo de uso — el agente en acción

Una vez registrado, tu agente puede razonar y usar WasiAI solo:

```
User: "Traduce este texto al español y genera una imagen del resultado"

Agent thought process:
1. wasiai_check_budget()        → { remaining: $4.80, status: "ok" }
2. wasiai_discover_models({ category: "nlp", query: "translation" })
   → [{ slug: "gpt-translator", price: 0.01 }]
3. wasiai_invoke_model({ slug: "gpt-translator", input: "Hello world" })
   → { result: "Hola mundo", meta: { charged: 0.01 } }
4. wasiai_discover_models({ category: "vision", query: "image generation" })
   → [{ slug: "flux-pro", price: 0.02 }]
5. wasiai_invoke_model({ slug: "flux-pro", input: "Hola mundo illustration" })
   → { result: { image_url: "..." }, meta: { charged: 0.02 } }

Total spent: $0.03 USDC
```

## Identidad ERC-8004 (opcional, recomendado)

Para registrar la identidad on-chain de tu agente en WasiAI:

```typescript
// En wasiai.io/agent-keys → "Link ERC-8004 Identity"
// O vía API:
await fetch('https://wasiai.io/api/v1/agent-keys/identity', {
  method: 'POST',
  headers: { 'x-agent-key': WASIAI_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    chain_address: agentWallet.address,  // Dirección del smart wallet del agente
    framework: 'agentkit',
    permissions: ['invoke_models', 'discover'],
  }),
})
```

Beneficios:
- Historial de llamadas vinculado a identidad on-chain
- Creators pueden configurar acceso exclusivo para agentes verificados
- Reputación transferible entre deployments

## Links

- [WasiAI Agent Docs](https://wasiai.io/docs/agents)
- [Coinbase AgentKit](https://github.com/coinbase/agentkit)
- [x402 Protocol Spec](https://x402.org)
- [ERC-8004 Draft](https://eips.ethereum.org/EIPS/eip-8004)
