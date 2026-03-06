# Story File — 010 — WAS-23: Plugin LangChain
**Agente destino:** Dev | **Fecha:** 2026-03-01 | **Modo:** QUALITY | **Branch:** `feat/010-langchain-plugin`

> Dev lee SOLO este archivo. Sin SDD, sin HU original, sin contexto adicional.
> Si algo no está aquí → DETENER y preguntar al Architect.

---

## Goal
Publicar `@wasiai/sdk@0.2.0` con nuevo export `@wasiai/sdk/langchain` (JS) y `wasiai-langchain@0.1.0` (Python) que exponen `WasiAITool` y `WasiAIToolkit` — compatibles con LangChain — para que developers integren agentes WasiAI en sus chains sin escribir HTTP manualmente.

---

## Repos de trabajo

| Repo | Descripción |
|---|---|
| `github.com/ferrosasfp/wasiai-sdk` | SDK JS — agregar export `@wasiai/sdk/langchain` |
| Nuevo repo: `github.com/ferrosasfp/wasiai-langchain` | SDK Python LangChain |

> **wasiai-v2 NO se toca.** Este trabajo es en repos externos.

---

## Acceptance Criteria

| # | Criterio | Verificable en |
|---|---|---|
| AC-1 | `WasiAITool` instanciable con `{ slug, apiKey, description? }` | test unitario |
| AC-2 | `tool.invoke(input)` llama `POST /api/v1/models/{slug}/invoke` con `X-API-Key` y devuelve `string` | test unitario con mock |
| AC-3 | Errores 402/429/5xx lanzan `WasiAIPaymentError` / `WasiAIRateLimitError` / `WasiAIServerError` | test unitario |
| AC-4 | `WasiAIToolkit({ slugs, apiKey })` devuelve array de `WasiAITool` | test unitario |
| AC-5 | Compatible con LangChain JS `StructuredTool` interface | types check |
| AC-6 | Compatible con LangChain Python `BaseTool` interface | types check |
| AC-7 | `@wasiai/sdk@0.2.0` publicado en npm con export `@wasiai/sdk/langchain` | npm registry |
| AC-8 | `wasiai-langchain@0.1.0` publicado en PyPI | PyPI registry |
| AC-9 | README con ejemplos copy-paste JS y Python | repo README |

---

## Integration Contract

### JS — `@wasiai/sdk/langchain`

```typescript
// src/langchain/WasiAITool.ts
import { StructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

export class WasiAITool extends StructuredTool {
  name: string
  description: string
  schema = z.object({ input: z.string() })

  constructor(private config: {
    slug: string
    apiKey: string
    description?: string
    baseUrl?: string  // default: 'https://wasiai-v2.vercel.app'
  }) {
    super()
    this.name = config.slug
    this.description = config.description ?? `WasiAI agent: ${config.slug}`
  }

  protected async _call({ input }: { input: string }): Promise<string> {
    // POST /api/v1/models/{slug}/invoke con X-API-Key
    // Devuelve result como string
    // Lanza WasiAIPaymentError | WasiAIRateLimitError | WasiAIServerError
  }
}

export class WasiAIToolkit {
  constructor(private config: { slugs: string[]; apiKey: string; baseUrl?: string }) {}
  getTools(): WasiAITool[] {
    return this.config.slugs.map(slug =>
      new WasiAITool({ slug, apiKey: this.config.apiKey, baseUrl: this.config.baseUrl })
    )
  }
}
```

### Errores tipados JS
```typescript
export class WasiAIPaymentError extends Error { constructor(public slug: string) { super(`Payment required for ${slug}`) } }
export class WasiAIRateLimitError extends Error { constructor(public slug: string) { super(`Rate limit exceeded for ${slug}`) } }
export class WasiAIServerError extends Error { constructor(public slug: string, public status: number) { super(`Server error ${status} for ${slug}`) } }
```

