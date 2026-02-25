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

// USDC contract addresses by chain
const USDC_BY_CHAIN: Record<number, string> = {
  43114: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', // Avalanche mainnet
  43113: '0x5425890298aed601595a70AB815c96711a31Bc65', // Fuji testnet
}

// Marketplace contract address (recipient for ERC-3009 transfer)
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
const USDC_ADDRESS = USDC_BY_CHAIN[CHAIN_ID] ?? USDC_BY_CHAIN[43113]
const MARKETPLACE_ADDRESS = CHAIN_ID === 43114
  ? (process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET ?? '')
  : (process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI    ?? '')

// ── DepositModal ──────────────────────────────────────────────────────────────

interface DepositModalProps {
  keyId:   string
  keyName: string
  onClose: () => void
  onSuccess: () => void
}

function DepositModal({ keyId, keyName, onClose, onSuccess }: DepositModalProps) {
  const [amount, setAmount]     = useState(10)
  const [status, setStatus]     = useState<'idle' | 'signing' | 'submitting' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [txHash, setTxHash]     = useState('')
  const [balance, setBalance]   = useState<number | null>(null)

  // Load current on-chain balance
  useEffect(() => {
    fetch(`/api/agent-keys/${keyId}/balance`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setBalance(d.onChainBalance) })
      .catch(() => {})
  }, [keyId])

  async function handleDeposit() {
    setErrorMsg('')

    // 1. Check wallet availability
    const win = window as typeof window & { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }
    if (!win.ethereum) {
      setErrorMsg('No wallet detected. Please install Core Wallet or MetaMask.')
      return
    }

    try {
      setStatus('signing')

      // 2. Request accounts
      const accounts = await win.ethereum.request({ method: 'eth_requestAccounts' }) as string[]
      const from = accounts[0]
      if (!from) throw new Error('No account selected')

      // 3. Check we're on the right chain
      const chainIdHex = await win.ethereum.request({ method: 'eth_chainId' }) as string
      const connectedChainId = parseInt(chainIdHex, 16)
      if (connectedChainId !== CHAIN_ID) {
        throw new Error(`Wrong network. Please switch to ${CHAIN_ID === 43114 ? 'Avalanche C-Chain' : 'Avalanche Fuji Testnet'} (chainId: ${CHAIN_ID}).`)
      }

      // 4. Build ERC-3009 / EIP-712 typed data for TransferWithAuthorization
      const atomicAmount = Math.round(amount * 1_000_000).toString()
      const validAfter   = 0
      const validBefore  = Math.floor(Date.now() / 1000) + 3600 // 1 hour from now

      // Random 32-byte nonce
      const nonceBytes = crypto.getRandomValues(new Uint8Array(32))
      const nonce      = '0x' + Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('')

      const typedData = {
        types: {
          EIP712Domain: [
            { name: 'name',              type: 'string'  },
            { name: 'version',           type: 'string'  },
            { name: 'chainId',           type: 'uint256' },
            { name: 'verifyingContract', type: 'address' },
          ],
          TransferWithAuthorization: [
            { name: 'from',        type: 'address' },
            { name: 'to',         type: 'address' },
            { name: 'value',      type: 'uint256' },
            { name: 'validAfter', type: 'uint256' },
            { name: 'validBefore',type: 'uint256' },
            { name: 'nonce',      type: 'bytes32' },
          ],
        },
        domain: {
          name:              'USD Coin',
          version:           '2',
          chainId:           CHAIN_ID,
          verifyingContract: USDC_ADDRESS,
        },
        primaryType: 'TransferWithAuthorization',
        message: {
          from:         from,
          to:           MARKETPLACE_ADDRESS,
          value:        atomicAmount,
          validAfter:   validAfter.toString(),
          validBefore:  validBefore.toString(),
          nonce,
        },
      }

      // 5. Sign via eth_signTypedData_v4
      const signature = await win.ethereum.request({
        method: 'eth_signTypedData_v4',
        params: [from, JSON.stringify(typedData)],
      }) as string

      // 6. Parse v, r, s from signature
      const sig = signature.startsWith('0x') ? signature.slice(2) : signature
      const r   = '0x' + sig.slice(0, 64)
      const s   = '0x' + sig.slice(64, 128)
      const v   = parseInt(sig.slice(128, 130), 16)

      setStatus('submitting')

      // 7. POST to deposit API
      const res = await fetch(`/api/agent-keys/${keyId}/deposit`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          ownerAddress: from,
          amount,
          validAfter,
          validBefore,
          nonce,
          v,
          r,
          s,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error ?? `Server error ${res.status}`)
      }

      setTxHash(data.txHash ?? '')
      setStatus('success')
      onSuccess()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      setStatus('error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Add USDC to Key</h2>
            <p className="text-sm text-gray-500">{keyName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {/* On-chain balance display */}
        {balance !== null && (
          <div className="mb-4 rounded-xl bg-blue-50 px-4 py-3">
            <p className="text-xs text-blue-600 font-medium">Current on-chain balance</p>
            <p className="text-lg font-bold text-blue-800">${balance.toFixed(4)} USDC</p>
          </div>
        )}

        {status === 'success' ? (
          <div className="space-y-3 text-center">
            <div className="text-4xl">✅</div>
            <p className="font-semibold text-green-700">USDC deposited successfully!</p>
            {txHash && (
              <p className="text-xs text-gray-500 font-mono break-all">
                Tx: {txHash.slice(0, 20)}...{txHash.slice(-8)}
              </p>
            )}
            <button
              onClick={onClose}
              className="mt-2 w-full rounded-xl bg-avax-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-avax-600"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Amount to deposit (USDC)
              </label>
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(Math.max(1, Math.min(1000, Number(e.target.value))))}
                min={1}
                max={1000}
                step={1}
                disabled={status !== 'idle' && status !== 'error'}
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none disabled:opacity-60"
              />
              <p className="mt-1 text-xs text-gray-400">Min $1 · Max $1,000</p>
            </div>

            {errorMsg && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-xs text-red-700">{errorMsg}</p>
              </div>
            )}

            {/* Info box */}
            <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 text-xs text-gray-500 space-y-1">
              <p>• Signs a gasless ERC-3009 authorization (no ETH needed)</p>
              <p>• USDC transferred directly from your wallet to the contract</p>
              <p>• Each API call deducts the agent price from your on-chain balance</p>
              {/* TODO: Add "Withdraw Unused USDC" — requires user tx (not operator-mediated) */}
            </div>

            <button
              onClick={handleDeposit}
              disabled={status === 'signing' || status === 'submitting'}
              className="w-full rounded-xl bg-avax-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-avax-600 disabled:opacity-50 transition"
            >
              {status === 'signing'    ? '⏳ Waiting for signature...' :
               status === 'submitting' ? '⏳ Submitting on-chain...' :
               `Fund Key — $${amount} USDC`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AgentKeysPage() {
  const [keys, setKeys]       = useState<AgentKey[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newKey, setNewKey]   = useState<AgentKey | null>(null)
  const [form, setForm]       = useState({ name: '', budget_usdc: 10 })
  const [showForm, setShowForm] = useState(false)
  const [copied, setCopied]   = useState(false)

  // Deposit modal state
  const [depositKey, setDepositKey] = useState<{ id: string; name: string } | null>(null)

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
                  Initial Budget (USDC) <span className="text-gray-400">— agent stops when exhausted</span>
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
                    <div className="flex shrink-0 gap-2">
                      {/* Add USDC button — opens DepositModal */}
                      <button
                        onClick={() => setDepositKey({ id: key.id, name: key.name })}
                        className="rounded-lg border border-avax-200 bg-avax-50 px-3 py-1.5 text-xs font-medium text-avax-700 hover:bg-avax-100 transition"
                        title="Fund this key with real USDC on-chain"
                      >
                        + Add USDC
                      </button>
                      <button
                        onClick={() => handleRevoke(key.id)}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 transition"
                      >
                        Revoke
                      </button>
                    </div>
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

      {/* Deposit Modal */}
      {depositKey && (
        <DepositModal
          keyId={depositKey.id}
          keyName={depositKey.name}
          onClose={() => setDepositKey(null)}
          onSuccess={() => {
            setDepositKey(null)
            loadKeys()
          }}
        />
      )}
    </main>
  )
}
