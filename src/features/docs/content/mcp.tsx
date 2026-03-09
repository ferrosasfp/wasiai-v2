import Link from 'next/link'
import { CodeBlock } from '../components/CodeBlock'

const CLAUDE_DESKTOP_CONFIG: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'claude_desktop_config.json',
    language: 'json',
    code: `{
  "mcpServers": {
    "wasiai": {
      "url": "https://app.wasiai.io/api/v1/mcp?key=wai_YOUR_KEY"
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
      "url": "https://app.wasiai.io/api/v1/mcp?key=wai_YOUR_KEY"
    }
  }
}`,
  },
]

const VERIFY_CONFIG: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'Verificar conexión',
    language: 'bash',
    code: `curl https://app.wasiai.io/api/v1/mcp
# Respuesta: server info + lista de tools disponibles (agentes activos)`,
  },
]

const EXAMPLE_PROMPT: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'Prompt de ejemplo',
    language: 'bash',
    code: `# En Claude Desktop o Cursor, escribe:
Usa el agente wasi-defi-sentiment de WasiAI para analizar este token DeFi:
"{\\"token_name\\":\\"SMEG\\",\\"token_symbol\\":\\"SMEG\\",\\"description\\":\\"100x guaranteed returns!\\"}"`,
  },
]

const TOOLS_CALL_BODY: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'tools/call — body',
    language: 'json',
    code: `{
  "method": "tools/call",
  "params": {
    "name": "wasiai_wasi_defi_sentiment",
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
  "content": [{ "type": "text", "text": "{\"sentiment_score\":92,\"flags\":[\"FOMO naming\"],\"analysis\":\"High-risk token.\"}" }],
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
          <Link href="/en/agent-keys" className="text-avax-600 hover:underline font-medium">
            app.wasiai.io/en/agent-keys
          </Link>{' '}
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
          Replace <code className="text-xs bg-gray-100 rounded px-1 py-0.5">wai_YOUR_KEY</code> with
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
          <span className="text-xs bg-gray-100 rounded px-1 py-0.5">⚙</span>) in the
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
          <li>Claude/Cursor detects the tool <code className="text-xs bg-gray-100 rounded px-1 py-0.5">wasiai_wasi_defi_sentiment</code></li>
          <li>Calls <code className="text-xs bg-gray-100 rounded px-1 py-0.5">POST /api/v1/mcp?key=wasi_...</code> with <code className="text-xs bg-gray-100 rounded px-1 py-0.5">method: tools/call</code></li>
          <li>WasiAI calls the agent endpoint and deducts USDC from your budget</li>
          <li>Returns the agent response + metadata (charged amount, remaining budget)</li>
        </ol>
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          💳 <strong>Payments are automatic.</strong> Each successful agent call deducts{' '}
          <code className="text-xs bg-amber-100 rounded px-1 py-0.5">price_per_call</code> USDC from
          your Agent Key budget. Monitor your balance at{' '}
          <Link href="/en/agent-keys" className="font-medium underline">
            agent-keys
          </Link>
          .
        </div>
      </div>

      {/* Technical reference */}
      <div className="space-y-5">
        <h3 className="text-base font-semibold text-gray-800">Technical Reference</h3>

        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">MCP Server URL</p>
          <p className="text-sm font-mono bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-gray-800 select-all">
            https://app.wasiai.io/api/v1/mcp
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
