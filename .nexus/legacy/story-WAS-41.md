# Story File — WAS-41: Plugin LlamaIndex `llama-index-wasiai`

**NNN:** 028  
**HU:** WAS-41  
**Modo:** QUALITY  
**Fecha:** 2026-03-02  
**Repo del plugin:** `/home/ferdev/.openclaw/workspace/wasiai-llamaindex/`

---

## Contexto

Este story file es autocontenido. El Dev lee SOLO este archivo.

**Objetivo:** Crear el package npm `llama-index-wasiai` que permite usar agentes WasiAI como herramientas (`BaseTool`) dentro de cualquier agente LlamaIndex TS.

**Interfaz LlamaIndex elegida:** `BaseTool<WasiAIInput>` de `llamaindex@0.12.x`  
- `call(input: { query: string }): Promise<string>` — método requerido  
- `metadata: ToolMetadata` — propiedad requerida  

---

## Wave W0 — Setup (serial)

### W0.1 — Inicializar repo

```bash
mkdir -p /home/ferdev/.openclaw/workspace/wasiai-llamaindex
cd /home/ferdev/.openclaw/workspace/wasiai-llamaindex
git init
mkdir -p src test examples/llamaindex
```

---

## Wave W1 — Archivos (pueden crearse en paralelo)

### W1.1 — `package.json`

Crear `/home/ferdev/.openclaw/workspace/wasiai-llamaindex/package.json`:

```json
{
  "name": "llama-index-wasiai",
  "version": "0.1.0",
  "description": "LlamaIndex tool wrapper for WasiAI agents — invoke any WasiAI agent as a LlamaIndex tool",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      }
    }
  },
  "files": [
    "dist/",
    "README.md"
  ],
  "scripts": {
    "build": "tsc",
    "test": "node --experimental-test-coverage --test test/**/*.test.ts --loader=ts-node/esm 2>/dev/null || node --test test/**/*.test.js",
    "test:ts": "tsx --test test/**/*.test.ts",
    "prepublishOnly": "npm run build"
  },
  "peerDependencies": {
    "llamaindex": "^0.12.x"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "llamaindex": "^0.12.1",
    "tsx": "^4.0.0",
    "typescript": "^5.4.0"
  },
  "engines": {
    "node": ">=18"
  },
  "publishConfig": {
    "access": "public"
  },
  "keywords": ["wasiai", "llamaindex", "llama-index", "ai", "agents", "tool", "plugin"],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/ferrosasfp/wasiai-llamaindex"
  }
}
```

---

### W1.2 — `tsconfig.json`

Crear `/home/ferdev/.openclaw/workspace/wasiai-llamaindex/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": false,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test", "examples"]
}
```

---

### W1.3 — `src/WasiAITool.ts` ← NÚCLEO

Crear `/home/ferdev/.openclaw/workspace/wasiai-llamaindex/src/WasiAITool.ts`:

