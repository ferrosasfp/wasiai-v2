import { ActionProvider, Network, CreateAction, WalletProvider } from '@coinbase/agentkit'
import { z } from 'zod'

const WasiAISchema = z.object({
  slug:  z.string().describe('WasiAI agent slug, e.g. wasi-defi-sentiment'),
  input: z.string().describe('Input to send to the agent'),
})

export class WasiAIActionProvider extends ActionProvider {
  private apiKey: string
  private baseUrl: string

  constructor() {
    super('wasiai', [])
    this.apiKey  = process.env.WASIAI_API_KEY ?? ''
    this.baseUrl = process.env.WASIAI_BASE_URL ?? 'https://app.wasiai.io'
  }

  // AgentKit 0.10.x: decorator validates up to 2 params; first can be WalletProvider
  @CreateAction({ name: 'call_wasiai_agent', description: 'Call a WasiAI agent via x-agent-key budget', schema: WasiAISchema })
  async callAgent(_walletProvider: WalletProvider, args: z.infer<typeof WasiAISchema>): Promise<string> {
    // WAS-197 S1: validate slug to prevent path traversal (only alphanum + hyphens)
    if (!/^[a-z0-9-]{1,80}$/.test(args.slug)) {
      return `Invalid agent slug: "${args.slug}". Must match [a-z0-9-]{1,80}.`
    }

    const start = Date.now()
    const res = await fetch(`${this.baseUrl}/api/v1/models/${args.slug}/invoke`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-key':  this.apiKey,
      },
      body: JSON.stringify({ input: args.input }),
    })

    const latency_ms = Date.now() - start

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string }
      return `WasiAI error ${res.status}: ${err.error ?? 'unknown'}`
    }

    const data = await res.json() as { call_id?: string; result?: string }
    return JSON.stringify({ call_id: data.call_id, latency_ms, result: data.result })
  }

  supportsNetwork = (_network: Network) => true
}