### Python — `wasiai-langchain`
```python
# wasiai_langchain/tool.py
from langchain.tools import BaseTool
from wasiai import WasiAIClient  # usa wasiai@0.1.0 como dep

class WasiAITool(BaseTool):
    name: str
    description: str
    slug: str
    api_key: str
    base_url: str = "https://wasiai-v2.vercel.app"

    def _run(self, input: str) -> str:
        # Llama POST /api/v1/models/{slug}/invoke
        # Lanza WasiAIPaymentError | WasiAIRateLimitError | WasiAIServerError

class WasiAIToolkit:
    def __init__(self, slugs: list[str], api_key: str):
        self.tools = [WasiAITool(name=s, slug=s, description=f"WasiAI: {s}", api_key=api_key) for s in slugs]
    def get_tools(self) -> list[WasiAITool]:
        return self.tools
```

---

## Archivos a crear — JS (`wasiai-sdk`)

| Archivo | Contenido |
|---|---|
| `src/langchain/WasiAITool.ts` | Clase WasiAITool extendiendo StructuredTool |
| `src/langchain/WasiAIToolkit.ts` | Clase WasiAIToolkit |
| `src/langchain/errors.ts` | WasiAIPaymentError, WasiAIRateLimitError, WasiAIServerError |
| `src/langchain/index.ts` | Re-export de todo |
| `src/langchain/WasiAITool.test.ts` | Tests unitarios con mock fetch |

## Archivos a modificar — JS (`wasiai-sdk`)

| Archivo | Cambio |
|---|---|
| `package.json` | bump a `0.2.0`, agregar export `"./langchain"` |
| `tsconfig.json` | verificar que `src/langchain/` está incluido |

## Archivos a crear — Python (`wasiai-langchain` — repo nuevo)

| Archivo | Contenido |
|---|---|
| `wasiai_langchain/__init__.py` | Exports |
| `wasiai_langchain/tool.py` | WasiAITool |
| `wasiai_langchain/toolkit.py` | WasiAIToolkit |
| `wasiai_langchain/errors.py` | Errores tipados |
| `tests/test_tool.py` | Tests unitarios con mock |
| `pyproject.toml` | Config del paquete, dep: `wasiai>=0.1.0`, `langchain-core>=0.1.0` |
| `README.md` | Ejemplos copy-paste JS y Python |

---

## Constraint Directives

### REQUIRED
- Extender `StructuredTool` (JS) y `BaseTool` (Python) — compatibilidad LangChain nativa
- Errores tipados — nunca `throw new Error('string')`
- `baseUrl` configurable — nunca hardcodear `wasiai-v2.vercel.app`
- Versión LangChain JS: `@langchain/core>=0.2.0` | Python: `langchain-core>=0.1.0`
- `@wasiai/sdk@0.2.0` — bump minor (nuevo export, no breaking)

### FORBIDDEN
- Modificar `wasiai-v2` — cliente externo únicamente
- Duplicar lógica HTTP en Python — usar `wasiai@0.1.0` como dependencia base
- Hardcodear la URL base del API

---

## Waves

### W0 — Serial
1. Crear estructura de carpetas en `wasiai-sdk/src/langchain/`
2. Implementar `errors.ts`
3. Crear repo `wasiai-langchain` con `pyproject.toml`

### W1 — Paralelo
4. JS: `WasiAITool` + `WasiAIToolkit` + `index.ts`
5. Python: `tool.py` + `toolkit.py` + `errors.py`

### W2 — Serial
6. Tests JS + Python
7. `package.json` bump 0.2.0 + export `./langchain`
8. `npm publish` → `@wasiai/sdk@0.2.0`
9. `python -m build && twine upload` → `wasiai-langchain@0.1.0`

---

## Scope OUT
- LlamaIndex plugin (WAS-41)
- Streaming de resultados
- LangGraph support

---

## Escalation Rule
Si algo no está especificado en este archivo → DETENER y preguntar al Architect. No asumir.
