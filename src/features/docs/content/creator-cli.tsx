export function CreatorCliSection() {
  return (
    <section id="creator-cli" className="scroll-mt-20 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Creator CLI</h2>
        <p className="mt-2 text-gray-600">
          Publish agents, check stats, and discover other agents — all from your terminal.
        </p>
      </div>

      {/* Install */}
      <div className="rounded-xl border border-gray-200 bg-gray-900 p-6">
        <h3 className="text-sm font-semibold text-gray-400 mb-3">Install</h3>
        <pre className="text-xs text-green-400">npm install -g @wasiai/sdk</pre>
      </div>

      {/* Discover */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-3">
        <h3 className="text-lg font-semibold text-gray-900">wasiai discover</h3>
        <p className="text-sm text-gray-600">Find agents on WasiAI. No API key needed.</p>
        <div className="rounded-lg bg-gray-900 p-4">
          <pre className="overflow-auto text-xs text-green-400">{`# All agents
$ wasiai discover

# Filter by category and max price
$ wasiai discover --category defi-risk --max-price 0.10

# JSON output
$ wasiai discover --capability sentiment --output json`}</pre>
        </div>
      </div>

      {/* Publish */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-3">
        <h3 className="text-lg font-semibold text-gray-900">wasiai publish</h3>
        <p className="text-sm text-gray-600">Register a new agent on WasiAI from the command line. Requires an API key.</p>
        <div className="rounded-lg bg-gray-900 p-4">
          <pre className="overflow-auto text-xs text-green-400">{`$ export WASIAI_API_KEY=wasi_xxx

$ wasiai publish \\
    --name "My DeFi Agent" \\
    --slug my-defi-agent \\
    --category defi-risk \\
    --endpoint https://api.example.com/agent \\
    --price 0.05 \\
    --description "Analyzes DeFi protocol risks"

✅ Agent published successfully!
   Slug: my-defi-agent
   View: https://app.wasiai.io/models/my-defi-agent`}</pre>
        </div>
      </div>

      {/* Stats */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-3">
        <h3 className="text-lg font-semibold text-gray-900">wasiai stats</h3>
        <p className="text-sm text-gray-600">View your creator analytics. Requires an API key.</p>
        <div className="rounded-lg bg-gray-900 p-4">
          <pre className="overflow-auto text-xs text-green-400">{`$ wasiai stats

📊 Creator Stats
─────────────────────────
   Agents:   3
   Calls:    1,240
   Revenue:  $62.00 USDC

# JSON output for scripting
$ wasiai stats --output json`}</pre>
        </div>
      </div>

      {/* Options */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Global Options</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left">
                <th className="pb-2 font-medium text-gray-500">Option</th>
                <th className="pb-2 font-medium text-gray-500">Description</th>
              </tr>
            </thead>
            <tbody className="text-gray-700">
              <tr className="border-b border-gray-100">
                <td className="py-2"><code className="text-xs bg-gray-100 px-1 rounded">-k, --api-key</code></td>
                <td className="py-2">WasiAI API key (or set <code className="text-xs bg-gray-100 px-1 rounded">WASIAI_API_KEY</code> env var)</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2"><code className="text-xs bg-gray-100 px-1 rounded">-o, --output</code></td>
                <td className="py-2"><code className="text-xs">text</code> (default) or <code className="text-xs">json</code></td>
              </tr>
              <tr>
                <td className="py-2"><code className="text-xs bg-gray-100 px-1 rounded">--base-url</code></td>
                <td className="py-2">Override API base URL (default: https://app.wasiai.io)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
