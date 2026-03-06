# Story HU-2.1 — SDK Node.js/TypeScript (`@wasiai/sdk`)

**Estado:** In Progress  
**Fecha:** 2026-02-26  
**Sprint:** 3

---

## Historia

Como developer que quiere integrar agentes de IA en mi app,  
quiero instalar `@wasiai/sdk` y invocar agentes en 3 líneas,  
para no tener que construir las llamadas HTTP manualmente.

---

## Acceptance Criteria

- [ ] `npm install @wasiai/sdk` funciona desde npm público
- [ ] `client.invoke(slug, input)` retorna el output del agente
- [ ] `client.agents.list()` retorna catálogo paginado
- [ ] `client.agents.get(slug)` retorna detalle de un agente
- [ ] Errores tipados: `InsufficientBudgetError`, `AgentNotFoundError`, `WasiAIError` base
- [ ] TypeScript types exportados (100% tipado, sin `any`)
- [ ] README con quickstart funcional
- [ ] Compatibilidad: Node.js 18+, Edge Runtime, browser

---

## Estructura de archivos

```
packages/sdk-node/
├── src/
│   ├── index.ts          # exports públicos
│   ├── client.ts         # WasiAI class principal
│   ├── agents.ts         # AgentsResource (list, get)
│   ├── invoke.ts         # lógica de invocación + x402
│   ├── errors.ts         # clases de error tipadas
│   └── types.ts          # interfaces públicas
├── package.json          # name: @wasiai/sdk
├── tsconfig.json
└── README.md
```

---

## API pública

```ts
// Init
const client = new WasiAI({ apiKey: 'wasi_xxx', baseUrl?: string })

// Invoke
client.invoke(slug: string, input: Record<string, unknown>): Promise<InvokeResult>

// Discovery
client.agents.list(opts?: { page?: number, category?: string }): Promise<AgentList>
client.agents.get(slug: string): Promise<Agent>
```

---

## Tipos

```ts
interface WasiAIOptions {
  apiKey: string
  baseUrl?: string // default: https://wasiai-v2.vercel.app
}

interface InvokeResult {
  output: unknown
  agentSlug: string
  callId: string
  latencyMs: number
}

interface Agent {
  slug: string
  name: string
  description: string
  category: string
  priceUsdc: number
  currency: string
  endpoint: string
}

interface AgentList {
  agents: Agent[]
  total: number
  page: number
  hasMore: boolean
}
```

---

## Errores tipados

```ts
class WasiAIError extends Error {
  constructor(message: string, public statusCode?: number) { super(message) }
}
class InsufficientBudgetError extends WasiAIError {}  // 402
class AgentNotFoundError extends WasiAIError {}       // 404
class RateLimitError extends WasiAIError {}           // 429
```

---

## Endpoints que consume

| Método | Ruta | Header |
|---|---|---|
| POST | `/api/v1/agents/[slug]/invoke` | `X-API-Key: wasi_xxx` |
| GET | `/api/v1/agents` | ninguno (público) |
| GET | `/api/v1/agents/[slug]` | ninguno (público) |

---

## package.json (referencia)

```json
{
  "name": "@wasiai/sdk",
  "version": "0.1.0",
  "description": "Official SDK for WasiAI — The Home of AI Agents",
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
    "test": "vitest run",
    "prepublishOnly": "npm run build"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

---

## DoD

- [ ] `npm run build` sin errores TS
- [ ] Tests unitarios con mock fetch:
  - invoke exitoso
  - invoke 402 → `InsufficientBudgetError`
  - invoke 404 → `AgentNotFoundError`
  - agents.list() exitoso
  - agents.get() exitoso
- [ ] README con ejemplo copy-paste funcional
- [ ] `npm pack` genera tarball limpio sin archivos innecesarios

---

## Notas de implementación

- Usar `fetch` nativo (no axios) para compatibilidad Edge/browser
- NO usar `any` en ningún lado
- El `baseUrl` default es `https://wasiai-v2.vercel.app`
- x402 está abstraído: el SDK envía `X-API-Key` y el backend maneja el payment flow
- El paquete vive en `packages/sdk-node/` (monorepo workspace)
