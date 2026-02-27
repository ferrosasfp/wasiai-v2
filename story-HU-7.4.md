# Story HU-7.4 — Documentación MCP para Claude Desktop y Cursor

**Epic:** E7 — Integraciones con Ecosistema AI  
**Sprint:** 5 | **Estimado:** 0.5–1 día | **Prioridad:** P1  
**Preparado por:** SM (San) — 2026-02-26  
**Estado:** READY_FOR_DEV

---

## Historia de Usuario

Como developer que usa Claude Desktop o Cursor,  
quiero una guía paso a paso para conectar WasiAI como MCP server en mi herramienta,  
para poder invocar agentes del marketplace directamente desde mi editor o asistente de IA.

---

## Contexto

WasiAI ya tiene un MCP server HTTP funcional en `src/app/api/v1/mcp/route.ts` con:
- `GET /api/v1/mcp` → server info + lista de tools (no requiere auth)
- `POST /api/v1/mcp` → ejecuta tools con auth via `?key=wasi_YOUR_KEY`
- Tools naming: `wasiai_{slug_con_guiones_reemplazados_por_underscore}`

Falta la documentación visible en el sitio. Esta HU la agrega como una nueva sección en la página `/[locale]/docs` existente, siguiendo el patrón de secciones ya establecido (mismo layout, mismo sidebar scroll-spy, mismo CodeBlock component).

**Decisión arquitectónica clave:** Se agrega como sección en `/docs`, NO como ruta separada `/docs/mcp`. Motivo: cero cambio de estructura de rutas, patrón consistente con `sdk-node`, `sdk-python`, `api-reference`, etc.

---

## Criterios de Aceptación (verificables)

### AC1 — Sección MCP visible en `/en/docs`
- [ ] La sección "MCP Integration" aparece en la página `/en/docs` entre `<ApiReferenceSection />` y `<ErrorsSection />`
- [ ] Tiene `id="mcp-integration"` en el `<section>` (consistente con el patrón `id="sdk-node"`, etc.)
- [ ] El sidebar muestra la entrada "MCP Integration" y se activa con scroll-spy al llegar a esa sección

### AC2 — Guía Claude Desktop
- [ ] Sección con pasos numerados (1–4) para configurar Claude Desktop
- [ ] CodeBlock copiable con JSON de `claude_desktop_config.json` que usa `"url":` (HTTP-based, sin `command`/`args`)
- [ ] El JSON contiene `wasi_YOUR_KEY` como placeholder (nunca un valor real)
- [ ] Se mencionan paths: Mac (`~/Library/Application Support/Claude/claude_desktop_config.json`) y Windows (`%APPDATA%\Claude\claude_desktop_config.json`)

### AC3 — Guía Cursor
- [ ] Sección con pasos para configurar `.cursor/mcp.json`
- [ ] CodeBlock copiable con JSON de configuración para Cursor
- [ ] Nota de compatibilidad: "Cursor 0.43+"

### AC4 — Ejemplo real de invocación
- [ ] Prompt de ejemplo usando un agente disponible
- [ ] Explicación del flujo: tool call → pago USDC → respuesta
- [ ] Mención de `_meta.charged` en la respuesta del MCP server

### AC5 — Referencia técnica
- [ ] URL del server documentada: `https://wasiai-v2.vercel.app/api/v1/mcp`
- [ ] Tabla o lista de métodos: `tools/list`, `tools/call`, `resources/read`
- [ ] Schema de `tools/call` con `name` (string) y `arguments.input` (string, requerido)
- [ ] Nota sobre pagos: cada `tools/call` exitoso descuenta `price_per_call` USDC del budget de la agent key
- [ ] Link a `/en/agent-keys` para obtener la key

### AC6 — Formato y accesibilidad
- [ ] Syntax highlighting en bloques JSON (`language: 'json'`)
- [ ] Botón Copy funcional en cada CodeBlock (heredado del componente existente)
- [ ] Keys i18n `docs.mcpIntegration` presentes en `messages/en.json` y `messages/es.json`
- [ ] Build de Next.js sin errores (`npm run build`)

---

## Archivos a Crear / Modificar

### 1. CREAR: `src/features/docs/content/mcp.tsx`