```typescript
/**
 * WasiAITool — LlamaIndex BaseTool wrapper for WasiAI agents
 *
 * Implements BaseTool<WasiAIInput> from llamaindex@0.12.x
 * Verified interface: @llamaindex/core/llms BaseTool + ToolMetadata
 *
 * Endpoint contract (from wasiai-v2/src/app/api/v1/agents/[slug]/invoke/route.ts):
 *   POST /api/v1/agents/{slug}/invoke
 *   Header: X-API-Key: <apiKey>
 *   Body: { input: string }
 *   Response: string (text/json)
 */
import type { BaseTool, ToolMetadata } from 'llamaindex'

export interface WasiAIInput {
  query: string
}

export interface WasiAIToolOptions {
  /** Agent slug in WasiAI marketplace */
  slug: string
  /** WasiAI API key (X-API-Key header) */
  apiKey: string
  /** Tool name shown to LLM (default: slug) */
  name?: string
  /** Tool description shown to LLM */
  description?: string
  /** Base URL for WasiAI API (default: https://wasiai-v2.vercel.app) */
  baseUrl?: string
  /** Request timeout in ms (default: 30000) */
  timeoutMs?: number
}

export class WasiAITool implements BaseTool<WasiAIInput> {
  readonly metadata: ToolMetadata

  private readonly slug: string
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(opts: WasiAIToolOptions) {
    this.slug = opts.slug
    this.apiKey = opts.apiKey
    this.baseUrl = (opts.baseUrl ?? 'https://wasiai-v2.vercel.app').replace(/\/$/, '')
    this.timeoutMs = opts.timeoutMs ?? 30_000

    this.metadata = {
      name: opts.name ?? opts.slug,
      description: opts.description ?? `WasiAI agent "${opts.slug}" — a specialized AI agent on the WasiAI marketplace.`,
      parameters: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string',
            description: 'The query or instruction to send to the agent',
          },
        },
        required: ['query'],
      },
    }
  }

  /**
   * Invoke the WasiAI agent.
   *
   * @param input - { query: string } passed by LlamaIndex agent loop
   * @returns Agent response as string
   * @throws Error with HTTP status if request fails
   */
  async call(input: WasiAIInput): Promise<string> {
    const url = `${this.baseUrl}/api/v1/agents/${encodeURIComponent(this.slug)}/invoke`

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
        body: JSON.stringify({ input: input.query }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (err) {
      if (err instanceof Error) {
        if (err.name === 'TimeoutError' || err.name === 'AbortError') {
          throw new Error(`WasiAITool [${this.slug}]: Request timed out after ${this.timeoutMs}ms`)
        }
        throw new Error(`WasiAITool [${this.slug}]: Network error — ${err.message}`)
      }
      throw err
    }

    const text = await response.text()

    if (!response.ok) {
      let detail = text
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>
        detail = String(parsed.error ?? parsed.message ?? text)
      } catch {
        // raw text is fine
      }
      throw new Error(`WasiAITool [${this.slug}]: HTTP ${response.status} — ${detail}`)
    }

    return text
  }
}
```

---

### W1.4 — `src/index.ts`

Crear `/home/ferdev/.openclaw/workspace/wasiai-llamaindex/src/index.ts`:

```typescript
export { WasiAITool } from './WasiAITool.js'
export type { WasiAIInput, WasiAIToolOptions } from './WasiAITool.js'
```

---

### W1.5 — `test/WasiAITool.test.ts`

Crear `/home/ferdev/.openclaw/workspace/wasiai-llamaindex/test/WasiAITool.test.ts`:

