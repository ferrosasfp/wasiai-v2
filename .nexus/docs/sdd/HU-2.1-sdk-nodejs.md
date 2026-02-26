# SDD — HU-2.1: SDK Node.js `@wasiai/sdk`

> **Estado:** SPEC_APPROVED ✅
> **Fecha:** 2026-02-26
> **Linear:** WAS-11 · **Sprint:** 3

---

## Objetivo
Publicar un paquete npm `@wasiai/sdk` que permita a cualquier developer invocar agentes de WasiAI en 3 líneas de código, con TypeScript nativo y manejo de errores tipado.

---

## Estructura del paquete

```
packages/sdk/
├── src/
│   ├── index.ts          ← exports públicos
│   ├── client.ts         ← clase WasiAI principal
│   ├── types.ts          ← tipos públicos
│   └── errors.ts         ← WasiAIError, RateLimitError, etc.
├── package.json
├── tsconfig.json
└── README.md
```

---

## API pública

```typescript
import { WasiAI } from '@wasiai/sdk'

const client = new WasiAI({ apiKey: 'wasi_xxx' })

// Invocar un agente
const result = await client.invoke('agent-slug', { input: 'Translate this to Spanish' })
// result: { output: string; latencyMs: number; receiptId: string }

// Listar agentes disponibles
const agents = await client.list({ category: 'translation', limit: 10 })
// agents: Agent[]

// Obtener un agente por slug
const agent = await client.get('agent-slug')
// agent: Agent | null
```

---

## Implementación — `src/client.ts`

```typescript
const BASE_URL = 'https://wasiai-v2.vercel.app'

export interface WasiAIConfig {
  apiKey: string
  baseUrl?: string  // override para tests / self-hosted
}

export interface InvokeOptions {
  input: string
  timeout?: number  // ms, default 30000
}

export interface InvokeResult {
  output: string
  latencyMs: number
  receiptId: string
}

export interface Agent {
  slug: string
  name: string
  description: string
  category: string
  priceUsdc: string
  inputExample?: string
}

export interface ListOptions {
  category?: string
  search?: string
  limit?: number
  offset?: number
}

export class WasiAI {
  private baseUrl: string
  private apiKey: string

  constructor(config: WasiAIConfig) {
    if (!config.apiKey) throw new WasiAIError('apiKey is required')
    this.apiKey  = config.apiKey
    this.baseUrl = config.baseUrl ?? BASE_URL
  }

  async invoke(slug: string, options: InvokeOptions): Promise<InvokeResult> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeout ?? 30000)
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/agents/${slug}/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
        body: JSON.stringify({ input: options.input }),
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (res.status === 429) throw new RateLimitError()
      if (res.status === 402) throw new InsufficientFundsError()
      if (res.status === 404) throw new AgentNotFoundError(slug)
      if (!res.ok) throw new WasiAIError(`Invoke failed: ${res.status}`)
      return await res.json() as InvokeResult
    } catch (err) {
      clearTimeout(timeout)
      if ((err as Error).name === 'AbortError') throw new TimeoutError()
      throw err
    }
  }

  async list(options: ListOptions = {}): Promise<Agent[]> {
    const params = new URLSearchParams()
    if (options.category) params.set('category', options.category)
    if (options.search)   params.set('search', options.search)
    if (options.limit)    params.set('limit', String(options.limit))
    if (options.offset)   params.set('offset', String(options.offset))
    const res = await fetch(`${this.baseUrl}/api/v1/agents?${params}`, {
      headers: { 'X-API-Key': this.apiKey },
    })
    if (!res.ok) throw new WasiAIError(`List failed: ${res.status}`)
    const data = await res.json()
    return data.agents ?? data
  }

  async get(slug: string): Promise<Agent | null> {
    const res = await fetch(`${this.baseUrl}/api/v1/agents/${slug}`, {
      headers: { 'X-API-Key': this.apiKey },
    })
    if (res.status === 404) return null
    if (!res.ok) throw new WasiAIError(`Get failed: ${res.status}`)
    return await res.json()
  }
}
```

---

## Errores — `src/errors.ts`

```typescript
export class WasiAIError      extends Error { constructor(msg: string) { super(msg); this.name = 'WasiAIError' } }
export class RateLimitError   extends WasiAIError { constructor() { super('Rate limit exceeded') } }
export class InsufficientFundsError extends WasiAIError { constructor() { super('Insufficient funds in API key') } }
export class AgentNotFoundError extends WasiAIError { constructor(slug: string) { super(`Agent "${slug}" not found`) } }
export class TimeoutError     extends WasiAIError { constructor() { super('Request timed out') } }
```

---

## `packages/sdk/package.json`

```json
{
  "name": "@wasiai/sdk",
  "version": "0.1.0",
  "description": "Official Node.js SDK for WasiAI — the AI agent marketplace",
  "main": "dist/index.js",
  "module": "dist/index.mjs",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format cjs,esm --dts",
    "dev":   "tsup src/index.ts --format cjs,esm --dts --watch"
  },
  "keywords": ["wasiai", "ai", "agents", "avalanche", "sdk"],
  "license": "MIT",
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.0.0"
  }
}
```

---

## README.md mínimo

```markdown
# @wasiai/sdk

Official SDK for [WasiAI](https://wasiai-v2.vercel.app) — the AI agent marketplace on Avalanche.

## Install
\`\`\`bash
npm install @wasiai/sdk
\`\`\`

## Quick start
\`\`\`typescript
import { WasiAI } from '@wasiai/sdk'

const client = new WasiAI({ apiKey: 'wasi_xxx' })
const result = await client.invoke('text-summarizer', { input: 'Long article...' })
console.log(result.output)
\`\`\`

## Methods
- `invoke(slug, { input })` — invoke an agent
- `list({ category?, search?, limit? })` — list agents
- `get(slug)` — get agent details
```

---

## Definition of Done
- [ ] `packages/sdk/` creado con estructura completa
- [ ] Build con `tsup` → CJS + ESM + tipos `.d.ts`
- [ ] Exports: `WasiAI`, todos los errores, tipos `Agent`, `InvokeResult`
- [ ] `README.md` con ejemplo funcional
- [ ] `npm run build` en `packages/sdk/` pasa sin errores
- [ ] `npm run build` del proyecto principal sigue limpio