```tsx
import { CodeBlock } from '../components/CodeBlock'

const CLAUDE_DESKTOP_CONFIG: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'claude_desktop_config.json',
    language: 'json',
    code: `{
  "mcpServers": {
    "wasiai": {
      "url": "https://wasiai-v2.vercel.app/api/v1/mcp?key=wasi_YOUR_KEY"
    }
  }
}`,
  },
]

const CURSOR_CONFIG: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: '.cursor/mcp.json',
    language: 'json',
    code: `{
  "mcpServers": {
    "wasiai": {
      "url": "https://wasiai-v2.vercel.app/api/v1/mcp?key=wasi_YOUR_KEY"
    }
  }
}`,
  },
]

const VERIFY_CONFIG: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'Verificar conexión',
    language: 'bash',
    code: `curl https://wasiai-v2.vercel.app/api/v1/mcp
# Respuesta: server info + lista de tools disponibles (agentes activos)`,
  },
]

const EXAMPLE_PROMPT: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'Prompt de ejemplo',
    language: 'bash',
    code: `# En Claude Desktop o Cursor, escribe:
Usa el agente translator-es de WasiAI para traducir este texto al español:
"Artificial intelligence is transforming how developers build software."`,
  },
]

const TOOLS_CALL_BODY: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'tools/call — body',
    language: 'json',
    code: `{
  "method": "tools/call",
  "params": {
    "name": "wasiai_translator_es",
    "arguments": {
      "input": "Hello world",
      "options": {}
    }
  }
}`,
  },
]

const TOOLS_CALL_RESPONSE: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'Respuesta MCP',
    language: 'json',
    code: `{
  "content": [{ "type": "text", "text": "Hola mundo" }],
  "isError": false,
  "_meta": {
    "charged": 0.001,
    "currency": "USDC",
    "remaining_budget": 4.999,
    "latency_ms": 342
  }
}`,
  },
]

