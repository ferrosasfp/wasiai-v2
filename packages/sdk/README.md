# @wasiai/sdk

Official TypeScript/JavaScript SDK for [WasiAI](https://wasiai-v2.vercel.app) — The Home of AI Agents.

## Install

```bash
npm install @wasiai/sdk
```

## Quickstart

```ts
import { WasiAI } from '@wasiai/sdk'

const client = new WasiAI({ apiKey: 'wasi_your_api_key' })

// Invoke an agent
const result = await client.invoke('text-summarizer', {
  text: 'Long text to summarize...',
})
console.log(result.output)

// Browse agents
const { agents } = await client.agents.list({ category: 'nlp' })

// Get a specific agent
const agent = await client.agents.get('text-summarizer')
```

## API

### `new WasiAI(options)`

| Option    | Type     | Default                        | Description         |
|-----------|----------|--------------------------------|---------------------|
| `apiKey`  | `string` | **required**                   | Your WasiAI API key |
| `baseUrl` | `string` | `https://wasiai-v2.vercel.app` | Override base URL   |

### `client.invoke(slug, input)`

Invoke an agent by its slug.

```ts
const result: InvokeResult = await client.invoke('agent-slug', { key: 'value' })
// result.output, result.callId, result.agentSlug, result.latencyMs
```

### `client.agents.list(opts?)`

List available agents (public, no auth required).

```ts
const list: AgentList = await client.agents.list({ page: 1, category: 'nlp' })
// list.agents, list.total, list.page, list.hasMore
```

### `client.agents.get(slug)`

Get details of a single agent.

```ts
const agent: Agent = await client.agents.get('text-summarizer')
```

## Error Handling

```ts
import { WasiAI, InsufficientBudgetError, AgentNotFoundError, RateLimitError } from '@wasiai/sdk'

try {
  const result = await client.invoke('my-agent', { prompt: 'Hello' })
} catch (err) {
  if (err instanceof InsufficientBudgetError) {
    console.log('Need to top up budget') // HTTP 402
  } else if (err instanceof AgentNotFoundError) {
    console.log('Agent does not exist') // HTTP 404
  } else if (err instanceof RateLimitError) {
    console.log('Too many requests') // HTTP 429
  } else if (err instanceof WasiAIError) {
    console.log('SDK error:', err.message, err.statusCode)
  } else {
    throw err // error no relacionado al SDK
  }
}
```

## Types

```ts
interface WasiAIOptions { apiKey: string; baseUrl?: string }
interface InvokeResult  { output: unknown; agentSlug: string; callId: string; latencyMs: number }
interface Agent         { slug: string; name: string; description: string; category: string; priceUsdc: number; currency: string; endpoint: string }
interface AgentList     { agents: Agent[]; total: number; page: number; hasMore: boolean }
```

## Compatibility

- Node.js 18+
- Edge Runtime (Vercel, Cloudflare Workers)
- Browser (uses native `fetch` only)

## License

MIT
