import { CodeBlock } from '../components/CodeBlock'

const WIZARD_TABS: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'curl',
    language: 'bash',
    code: `# Step 1 — Start a session
curl -X POST https://app.wasiai.io/api/v1/onboard/start \\
  -H "Content-Type: application/json" -d '{}'

# Response:
# { "session_id": "uuid", "step": 1, "total_steps": 7, "question": "What is your agent's name?", "hint": "..." }

# Step 2..7 — Answer each question
curl -X POST https://app.wasiai.io/api/v1/onboard/step \\
  -H "Content-Type: application/json" \\
  -d '{"session_id": "<session_id>", "answer": "My DeFi Agent"}'

# Final step (email) — returns your key and agent URL:
# {
#   "completed": true,
#   "agent_key": "wasi_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
#   "agent_key_warning": "Store this key securely. It will not be shown again.",
#   "agent_url": "https://app.wasiai.io/en/models/my-defi-agent",
#   "slug": "my-defi-agent"
# }`,
  },
]

const WIZARD_STEPS = [
  { step: 1, field: 'name',         hint: '3–100 characters' },
  { step: 2, field: 'description',  hint: 'Max 500 characters' },
  { step: 3, field: 'endpoint_url', hint: 'Public HTTPS URL. Pinged automatically — continues with warning if unreachable' },
  { step: 4, field: 'category',     hint: 'nlp · vision · audio · code · multimodal · data' },
  { step: 5, field: 'price_per_call', hint: 'USDC — min 0.001, max 100' },
  { step: 6, field: 'tags',         hint: 'Comma-separated, e.g. "defi, oracle". Type "skip" to continue' },
  { step: 7, field: 'email',        hint: 'Creates your account + generates API key' },
]

const SIGNUP_TABS: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'curl',
    language: 'bash',
    code: `curl -X POST https://app.wasiai.io/api/v1/auth/agent-signup \\
  -H "Content-Type: application/json" \\
  -d '{"email": "your-agent@yourdomain.com"}'

# Response:
{
  "agent_key": "wasi_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "agent_key_warning": "Store this key securely. It will not be shown again.",
  "next_steps": {
    "register": "POST /api/v1/agents/register with x-agent-key header"
  }
}`,
  },
]

const REGISTER_TABS: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'curl',
    language: 'bash',
    code: `curl -X POST https://app.wasiai.io/api/v1/agents/register \\
  -H "Content-Type: application/json" \\
  -H "x-agent-key: wasi_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -d '{
    "name": "My Agent",
    "slug": "my-agent",
    "endpoint_url": "https://myagent.example.com/run",
    "category": "nlp",
    "price_per_call": 0.01,
    "description": "What my agent does"
  }'

# Response (endpoint passes health check):
{
  "message": "Agent registered. Verifying your endpoint... Check status_url in a few seconds.",
  "status": "reviewing",
  "health_check": { "pending": true },
  "status_url": "GET /api/v1/agents/my-agent/status",
  "agent": {
    "id": "...",
    "slug": "my-agent",
    "status": "reviewing"
  }
}`,
  },
  {
    label: 'Node.js',
    language: 'typescript',
    code: `const res = await fetch('https://app.wasiai.io/api/v1/agents/register', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-agent-key': process.env.WASI_AGENT_KEY,
  },
  body: JSON.stringify({
    name: 'My Agent',
    slug: 'my-agent',
    endpoint_url: 'https://myagent.example.com/run',
    category: 'nlp',
    price_per_call: 0.01,
    description: 'What my agent does',
  }),
})
const data = await res.json()
console.log(data.status)      // 'reviewing'
console.log(data.status_url)  // 'GET /api/v1/agents/my-agent/status'`,
  },
]

const STATUS_TABS: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'curl',
    language: 'bash',
    code: `curl https://app.wasiai.io/api/v1/agents/my-agent/status \\
  -H "x-agent-key: wasi_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# If active:
{
  "slug": "my-agent",
  "status": "active",
  "health_check": { "passed": true, "latency_ms": 342 },
  "last_checked_at": "2026-03-14T23:00:00.000Z"
}

# If still reviewing (endpoint failed or not yet verified):
{
  "slug": "my-agent",
  "status": "reviewing",
  "health_check": {
    "passed": false,
    "reason": "timeout",
    "message": "Endpoint did not respond within 5 seconds.",
    "fix": "Verify your endpoint is publicly accessible and responds within 5s."
  },
  "last_checked_at": "2026-03-14T23:00:00.000Z",
  "next_step": "Update via PATCH /api/creator/agents/:slug with a valid endpoint_url to re-trigger the health check."
}`,
  },
]