export function McpSection() {
  return (
    <section id="mcp-integration" className="scroll-mt-20 space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">MCP Integration</h2>
        <p className="mt-2 text-gray-600">
          WasiAI implements the{' '}
          <a
            href="https://modelcontextprotocol.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-avax-600 hover:underline"
          >
            Model Context Protocol (MCP)
          </a>
          , the open standard that Claude Desktop, Cursor, and dozens of AI tools are adopting.
          Connect your editor to the WasiAI marketplace and invoke any agent directly from your workflow.
        </p>
      </div>

      {/* Step 1 — Get an Agent Key */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">
          Step 1 — Get an Agent Key
        </h3>
        <p className="text-sm text-gray-600">
          Go to{' '}
          <a href="/en/agent-keys" className="text-avax-600 hover:underline font-medium">
            wasiai-v2.vercel.app/en/agent-keys
          </a>{' '}
          and create an Agent Key. Fund it with USDC — each agent invocation will automatically
          deduct <code className="text-xs bg-gray-100 rounded px-1 py-0.5">price_per_call</code> USDC
          from your key&apos;s budget.
        </p>
        <p className="text-sm text-gray-500">
          Your key will look like: <code className="text-xs bg-gray-100 rounded px-1 py-0.5">wasi_xxxxxxxxxxxx</code>
        </p>
      </div>

      {/* Step 2 — Claude Desktop */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">
          Step 2 — Configure Claude Desktop
        </h3>
        <p className="text-sm text-gray-600">
          Open your Claude Desktop configuration file and add the WasiAI MCP server:
        </p>
        <ul className="text-sm text-gray-500 list-disc list-inside space-y-1">
          <li>
            <strong>Mac:</strong>{' '}
            <code className="text-xs bg-gray-100 rounded px-1 py-0.5">
              ~/Library/Application Support/Claude/claude_desktop_config.json
            </code>
          </li>
          <li>
            <strong>Windows:</strong>{' '}
            <code className="text-xs bg-gray-100 rounded px-1 py-0.5">
              %APPDATA%\Claude\claude_desktop_config.json
            </code>
          </li>
        </ul>
        <CodeBlock tabs={CLAUDE_DESKTOP_CONFIG} />
        <p className="text-sm text-gray-500">
          Replace <code className="text-xs bg-gray-100 rounded px-1 py-0.5">wasi_YOUR_KEY</code> with
          your actual Agent Key. Restart Claude Desktop after saving.
        </p>
      </div>

      {/* Step 3 — Cursor */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">
          Step 3 — Configure Cursor
        </h3>
        <p className="text-sm text-gray-600">
          Create or edit <code className="text-xs bg-gray-100 rounded px-1 py-0.5">.cursor/mcp.json</code> in
          your project root (or <code className="text-xs bg-gray-100 rounded px-1 py-0.5">~/.cursor/mcp.json</code> for global config):
        </p>
        <CodeBlock tabs={CURSOR_CONFIG} />
        <p className="text-sm text-gray-500">
          Requires Cursor 0.43+. Check{' '}
          <a
            href="https://docs.cursor.com/context/model-context-protocol"
            target="_blank"
            rel="noopener noreferrer"
            className="text-avax-600 hover:underline"
          >
            Cursor MCP docs
          </a>{' '}
          for the latest config format.
        </p>
      </div>

      {/* Step 4 — Verify */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">
          Step 4 — Verify the connection
        </h3>
        <p className="text-sm text-gray-600">
          You can verify the MCP server is reachable before configuring your client:
        </p>
        <CodeBlock tabs={VERIFY_CONFIG} />
        <p className="text-sm text-gray-600">
          In Claude Desktop: look for the MCP tools icon (
          <span className="text-xs bg-gray-100 rounded px-1 py-0.5">🔧</span>) in the
          composer — WasiAI agents will appear as available tools. In Cursor: open the MCP panel in
          Settings to confirm the server is connected.
        </p>
      </div>

      {/* Example invocation */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">
          Example — Invoke an agent
        </h3>
        <p className="text-sm text-gray-600">
          Once connected, you can use any WasiAI agent naturally in your prompts:
        </p>
        <CodeBlock tabs={EXAMPLE_PROMPT} />
        <p className="text-sm text-gray-600">
          What happens under the hood:
        </p>
        <ol className="text-sm text-gray-600 list-decimal list-inside space-y-1 pl-2">
          <li>Claude/Cursor detects the tool <code className="text-xs bg-gray-100 rounded px-1 py-0.5">wasiai_translator_es</code></li>
          <li>Calls <code className="text-xs bg-gray-100 rounded px-1 py-0.5">POST /api/v1/mcp?key=wasi_...</code> with <code className="text-xs bg-gray-100 rounded px-1 py-0.5">method: tools/call</code></li>
          <li>WasiAI calls the agent endpoint and deducts USDC from your budget</li>
          <li>Returns the agent response + metadata (charged amount, remaining budget)</li>
        </ol>
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          💳 <strong>Payments are automatic.</strong> Each successful agent call deducts{' '}
          <code className="text-xs bg-amber-100 rounded px-1 py-0.5">price_per_call</code> USDC from
          your Agent Key budget. Monitor your balance at{' '}
          <a href="/en/agent-keys" className="font-medium underline">
            agent-keys
          </a>
          .
        </div>
      </div>

      {/* Technical reference */}
      <div className="space-y-5">
        <h3 className="text-base font-semibold text-gray-800">Technical Reference</h3>

        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">MCP Server URL</p>
          <p className="text-sm font-mono bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-gray-800 select-all">
            https://wasiai-v2.vercel.app/api/v1/mcp
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">Available methods</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500 text-xs uppercase tracking-wider">
                  <th className="py-2 pr-4 font-semibold">Method</th>
                  <th className="py-2 pr-4 font-semibold">HTTP</th>
                  <th className="py-2 pr-4 font-semibold">Auth</th>
                  <th className="py-2 font-semibold">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                <tr>
                  <td className="py-2 pr-4 font-mono text-xs">GET /api/v1/mcp</td>
                  <td className="py-2 pr-4">GET</td>
                  <td className="py-2 pr-4 text-gray-400">No</td>
                  <td className="py-2">Server info + all active agents as tools</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-mono text-xs">tools/list</td>
                  <td className="py-2 pr-4">POST</td>
                  <td className="py-2 pr-4 text-gray-400">No</td>
                  <td className="py-2">List all active agents as MCP tools</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-mono text-xs">tools/call</td>
                  <td className="py-2 pr-4">POST</td>
                  <td className="py-2 pr-4 text-green-600 font-medium">?key=</td>
                  <td className="py-2">Call an agent — deducts USDC from key budget</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-mono text-xs">resources/read</td>
                  <td className="py-2 pr-4">POST</td>
                  <td className="py-2 pr-4 text-gray-400">No</td>
                  <td className="py-2">Full agent catalog as JSON at <code className="text-xs">wasiai://catalog</code></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-700">
            <code className="text-xs bg-gray-100 rounded px-1 py-0.5">tools/call</code> — request body
          </p>
          <CodeBlock tabs={TOOLS_CALL_BODY} />
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-700">
            <code className="text-xs bg-gray-100 rounded px-1 py-0.5">tools/call</code> — response
          </p>
          <CodeBlock tabs={TOOLS_CALL_RESPONSE} />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">Tool naming convention</p>
          <p className="text-sm text-gray-600">
            Each WasiAI agent is exposed as a tool with the prefix{' '}
            <code className="text-xs bg-gray-100 rounded px-1 py-0.5">wasiai_</code> and hyphens
            replaced by underscores. For example: agent slug{' '}
            <code className="text-xs bg-gray-100 rounded px-1 py-0.5">text-summarizer</code> →
            tool name <code className="text-xs bg-gray-100 rounded px-1 py-0.5">wasiai_text_summarizer</code>.
          </p>
        </div>
      </div>
    </section>
  )
}
```

---

### 2. MODIFICAR: `src/features/docs/components/DocsSidebar.tsx`

**Cambio exacto** — agregar entrada `mcp-integration` a `SECTION_KEYS` (entre `api-reference` y `errors`):

```diff
 const SECTION_KEYS = [
   { id: 'quickstart',    key: 'quickstart'  },
   { id: 'sdk-node',      key: 'sdkNode'     },
   { id: 'sdk-python',    key: 'sdkPython'   },
   { id: 'api-reference', key: 'apiRef'      },
+  { id: 'mcp-integration', key: 'mcpIntegration' },
   { id: 'errors',        key: 'errors'      },
 ] as const
```

---

### 3. MODIFICAR: `src/app/[locale]/docs/page.tsx`

**Cambio exacto** — agregar import y renderizado de `McpSection` entre `ApiReferenceSection` y `ErrorsSection`:

```diff
 import { getTranslations } from 'next-intl/server'
 import { QuickstartSection } from '@/features/docs/content/quickstart'
 import { SdkNodeSection } from '@/features/docs/content/sdk-node'
 import { SdkPythonSection } from '@/features/docs/content/sdk-python'
 import { ApiReferenceSection } from '@/features/docs/content/api-reference'
+import { McpSection } from '@/features/docs/content/mcp'
 import { ErrorsSection } from '@/features/docs/content/errors'
 
 // ... (generateMetadata sin cambios)
 
 export default function DocsPage() {
   return (
     <div className="space-y-16 pb-24">
       {/* ... secciones previas sin cambios ... */}
       <div className="border-t border-gray-100 pt-8">
         <ApiReferenceSection />
       </div>
+      <div className="border-t border-gray-100 pt-8">
+        <McpSection />
+      </div>
       <div className="border-t border-gray-100 pt-8">
         <ErrorsSection />
       </div>
     </div>
   )
 }
```

---

### 4. MODIFICAR: `messages/en.json`

Agregar key `mcpIntegration` dentro del namespace `docs`:

```diff
 "docs": {
   "title": "Documentation",
   "quickstart": "Quickstart",
   "sdkNode": "SDK Node.js",
   "sdkPython": "SDK Python",
   "apiRef": "API Reference",
+  "mcpIntegration": "MCP Integration",
   "errors": "Errors",
   ...
 }
```

---

### 5. MODIFICAR: `messages/es.json`

Agregar key `mcpIntegration` dentro del namespace `docs`:

```diff
 "docs": {
   "title": "Documentación",
   "quickstart": "Inicio rápido",
   "sdkNode": "SDK Node.js",
   "sdkPython": "SDK Python",
   "apiRef": "Referencia de API",
+  "mcpIntegration": "Integración MCP",
   "errors": "Errores",
   ...
 }
```

---

## Notas de Implementación para Dev

1. **`McpSection` no usa `'use client'`** — el componente `CodeBlock` sí lo usa internamente si necesita interactividad. Verificar si `sdk-node.tsx` lo importa (no lo tiene). Si `CodeBlock` necesita `'use client'`, agregar la directiva al componente `McpSection`.

2. **Agente de ejemplo:** El código usa `translator-es` como ejemplo. Antes de mergear, el Dev debe verificar qué slugs de agentes están activos con `GET /api/v1/mcp`. Si `translator-es` no existe, actualizar el ejemplo con un slug real.

3. **Placeholder de key:** Siempre usar `wasi_YOUR_KEY` — nunca valores reales en el código.

4. **Windows path:** Documentado como `%APPDATA%\Claude\claude_desktop_config.json`. Si se quiere más detalle: equivale a `C:\Users\<username>\AppData\Roaming\Claude\claude_desktop_config.json`.

5. **Cursor versión:** 0.43+ es la versión de referencia según el SDD. Verificar en [docs.cursor.com/context/model-context-protocol](https://docs.cursor.com/context/model-context-protocol) antes de publicar.

6. **TypeScript:** No usar `any`. El componente es puramente estático (no hay fetch, no hay estado, solo JSX + CodeBlock). Sin `as const` adicionales necesarios fuera del array de tabs.

7. **Formato `as const` de DocsSidebar:** El array usa `as const`, por lo que el tipo de `key` es un string literal. Al agregar `'mcpIntegration'`, TypeScript infiere el tipo correcto automáticamente.

---

## Definition of Done (DoD) Checklist

### Funcional
- [ ] Sección "MCP Integration" visible en `https://wasiai-v2.vercel.app/en/docs`
- [ ] Scroll-spy: al hacer scroll a la sección, la entrada "MCP Integration" se activa en el sidebar
- [ ] Click en "MCP Integration" en el sidebar hace scroll suave a la sección
- [ ] CodeBlock Claude Desktop: JSON válido, syntax highlighting, botón Copy funcional
- [ ] CodeBlock Cursor: JSON válido, syntax highlighting, botón Copy funcional
- [ ] CodeBlock verificación: bash, Copy funcional
- [ ] CodeBlock `tools/call` body y response: JSON, Copy funcional
- [ ] URL documentada `https://wasiai-v2.vercel.app/api/v1/mcp` responde GET (verificar en prod)
- [ ] La tabla de métodos es correcta: `tools/list`, `tools/call`, `resources/read`
- [ ] Link a `/en/agent-keys` funcional
- [ ] Link a `https://modelcontextprotocol.io` se abre en nueva pestaña
- [ ] Ejemplo de agente usa un slug real existente en producción

### Técnico
- [ ] `McpSection` no hace fetch — contenido 100% estático
- [ ] Sin `any` en el componente
- [ ] `npm run build` sin errores ni warnings nuevos
- [ ] Sin TypeScript errors (`tsc --noEmit`)
- [ ] Sidebar scroll-spy no se rompe con la nueva sección (observer sigue correcto)
- [ ] i18n: `docs.mcpIntegration` presente en `messages/en.json`
- [ ] i18n: `docs.mcpIntegration` presente en `messages/es.json`

### Calidad
- [ ] Copiar el JSON de Claude Desktop y pegarlo directamente en el archivo de config funciona sin modificaciones
- [ ] Copiar el JSON de Cursor y pegarlo directamente en el archivo de config funciona sin modificaciones
- [ ] La nota de pagos USDC está presente y es clara (warning box ámbar)
- [ ] El componente pasa revisión visual en mobile (overflow-x-auto en la tabla)
- [ ] No hay información sensible hardcodeada (keys, emails, wallets)

---

## Archivos Afectados (resumen ejecutivo)

| Archivo | Acción | Líneas estimadas |
|---------|--------|-----------------|
| `src/features/docs/content/mcp.tsx` | CREAR | ~220 |
| `src/features/docs/components/DocsSidebar.tsx` | +1 línea en `SECTION_KEYS` | +1 |
| `src/app/[locale]/docs/page.tsx` | +1 import + +3 líneas render | +4 |
| `messages/en.json` | +1 key en `docs` namespace | +1 |
| `messages/es.json` | +1 key en `docs` namespace | +1 |

**Total:** 1 archivo nuevo + 4 modificaciones menores. Sin nuevas dependencias. Sin nuevas rutas. Sin migraciones de DB.

---

*Story preparada por SM (San) | BMAD Method v6 | WasiAI Sprint 5*
