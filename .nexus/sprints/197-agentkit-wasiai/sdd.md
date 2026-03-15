# SDD #197: AgentKit × WasiAI — ejemplo funcional

> SPEC_APPROVED: yes — 2026-03-14
> Fecha: 2026-03-14 | Clasificación: HU-MAJOR

## 1. Resumen

Crear un ejemplo funcional y ejecutable en `examples/agentkit-wasiai/` donde un agente
Coinbase AgentKit llama a un agente WasiAI via `x-agent-key` (budget pre-fondeado).
El ejemplo es el entregable del hackathon Avalanche Build Games Stage 3.
El directorio existente `examples/agentkit-demo/` es el canónico de x402 — no tocar.

## 2. Acceptance Criteria

- **AC1:** WHEN `cd examples/agentkit-wasiai && npm install && npm run demo`, THE script SHALL completar sin errores y mostrar la respuesta del agente WasiAI.
- **AC2:** WHEN el script ejecuta, THE output SHALL incluir: `call_id`, `latency_ms`, `result` del agente.
- **AC3:** WHEN `ls examples/agentkit-wasiai/`, THE directorio SHALL contener: `package.json`, `src/wasiai-tool.ts`, `src/index.ts`, `.env.example`.
- **AC4:** WHEN se lee el README, THE sección "## Quickstart" SHALL tener ≤5 pasos hasta `npm run demo`.
- **AC5:** WHEN `src/wasiai-tool.ts`, THE tool SHALL usar `ActionProvider` de `@coinbase/agentkit` con un `WasiAIAction` que llama `POST /api/v1/models/:slug/invoke` con `x-agent-key`.
- **AC6:** WHEN el agente no encuentra respuesta del agente WasiAI (404/503), THE tool SHALL retornar un mensaje de error descriptivo (no crash).
- **AC7:** WHEN `.env.example`, THE archivo SHALL documentar: `WASIAI_API_KEY`, `WASIAI_AGENT_SLUG`, `CDP_API_KEY_NAME`, `CDP_API_KEY_PRIVATE_KEY`, `OPENAI_API_KEY`.

## 3. Context Map

| Archivo | Rol |
|---------|-----|
| `examples/agentkit-wasiai/README.md` | Ya existe — ampliar con Quickstart ≤5 pasos |
| `examples/agentkit-demo/` | Ejemplo x402 canónico — NO tocar |
| `examples/agentkit-wasiai/src/wasiai-provider.ts` | Snippet en README — mover a archivo real |

## 4. Diseño Técnico

### 4.1 Estructura final

```
examples/agentkit-wasiai/
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── wasiai-tool.ts    # ActionProvider con WasiAI
│   └── index.ts          # AgentKit agent + demo run
└── README.md             # Quickstart ≤5 pasos
```

### 4.2 wasiai-tool.ts

```typescript
import { ActionProvider, Network, CreateAction } from '@coinbase/agentkit'
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

  // AgentKit 0.10.x: el decorator pasa (walletProvider, args) — 2 parámetros
  @CreateAction({ name: 'call_wasiai_agent', description: 'Call a WasiAI agent', schema: WasiAISchema })
  async callAgent(_walletProvider: WalletProvider, args: z.infer<typeof WasiAISchema>): Promise<string> {
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
      const err = await res.json().catch(() => ({}))
      return `WasiAI error ${res.status}: ${err.error ?? 'unknown'}`
    }

    const data = await res.json()
    return JSON.stringify({ call_id: data.call_id, latency_ms, result: data.result })
  }

  supportsNetwork = (_: Network) => true
}
```

### 4.3 index.ts

```typescript
import { AgentKit } from '@coinbase/agentkit'
import { getLangChainTools } from '@coinbase/agentkit-langchain'
import { ChatOpenAI } from '@langchain/openai'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { HumanMessage } from '@langchain/core/messages'
import { WasiAIActionProvider } from './wasiai-tool'

async function main() {
  const agentkit = await AgentKit.from({
    cdpApiKeyName:       process.env.CDP_API_KEY_NAME!,
    cdpApiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY!,
    actionProviders:     [new WasiAIActionProvider()],
  })

  const tools = getLangChainTools(agentkit)
  const llm   = new ChatOpenAI({ model: 'gpt-4o-mini' })
  const agent = createReactAgent({ llm, tools })

  const slug  = process.env.WASIAI_AGENT_SLUG ?? 'wasi-defi-sentiment'
  const query = `Use the WasiAI agent "${slug}" to analyze AVAX and give me a buy/sell signal.`

  console.log('🤖 AgentKit agent starting...\n')
  const result = await agent.invoke({ messages: [new HumanMessage(query)] })
  const last = result.messages.at(-1)
  console.log('\n✅ Agent response:', last?.content)
}

main().catch(console.error)
```

### 4.4 package.json

Usar versión exacta de agentkit verificada en npm (`0.10.4` al 2026-03-14):

```json
{
  "name": "@wasiai/agentkit-example",
  "version": "1.0.0",
  "scripts": {
    "demo": "tsx src/index.ts",
    "build": "tsc"
  },
  "dependencies": {
    "@coinbase/agentkit": "0.10.4",
    "@coinbase/agentkit-langchain": "0.10.4",
    "@langchain/core": "^0.3.0",
    "@langchain/langgraph": "^0.2.0",
    "@langchain/openai": "^0.3.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "tsx": "^4.7.0",
    "typescript": "^5.3.0"
  }
}
```

**NOTA:** Versión fijada exacta (sin caret) para evitar breaking changes entre 0.8.x y 0.10.x.

## 5. Wave Plan

**Wave 1** — `package.json` + `tsconfig.json` + `.env.example` → `npm install`
**Wave 2** — `src/wasiai-tool.ts` → `npx tsc --noEmit`
**Wave 3** — `src/index.ts` → `npx tsc --noEmit`
**Wave 4** — Actualizar `README.md` con Quickstart ≤5 pasos
**Wave 5** — Commit: `feat(WAS-197): AgentKit × WasiAI — ejemplo funcional con agent key`

## 6. Rollback

Eliminar `examples/agentkit-wasiai/src/` y `examples/agentkit-wasiai/package.json`.
El README existente se restaura con `git checkout`.

## 7. Critical Constraints

- **OBLIGATORIO:** `npm run demo` debe ejecutar end-to-end sin errores
- **OBLIGATORIO:** Usar `x-agent-key` (no x402) para simplificar el setup del juez
- **OBLIGATORIO:** `.env.example` documentar todas las variables
- **PROHIBIDO:** Tocar `examples/agentkit-demo/` (es el ejemplo x402 canónico)
- **PROHIBIDO:** Hardcodear API keys en el código
