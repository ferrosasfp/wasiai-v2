# SDD-028 — LlamaIndex Plugin `llama-index-wasiai`

**HU:** WAS-41  
**NNN:** 028  
**Fase:** F2 — Software Design Document  
**Fecha:** 2026-03-02  
**Autor:** Architect (NexusAgil QUALITY)

---

## 1. Context Map

```
┌─────────────────────────────────────────────────────────┐
│  Usuario final (desarrollador LlamaIndex)               │
│  import { WasiAITool } from 'llama-index-wasiai'        │
│  const tool = new WasiAITool({ slug, apiKey })          │
│  agent.addTool(tool)  ◄─── LlamaIndex agent loop        │
└──────────────────────┬──────────────────────────────────┘
                       │ tool.call({ query: "..." })
                       ▼
┌─────────────────────────────────────────────────────────┐
│  llama-index-wasiai  (este package)                     │
│  src/WasiAITool.ts                                      │
│  implements BaseTool<{ query: string }>                 │
└──────────────────────┬──────────────────────────────────┘
                       │ POST /api/v1/agents/{slug}/invoke
                       │ headers: X-API-Key: apiKey
                       │ body: { input: query }
                       ▼
┌─────────────────────────────────────────────────────────┐
│  WasiAI API  (wasiai-v2 / Vercel)                       │
│  /api/v1/agents/[slug]/invoke/route.ts                  │
│  → proxy a /api/v1/models/[slug]/invoke                 │
│  → responde: string (texto plano o JSON)                │
└─────────────────────────────────────────────────────────┘
```

### Archivos leídos (Codebase Grounding)

| Archivo | Rol |
|---------|-----|
| `src/app/api/v1/agents/[slug]/invoke/route.ts` | Contrato del endpoint: `POST`, header `X-API-Key`, body `{ input }`, responde texto/JSON |
| `wasiai-cli/src/commands/invoke.js` | Exemplar de invocación: `fetch(url, { method:'POST', headers:{'X-API-Key':key}, body: JSON.stringify({input}) })` |
| `wasiai-cli/package.json` | Referencia de estructura: ESM, `publishConfig.access=public`, no deps pesadas |

---

## 2. D1 — Estructura del Package

**Repo:** `/home/ferdev/.openclaw/workspace/wasiai-llamaindex/`  
**npm name:** `llama-index-wasiai`

```
wasiai-llamaindex/
├── src/
│   ├── WasiAITool.ts       ← clase principal
│   └── index.ts            ← re-export público
├── test/
│   └── WasiAITool.test.ts  ← tests con mock fetch
├── examples/
│   └── llamaindex/
│       └── index.ts        ← ejemplo mínimo de uso
├── dist/                   ← output tsc (gitignored)
├── package.json
├── tsconfig.json
└── README.md
```

**Decisiones de build:**
- `"type": "module"` → ESM puro
- `tsc` → output `dist/`, `declaration: true`, `declarationMap: true`
- `main: "dist/index.js"`, `types: "dist/index.d.ts"`
- `exports` map: `"."` → import + types
- Peer dependency: `llamaindex@^0.12.x` (no bundled)

---

## 3. D2 — Interfaz LlamaIndex exacta

**Investigación realizada:** npm install `llamaindex@0.12.1`, lectura de:
- `@llamaindex/core/llms/dist/index.d.ts` → `BaseTool`, `ToolMetadata`
- `@llamaindex/core/tools/dist/index.d.ts` → `FunctionTool`

### Interfaces reales de LlamaIndex 0.12.x

```typescript
// De @llamaindex/core/llms (re-exportado por llamaindex)
type ToolMetadata<Parameters extends Record<string, unknown> = Record<string, unknown>> = {
  description: string
  name: string
  parameters?: Parameters
}

interface BaseTool<Input = any> {
  call?: (input: Input) => JSONValue | Promise<JSONValue>
  metadata: Input extends Known ? ToolMetadata<JSONSchemaType<Input>> : ToolMetadata
}

type BaseToolWithCall<Input = any> = Omit<BaseTool<Input>, 'call'> & {
  call: NonNullable<Pick<BaseTool<Input>, 'call'>['call']>
}
```

### Implementación elegida para `WasiAITool`

```typescript
import type { BaseTool, ToolMetadata } from 'llamaindex'

export interface WasiAIInput {
  query: string
}

export class WasiAITool implements BaseTool<WasiAIInput> {
  readonly metadata: ToolMetadata

  constructor(private opts: WasiAIToolOptions) {
    this.metadata = {
      name: opts.name ?? opts.slug,
      description: opts.description ?? `WasiAI agent: ${opts.slug}`,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Query to send to the agent' }
        },
        required: ['query']
      }
    }
  }

  async call(input: WasiAIInput): Promise<string> { ... }
}
```

**Justificación de `BaseTool` vs `FunctionTool`:**
- `BaseTool` es la interfaz mínima que acepta cualquier agente LlamaIndex
- `FunctionTool` es una implementación concreta que requiere `JSONSchemaType<T>` (ajv), añade dep pesada
- Clase propia da más control sobre errores, timeout, base URL configurable

---

## 4. D3 — Formato del input en `call()`

LlamaIndex 0.12.x pasa el input al tool como **objeto tipado** según el tipo genérico de `BaseTool<Input>`.

