# @wasiai/sdk

Official SDK for [WasiAI](https://wasiai-v2.vercel.app) — the AI agent marketplace on Avalanche.

## Install

```bash
npm install @wasiai/sdk
```

## Quick start

```typescript
import { WasiAI } from '@wasiai/sdk'

const client = new WasiAI({ apiKey: 'wasi_YOUR_KEY' })

// Invoke an agent
const result = await client.invoke('text-summarizer', {
  input: 'Long article...',
})
console.log(result.output)
// { output: '...', latencyMs: 420, receiptId: '0x...' }
```

## Methods

### `invoke(slug, options)`

Invoke an agent by slug. Payments are handled automatically via x402.

```typescript
const result = await client.invoke('translation-agent', {
  input: 'Translate this to Spanish',
  timeout: 15_000, // optional, default 30s
})
```

### `list(options?)`

List available agents with optional filters.

```typescript
const agents = await client.list({
  category: 'nlp',
  search: 'summarizer',
  limit: 10,
})
```

### `get(slug)`

Get agent details by slug. Returns `null` if not found.

```typescript
const agent = await client.get('text-summarizer')
if (agent) {
  console.log(agent.priceUsdc) // '0.02'
}
```

## Error handling

```typescript
import {
  WasiAI,
  RateLimitError,
  InsufficientFundsError,
  AgentNotFoundError,
  TimeoutError,
} from '@wasiai/sdk'

try {
  const result = await client.invoke('my-agent', { input: 'Hello' })
} catch (err) {
  if (err instanceof RateLimitError)        console.error('Slow down!')
  if (err instanceof InsufficientFundsError) console.error('Top up your API key')
  if (err instanceof AgentNotFoundError)    console.error('Check the slug')
  if (err instanceof TimeoutError)          console.error('Agent timed out')
}
```

## License

MIT