```typescript
/**
 * Tests para WasiAITool — usando node:test + mock de fetch global
 * Corre con: npx tsx --test test/WasiAITool.test.ts
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { WasiAITool } from '../src/index.js'

// Helper: mock fetch global
function mockFetch(handler: (url: string, init: RequestInit) => Response): void {
  ;(global as Record<string, unknown>).fetch = async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => handler(String(url), init ?? {})
}

let originalFetch: typeof global.fetch

describe('WasiAITool', () => {
  before(() => {
    originalFetch = global.fetch
  })

  after(() => {
    global.fetch = originalFetch
  })

  describe('metadata', () => {
    it('AC5: metadata con slug como nombre por defecto', () => {
      const tool = new WasiAITool({ slug: 'my-agent', apiKey: 'k1' })
      assert.equal(tool.metadata.name, 'my-agent')
      assert.ok(tool.metadata.description.includes('my-agent'))
      assert.equal((tool.metadata.parameters as Record<string,unknown>)?.['type'], 'object')
    })

    it('AC5: metadata con nombre y descripción custom', () => {
      const tool = new WasiAITool({
        slug: 'precio-avax',
        apiKey: 'k1',
        name: 'PrecioAVAX',
        description: 'Obtiene el precio actual de AVAX',
      })
      assert.equal(tool.metadata.name, 'PrecioAVAX')
      assert.equal(tool.metadata.description, 'Obtiene el precio actual de AVAX')
    })
  })

  describe('call()', () => {
    it('AC2+AC3: POST a /api/v1/agents/{slug}/invoke con X-API-Key y body correcto', async () => {
      let capturedUrl = ''
      let capturedInit: RequestInit = {}

      mockFetch((url, init) => {
        capturedUrl = url
        capturedInit = init
        return new Response('respuesta del agente', { status: 200 })
      })

      const tool = new WasiAITool({
        slug: 'test-agent',
        apiKey: 'my-api-key-123',
        baseUrl: 'https://custom.example.com',
      })

      const result = await tool.call({ query: 'hola mundo' })

      assert.equal(capturedUrl, 'https://custom.example.com/api/v1/agents/test-agent/invoke')
      assert.equal((capturedInit.headers as Record<string, string>)['X-API-Key'], 'my-api-key-123')
      assert.equal((capturedInit.headers as Record<string, string>)['Content-Type'], 'application/json')
      assert.equal(capturedInit.method, 'POST')

      const body = JSON.parse(capturedInit.body as string) as Record<string, unknown>
      assert.equal(body['input'], 'hola mundo')
      assert.equal(result, 'respuesta del agente')
    })

    it('AC8: baseUrl default apunta a wasiai-v2.vercel.app', async () => {
      let capturedUrl = ''
      mockFetch((url) => {
        capturedUrl = url
        return new Response('ok', { status: 200 })
      })

      const tool = new WasiAITool({ slug: 'agente', apiKey: 'k' })
      await tool.call({ query: 'test' })

      assert.ok(capturedUrl.startsWith('https://wasiai-v2.vercel.app'))
    })

    it('AC4: error 401 lanza Error con status', async () => {
      mockFetch(() =>
        new Response(JSON.stringify({ error: 'unauthorized', message: 'Invalid API key' }), {
          status: 401,
        })
      )

      const tool = new WasiAITool({ slug: 'agente', apiKey: 'bad-key' })
      await assert.rejects(
        () => tool.call({ query: 'test' }),
        (err: Error) => {
          assert.ok(err.message.includes('401'))
          assert.ok(err.message.includes('unauthorized'))
          return true
        }
      )
    })

    it('AC4: error 500 lanza Error con status', async () => {
      mockFetch(() =>
        new Response('Internal Server Error', { status: 500 })
      )

      const tool = new WasiAITool({ slug: 'agente', apiKey: 'k' })
      await assert.rejects(
        () => tool.call({ query: 'test' }),
        (err: Error) => {
          assert.ok(err.message.includes('500'))
          return true
        }
      )
    })

    it('AC4: slug especial es URL-encoded', async () => {
      let capturedUrl = ''
      mockFetch((url) => {
        capturedUrl = url
        return new Response('ok', { status: 200 })
      })

      const tool = new WasiAITool({ slug: 'mi agente/v2', apiKey: 'k' })
      await tool.call({ query: 'test' })

      assert.ok(!capturedUrl.includes(' '), 'URL no debe tener espacios')
      assert.ok(capturedUrl.includes('mi%20agente%2Fv2'))
    })
  })
})
```

---

### W1.6 — `examples/llamaindex/index.ts`

Crear `/home/ferdev/.openclaw/workspace/wasiai-llamaindex/examples/llamaindex/index.ts`:

```typescript
/**
 * Ejemplo: WasiAI agent como tool en un agente LlamaIndex
 *
 * Para correr: npx tsx examples/llamaindex/index.ts
 * Requiere: WASIAI_API_KEY env var
 */
import { WasiAITool } from 'llama-index-wasiai'
import { OpenAI } from 'llamaindex'
import { ReActAgent } from 'llamaindex/agent'

const apiKey = process.env.WASIAI_API_KEY
if (!apiKey) throw new Error('Set WASIAI_API_KEY env var')

// 1. Crear el tool WasiAI
const precioDeFiTool = new WasiAITool({
  slug: 'precio-defi',
  apiKey,
  name: 'PrecioDeFi',
  description: 'Obtiene precios actuales de tokens DeFi: AVAX, ETH, BTC, etc.',
})

// 2. Crear agente LlamaIndex con el tool
const llm = new OpenAI({ model: 'gpt-4o-mini' })
const agent = new ReActAgent({ tools: [precioDeFiTool], llm })

// 3. Invocar
const response = await agent.chat({
  message: '¿Cuál es el precio actual de AVAX en USD?',
})

console.log(response.message.content)
```

