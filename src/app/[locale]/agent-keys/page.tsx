'use client'

import { useState, useEffect, useCallback } from 'react'

interface AgentKey {
  id: string
  name: string
  budget_usdc: number
  spent_usdc: number
  is_active: boolean
  last_used_at: string | null
  created_at: string
  raw_key?: string
}

export default function AgentKeysPage() {
  const [keys, setKeys] = useState<AgentKey[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newKey, setNewKey] = useState<AgentKey | null>(null)
  const [form, setForm] = useState({ name: '', budget_usdc: 10 })
  const [showForm, setShowForm] = useState(false)
  const [copied, setCopied] = useState(false)

  const loadKeys = useCallback(() => {
    fetch('/api/agent-keys')
      .then(res => res.ok ? res.json() : [])
      .then(data => { setKeys(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { loadKeys() }, [loadKeys])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    const res = await fetch('/api/agent-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (res.ok) {
      const created = await res.json()
      setNewKey(created)
      setShowForm(false)
      loadKeys()
    }
    setCreating(false)
  }

  // T-05: Wrapped in try/catch to surface errors instead of silently failing
  async function handleRevoke(id: string) {
    try {
      const res = await fetch('/api/agent-keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        console.error('[handleRevoke] failed:', data)
      }
    } catch (err) {
      console.error('[handleRevoke] network error:', err)
    } finally {
      loadKeys()
    }
  }

  function copyKey(key: string) {
    navigator.clipboard.writeText(key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Agent Keys</h1>
            <p className="mt-1 text-sm text-gray-500">
              API keys for your AI agents to call WasiAI models autonomously.
            </p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="rounded-xl bg-avax-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-avax-600 transition"
          >
            + New Key
          </button>
        </div>

        {/* New key revealed */}
        {newKey?.raw_key && (
          <div className="mb-6 rounded-2xl border border-green-200 bg-green-50 p-5">
            <div className="flex items-start gap-3">
              <span className="text-2xl">🔑</span>
              <div className="flex-1">
                <p className="font-semibold text-green-800">Key created — save it now!</p>
                <p className="text-sm text-green-600">This key will never be shown again.</p>
                <div className="mt-3 flex items-center gap-2">
                  <code className="flex-1 rounded-lg bg-white border border-green-200 px-3 py-2 text-sm font-mono text-gray-800 break-all">
                    {newKey.raw_key}
                  </code>
                  <button
                    onClick={() => copyKey(newKey.raw_key!)}
                    className="shrink-0 rounded-lg bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700"
                  >
                    {copied ? '✓' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>
            <button onClick={() => setNewKey(null)} className="mt-3 text-xs text-green-600 hover:underline">
              I saved it, dismiss
            </button>
          </div>
        )}

        {/* Create form */}
        {showForm && (
          <div className="mb-6 rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
            <h2 className="mb-4 font-semibold text-gray-900">New Agent Key</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Key Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="My trading agent"
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Budget (USDC) <span className="text-gray-400">— agent stops when exhausted</span>
                </label>
                <input
                  type="number"
                  value={form.budget_usdc}
                  onChange={e => setForm(p => ({ ...p, budget_usdc: parseFloat(e.target.value) }))}
                  min={1}
                  step={1}
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-xl bg-avax-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-avax-600 disabled:opacity-50"
                >
                  {creating ? 'Creating...' : 'Create Key'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Keys list */}
        <div className="rounded-2xl bg-white shadow-sm border border-gray-100">
          {loading ? (
            <div className="py-12 text-center text-gray-400">Loading...</div>
          ) : keys.length === 0 ? (
            <div className="py-12 text-center">
              <div className="text-4xl mb-3">🤖</div>
              <p className="text-gray-500 text-sm">No agent keys yet</p>
              <button
                onClick={() => setShowForm(true)}
                className="mt-4 rounded-xl bg-avax-500 px-4 py-2 text-sm font-semibold text-white hover:bg-avax-600"
              >
                Create your first key
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {keys.map(key => (
                <div key={key.id} className="flex items-center gap-4 px-6 py-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{key.name}</span>
                      {!key.is_active && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-600">Revoked</span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                      <span>Budget: <strong className="text-gray-600">${key.budget_usdc} USDC</strong></span>
                      <span>Spent: <strong className="text-gray-600">${key.spent_usdc.toFixed(3)}</strong></span>
                      {key.last_used_at && (
                        <span>Last used: {new Date(key.last_used_at).toLocaleDateString('en-US')}</span>
                      )}
                    </div>
                    {/* Budget bar */}
                    <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100">
                      <div
                        className="h-1.5 rounded-full bg-avax-400"
                        style={{ width: `${Math.min((key.spent_usdc / key.budget_usdc) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                  {key.is_active && (
                    <button
                      onClick={() => handleRevoke(key.id)}
                      className="shrink-0 rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 transition"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Usage example */}
        <div className="mt-6 rounded-2xl bg-gray-900 p-5 text-white">
          <p className="mb-3 text-sm font-semibold text-gray-300">Usage in your agent:</p>
          <pre className="overflow-auto text-sm text-green-400">{`POST /api/v1/models/gpt-translator/invoke
x-agent-key: wasi_your_key_here
Content-Type: application/json

{ "input": "Translate: Hello world" }`}</pre>
        </div>
      </div>
    </main>
  )
}