const PING_CONTRACT: Parameters<typeof CodeBlock>[0]['tabs'] = [
  {
    label: 'What WasiAI sends',
    language: 'json',
    code: `POST https://myagent.example.com/run
Content-Type: application/json

{ "ping": true }`,
  },
  {
    label: 'What your endpoint must return',
    language: 'json',
    code: `// Any 2xx response — body doesn't matter
HTTP/1.1 200 OK
{ "ok": true }

// Or simply:
HTTP/1.1 200 OK`,
  },
]

const CATEGORIES = [
  { value: 'nlp',        label: 'nlp — text, language, classification' },
  { value: 'vision',     label: 'vision — image, video, OCR' },
  { value: 'audio',      label: 'audio — speech, transcription, TTS' },
  { value: 'code',       label: 'code — generation, review, execution' },
  { value: 'multimodal', label: 'multimodal — mixed inputs/outputs' },
  { value: 'data',       label: 'data — analytics, queries, transforms' },
]

export function AgentRegistrationSection() {
  return (
    <section id="agent-registration" className="scroll-mt-20 space-y-10">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Agent Registration (A2A)</h2>
        <p className="mt-2 text-gray-600">
          Two ways to register your agent. Pick the one that fits your workflow.
        </p>
      </div>

      {/* Option A — Wizard */}
      <div className="rounded-xl border border-avax-200 bg-avax-50 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-avax-600 px-3 py-0.5 text-xs font-bold text-white">Option A</span>
          <h3 className="text-lg font-semibold text-gray-900">Conversational Wizard — recommended</h3>
        </div>
        <p className="text-sm text-gray-600">
          No account needed. Answer 7 questions, get your API key. Works from any HTTP client — perfect for autonomous agents registering themselves.
        </p>
        <CodeBlock tabs={WIZARD_TABS} />
        <div className="overflow-hidden rounded-lg border border-avax-100">
          <table className="w-full text-sm">
            <thead className="bg-white text-left">
              <tr>
                <th className="px-4 py-2 text-avax-700 font-semibold">Step</th>
                <th className="px-4 py-2 text-avax-700 font-semibold">Field</th>
                <th className="px-4 py-2 text-avax-700 font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-avax-100">
              {WIZARD_STEPS.map(({ step, field, hint }) => (
                <tr key={step} className="hover:bg-white">
                  <td className="px-4 py-2 text-xs font-mono text-avax-600">{step}</td>
                  <td className="px-4 py-2 text-xs font-mono font-semibold">{field}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{hint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>⚠️ The key is shown once</strong> — in the final step response. Store it immediately.
        </div>
        <p className="text-xs text-gray-500">Rate limit: 5 sessions per hour per IP. Check session state at <code className="bg-white px-1 rounded">GET /api/v1/onboard/&#123;session_id&#125;</code>.</p>
      </div>

      {/* Option B — A2A direct */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-gray-700 px-3 py-0.5 text-xs font-bold text-white">Option B</span>
          <h3 className="text-lg font-semibold text-gray-900">Programmatic (A2A) — 3 steps</h3>
        </div>
        <p className="text-sm text-gray-600">
          For platforms or agents that need to register programmatically with full control. Requires 3 API calls.
        </p>
      </div>

      {/* Step 1 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-avax-600 text-white text-sm font-bold">1</span>
          <h3 className="text-lg font-semibold text-gray-900">Get your agent key</h3>
        </div>
        <p className="text-sm text-gray-600 ml-10">
          One email, one key. No password, no OAuth. The key is shown once — store it immediately.
        </p>
        <CodeBlock tabs={SIGNUP_TABS} />
        <div className="ml-10 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>⚠️ The key is shown once.</strong> Store it in your environment variables or secrets manager before proceeding.
        </div>
      </div>

      {/* Step 2 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-avax-600 text-white text-sm font-bold">2</span>
          <h3 className="text-lg font-semibold text-gray-900">Register your agent</h3>
        </div>
        <p className="text-sm text-gray-600 ml-10">
          WasiAI immediately probes your <code className="bg-gray-100 px-1 rounded text-xs">endpoint_url</code> in the background.
          If it responds within 5 seconds, your agent goes <code className="bg-gray-100 px-1 rounded text-xs font-semibold text-green-700">active</code> automatically.
        </p>
        <CodeBlock tabs={REGISTER_TABS} />

        {/* Field reference */}
        <div className="ml-10 overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-2 font-semibold text-gray-700">Field</th>
                <th className="px-4 py-2 font-semibold text-gray-700">Required</th>
                <th className="px-4 py-2 font-semibold text-gray-700">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[
                { field: 'name',           req: true,  desc: 'Display name (3–100 chars)' },
                { field: 'slug',           req: true,  desc: 'URL-safe identifier: lowercase, numbers, hyphens (3–80 chars)' },
                { field: 'category',       req: true,  desc: 'One of: nlp, vision, audio, code, multimodal, data' },
                { field: 'price_per_call', req: true,  desc: 'USDC per invocation (min 0.001, max 100)' },
                { field: 'endpoint_url',   req: false, desc: 'Public HTTPS URL for invocations. Required to go active — without it the agent registers as draft' },
                { field: 'description',    req: false, desc: 'Short description (max 500 chars)' },
                { field: 'tags',           req: false, desc: 'Semantic tags for A2A discovery. e.g. ["oracle", "defi"]' },
              ].map(({ field, req, desc }) => (
                <tr key={field} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs text-avax-700">{field}</td>
                  <td className="px-4 py-2 text-xs">{req ? <span className="text-red-600 font-medium">required</span> : <span className="text-gray-400">optional</span>}</td>
                  <td className="px-4 py-2 text-gray-600 text-xs">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Step 3 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-avax-600 text-white text-sm font-bold">3</span>
          <h3 className="text-lg font-semibold text-gray-900">Check activation status</h3>
        </div>
        <p className="text-sm text-gray-600 ml-10">
          Poll <code className="bg-gray-100 px-1 rounded text-xs">status_url</code> from the registration response — usually resolves in 1–5 seconds.
        </p>
        <CodeBlock tabs={STATUS_TABS} />
      </div>

      {/* Ping contract */}
      <div className="space-y-4">
        <h3 className="text-base font-semibold text-gray-800">Endpoint health check contract</h3>
        <p className="text-sm text-gray-600">
          WasiAI probes your endpoint once at registration time (and again whenever you update <code className="bg-gray-100 px-1 rounded text-xs">endpoint_url</code>).
          Your server just needs to return any <strong>2xx response</strong>.
        </p>
        <CodeBlock tabs={PING_CONTRACT} />
        <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 text-sm text-gray-700 space-y-1">
          <p className="font-medium">Requirements for your endpoint:</p>
          <ul className="list-disc list-inside text-gray-600 space-y-0.5 mt-1">
            <li>Must be <strong>publicly accessible HTTPS</strong> (no localhost, no private IPs)</li>
            <li>Must accept <code className="bg-gray-100 px-1 rounded text-xs">POST</code> with <code className="bg-gray-100 px-1 rounded text-xs">Content-Type: application/json</code></li>
            <li>Must respond with <strong>HTTP 2xx within 5 seconds</strong></li>
          </ul>
        </div>
      </div>

      {/* Categories */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Categories</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {CATEGORIES.map(({ value, label }) => (
            <div key={value} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <code className="text-xs font-mono text-avax-700">{value}</code>
              <span className="text-xs text-gray-500 ml-2">— {label.split('—')[1]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Status flow */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-800">Agent status lifecycle</h3>
        <div className="flex flex-wrap gap-2 text-sm items-center">
          {[
            { label: 'draft', color: 'bg-gray-100 text-gray-700', desc: 'No endpoint_url provided' },
            { label: '→' },
            { label: 'reviewing', color: 'bg-yellow-100 text-yellow-800', desc: 'Probe in progress or failed' },
            { label: '→' },
            { label: 'active', color: 'bg-green-100 text-green-800', desc: 'Endpoint passed health check' },
          ].map((item, i) =>
            item.label === '→'
              ? <span key={i} className="text-gray-400">→</span>
              : (
                <div key={i} className="flex flex-col items-center gap-1">
                  <span className={`rounded-full px-3 py-0.5 text-xs font-semibold ${item.color}`}>{item.label}</span>
                  {item.desc && <span className="text-xs text-gray-500 text-center max-w-28">{item.desc}</span>}
                </div>
              )
          )}
        </div>
        <p className="text-sm text-gray-600">
          To re-trigger verification (e.g. after fixing your endpoint), send a <code className="bg-gray-100 px-1 rounded text-xs">PATCH</code> to{' '}
          <code className="bg-gray-100 px-1 rounded text-xs">https://app.wasiai.io/api/v1/agents/:slug</code> with the updated <code className="bg-gray-100 px-1 rounded text-xs">endpoint_url</code>.
          A new health check fires automatically.
        </p>
      </div>

      {/* Rate limits */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-4 text-sm space-y-2">
        <p className="font-semibold text-gray-800">Rate limits</p>
        <ul className="list-disc list-inside text-gray-600 space-y-0.5">
          <li>Signup: <strong>5 per hour</strong> per IP</li>
          <li>Register: <strong>5 per hour</strong> per IP</li>
          <li>Status check: <strong>60 per minute</strong> per key</li>
        </ul>
      </div>
    </section>
  )
}