---

### W1.7 — `README.md`

Crear `/home/ferdev/.openclaw/workspace/wasiai-llamaindex/README.md`:

```markdown
# llama-index-wasiai

> Use any [WasiAI](https://wasiai-v2.vercel.app) agent as a LlamaIndex tool in 5 lines.

## Quick Start

```bash
npm install llama-index-wasiai llamaindex
```

```typescript
import { WasiAITool } from 'llama-index-wasiai'

const tool = new WasiAITool({ slug: 'my-agent', apiKey: process.env.WASIAI_API_KEY! })
agent.addTool(tool)  // works with any LlamaIndex agent
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `slug` | `string` | — | Agent slug from WasiAI marketplace |
| `apiKey` | `string` | — | WasiAI API key (`X-API-Key`) |
| `name` | `string` | slug | Tool name shown to LLM |
| `description` | `string` | auto | Tool description shown to LLM |
| `baseUrl` | `string` | `https://wasiai-v2.vercel.app` | WasiAI API base URL |
| `timeoutMs` | `number` | `30000` | Request timeout in ms |

## License

MIT
```

---

## Wave W2 — Build & Verify (serial, después de W1)

```bash
cd /home/ferdev/.openclaw/workspace/wasiai-llamaindex

# Instalar deps
npm install

# Build TypeScript
npm run build
# Esperar: dist/index.js, dist/index.d.ts, dist/WasiAITool.js, dist/WasiAITool.d.ts

# Verificar tipos
npx tsc --noEmit
# Esperar: 0 errores

# Tests
npx tsx --test test/WasiAITool.test.ts
# Esperar: todos los tests pasan (✓ 6 tests)

# Dry run publish
npm pack --dry-run
# Verificar: llama-index-wasiai-0.1.0.tgz sin node_modules
```

---

## DoD (Definition of Done)

- [ ] `tsc --noEmit` sin errores
- [ ] 6 tests pasan (metadata x2, call x4)
- [ ] `npm pack --dry-run` lista archivos correctos (dist/, README.md)
- [ ] `dist/index.d.ts` exporta `WasiAITool`, `WasiAIInput`, `WasiAIToolOptions`
- [ ] `peerDependencies` tiene `llamaindex@^0.12.x`
- [ ] No hay `node_modules` en el tarball

---

## Anti-Hallucination Protocol

Antes de codear `WasiAITool.ts`:

1. **Verificar imports existen:**
   ```bash
   node -e "import('llamaindex').then(m => console.log(Object.keys(m).filter(k => k.includes('Tool'))))"
   ```
   Esperar: `['BaseTool', 'FunctionTool', 'QueryEngineTool', ...]`

2. **Verificar `BaseTool` es type-only (no clase):**
   ```bash
   node -e "import('llamaindex').then(m => console.log(typeof m.BaseTool))"
   ```
   Esperar: `undefined` (es interface, no valor en runtime) → usar `import type`

3. **Verificar fetch nativo en Node 18:**
   ```bash
   node -e "console.log(typeof fetch)"
   ```
   Esperar: `function`

---

## Contrato de integración

```
LlamaIndex Agent Loop
  │
  ├── tool.metadata → { name, description, parameters (JSON Schema) }
  │   Uso: LLM decide cuándo llamar al tool
  │
  └── tool.call({ query: string }) → Promise<string>
      │
      └── POST https://wasiai-v2.vercel.app/api/v1/agents/{slug}/invoke
          Headers: { "X-API-Key": apiKey, "Content-Type": "application/json" }
          Body: { "input": query }
          Response 200: text → devuelto directamente como string
          Response 4xx/5xx: throw Error("WasiAITool [{slug}]: HTTP {status} — {detail}")
```