```typescript
// El agente LlamaIndex invoca:
tool.call({ query: "¿Cuál es el precio del AVAX?" })

// Internamente WasiAITool hace:
const response = await fetch(`${baseUrl}/api/v1/agents/${slug}/invoke`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': apiKey,
  },
  body: JSON.stringify({ input: input.query }),
})
```

**Contrato con el endpoint WasiAI (verificado en route.ts):**
- Método: `POST`
- Header: `X-API-Key: <apiKey>`
- Body: `{ "input": "<string>" }`
- Respuesta: texto plano o JSON serializado como string

---

## 5. Archivos a crear

| Ruta | Descripción |
|------|-------------|
| `wasiai-llamaindex/src/WasiAITool.ts` | Implementación principal |
| `wasiai-llamaindex/src/index.ts` | Exports públicos |
| `wasiai-llamaindex/test/WasiAITool.test.ts` | Tests con mock fetch |
| `wasiai-llamaindex/examples/llamaindex/index.ts` | Ejemplo de uso |
| `wasiai-llamaindex/package.json` | Config npm |
| `wasiai-llamaindex/tsconfig.json` | Config TypeScript |
| `wasiai-llamaindex/README.md` | Documentación |

---

## 6. ACs técnicos verificables

| AC | Verificación |
|----|-------------|
| AC1: `WasiAITool` implementa `BaseTool<WasiAIInput>` | `tsc --noEmit` sin errores |
| AC2: `call({ query })` hace POST a `/api/v1/agents/{slug}/invoke` | test unitario con mock fetch |
| AC3: Header `X-API-Key` presente en todas las requests | test unitario verifica headers |
| AC4: Errores HTTP (4xx/5xx) se propagan como `Error` con mensaje claro | test con mock 401/500 |
| AC5: `metadata.name`, `.description`, `.parameters` correctamente definidos | test verifica metadata |
| AC6: Exporta tipos: `WasiAITool`, `WasiAIInput`, `WasiAIToolOptions` | `tsc` genera `.d.ts` correcto |
| AC7: `npm pack` produce tarball publicable, `peerDependencies: llamaindex@^0.12.x` | `npm pack --dry-run` |
| AC8: `baseUrl` configurable (default `https://wasiai-v2.vercel.app`) | test con baseUrl custom |

---

## 7. Constraint Directives

### OBLIGATORIO
- Importar SOLO de `llamaindex` (no de `@llamaindex/core` directo) → compatibilidad
- `call()` SIEMPRE retorna `Promise<string>` (JSONValue compatible)
- `fetch` nativo de Node 18+ (sin polyfills ni axios)
- `metadata.parameters` debe seguir JSON Schema draft-07 (compatible con OpenAI function calling)
- Timeout configurable con `AbortSignal.timeout()`, default 30s
- API key NUNCA en logs/stdout (igual que el CLI)

### PROHIBIDO
- Bundlear `llamaindex` en el package (solo peerDep)
- Usar `require()` / CommonJS
- Depender de variables de entorno del servidor Next.js (es un package cliente)
- Hacer llamadas a otros endpoints internos de WasiAI

---

## 8. Tests — cómo mockear la API WasiAI

Se usa `node:test` (built-in Node 18+) + mock global de `fetch`:

```typescript
import { describe, it, before, after, mock } from 'node:test'
import assert from 'node:assert'
import { WasiAITool } from '../src/index.js'

describe('WasiAITool', () => {
  let originalFetch: typeof global.fetch

  before(() => {
    originalFetch = global.fetch
  })

  after(() => {
    global.fetch = originalFetch
  })

  it('AC2+AC3: hace POST con X-API-Key y body correcto', async () => {
    let capturedRequest: Request | undefined

    global.fetch = mock.fn(async (req: Request) => {
      capturedRequest = req
      return new Response(JSON.stringify({ result: 'ok' }), { status: 200 })
    }) as unknown as typeof global.fetch

    const tool = new WasiAITool({
      slug: 'my-agent',
      apiKey: 'test-key-123',
    })

    const result = await tool.call({ query: 'hola' })

    assert.ok(capturedRequest)
    assert.equal(capturedRequest.method, 'POST')
    assert.match(capturedRequest.url, /\/api\/v1\/agents\/my-agent\/invoke$/)
    assert.equal(capturedRequest.headers.get('X-API-Key'), 'test-key-123')

    const body = await capturedRequest.clone().json()
    assert.equal(body.input, 'hola')
    assert.equal(result, JSON.stringify({ result: 'ok' }))
  })

  it('AC4: error 401 lanza Error con mensaje claro', async () => {
    global.fetch = mock.fn(async () =>
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
    ) as unknown as typeof global.fetch

    const tool = new WasiAITool({ slug: 'agent', apiKey: 'bad-key' })
    await assert.rejects(
      () => tool.call({ query: 'test' }),
      (err: Error) => {
        assert.match(err.message, /401/)
        return true
      }
    )
  })
})
```

---

## 9. Implementation Readiness Check

- [x] Contrato endpoint verificado (route.ts leído)
- [x] Exemplar de invocación verificado (invoke.js leído)
- [x] Interfaz LlamaIndex verificada (tipos instalados y leídos)
- [x] Nombre npm `llama-index-wasiai` confirmado disponible
- [x] Story File generado con código completo
- [x] Tests definidos con mock strategy

**SPEC READY ✅**
