'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

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
  keyId:     string
  keyName:   string
  onClose:   () => void
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

    // HAL-013: Guard — never send to empty contract address
    if (CHAIN_ID === 43114 && !MARKETPLACE_ADDRESS) {
      setErrorMsg('Mainnet contract not configured. Contact support.')
      return
    }
    if (!MARKETPLACE_ADDRESS) {
      setErrorMsg('Contract address not configured. Check NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI in env.')
      return
    }

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
      const validBefore  = Math.floor(Date.now() / 1000) + 86400 // 24 horas from now

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

// ── CloseKeyModal ─────────────────────────────────────────────────────────────

interface CloseKeyModalProps {
  keyId:     string
  keyName:   string
  balance:   number
  onClose:   () => void
  onSuccess: (txHash: string | null) => void
}

function CloseKeyModal({ keyId, keyName, balance, onClose, onSuccess }: CloseKeyModalProps) {
  const [status, setStatus]     = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [result, setResult]     = useState<{ txHash: string | null; refundedUsdc: number } | null>(null)

  async function handleClose() {
    setStatus('loading')
    setErrorMsg('')
    try {
      const res = await fetch(`/api/agent-keys/${keyId}/refund`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`)

      setResult({ txHash: data.txHash, refundedUsdc: data.refundedUsdc ?? 0 })
      setStatus('success')
      onSuccess(data.txHash)
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Close API Key</h2>
            <p className="text-sm text-gray-500">{keyName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {status === 'success' && result ? (
          <div className="space-y-3">
            <div className="text-center text-4xl">✅</div>
            <p className="text-center font-semibold text-green-700">Key closed successfully</p>
            {result.refundedUsdc > 0 ? (
              <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
                <p className="font-medium">${result.refundedUsdc.toFixed(4)} USDC moved to your Earnings</p>
                <p className="mt-1 text-xs text-green-600">
                  You can claim your earnings from the{' '}
                  <Link href="/creator/dashboard" className="underline">Creator Dashboard →</Link>
                </p>
              </div>
            ) : (
              <p className="text-center text-sm text-gray-500">No remaining balance to refund.</p>
            )}
            {result.txHash && (
              <p className="text-center text-xs text-gray-400 font-mono break-all">
                Tx: {result.txHash.slice(0, 20)}...{result.txHash.slice(-8)}
              </p>
            )}
            <button
              onClick={onClose}
              className="w-full rounded-xl bg-avax-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-avax-600"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              <p className="font-medium">This will permanently revoke the key.</p>
              <ul className="mt-2 space-y-1 text-xs text-amber-700 list-disc list-inside">
                <li>All pending calls will be settled to creators</li>
                {balance > 0 && (
                  <li>Remaining <strong>${balance.toFixed(4)} USDC</strong> will move to your Earnings</li>
                )}
                <li>Your agent will stop working immediately</li>
              </ul>
            </div>

            {errorMsg && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-xs text-red-700">{errorMsg}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleClose}
                disabled={status === 'loading'}
                className="flex-1 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50 transition"
              >
                {status === 'loading' ? '⏳ Closing...' : 'Close Key'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AgentKeysPage() {
  const [keys, setKeys]         = useState<AgentKey[]>([])
  const [loading, setLoading]   = useState(true)
  const [creating, setCreating] = useState(false)
  const [newKey, setNewKey]     = useState<AgentKey | null>(null)
  const [form, setForm]         = useState({ name: '' })
  const [showForm, setShowForm] = useState(false)
  const [copied, setCopied]     = useState(false)

  // Modal state
  const [depositKey, setDepositKey] = useState<{ id: string; name: string } | null>(null)
  const [closeKey, setCloseKey]     = useState<{ id: string; name: string; balance: number } | null>(null)

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
      body: JSON.stringify({ name: form.name, budget_usdc: 0 }),
    })
    if (res.ok) {
      const created = await res.json()
      setNewKey(created)
      setShowForm(false)
      loadKeys()
    }
    setCreating(false)
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
              API keys para que tus agentes de IA llamen modelos WasiAI de forma autónoma.
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
                <p className="font-semibold text-green-800">Key creada — ¡guárdala ahora!</p>
                <p className="text-sm text-green-600">Esta key no volverá a mostrarse.</p>
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
              La guardé, cerrar
            </button>
          </div>
        )}

        {/* Create form */}
        {showForm && (
          <div className="mb-6 rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
            <h2 className="mb-1 font-semibold text-gray-900">Nueva Agent Key</h2>
            <p className="mb-4 text-xs text-gray-400">
              Tu key comienza vacía. Añade USDC para activarla.
            </p>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Nombre de la key</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Mi agente de trading"
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none"
                  required
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-xl bg-avax-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-avax-600 disabled:opacity-50"
                >
                  {creating ? 'Creando...' : 'Crear Key'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Keys list */}
        <div className="rounded-2xl bg-white shadow-sm border border-gray-100">
          {loading ? (
            <div className="py-12 text-center text-gray-400">Cargando...</div>
          ) : keys.length === 0 ? (
            <div className="py-12 text-center">
              <div className="text-4xl mb-3">🤖</div>
              <p className="text-gray-500 text-sm">Sin agent keys todavía</p>
              <button
                onClick={() => setShowForm(true)}
                className="mt-4 rounded-xl bg-avax-500 px-4 py-2 text-sm font-semibold text-white hover:bg-avax-600"
              >
                Crear tu primera key
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {keys.map(key => {
                const available = Math.max(0, Number(key.budget_usdc) - Number(key.spent_usdc))
                const pct       = key.budget_usdc > 0
                  ? Math.min((key.spent_usdc / key.budget_usdc) * 100, 100)
                  : 0

                return (
                  <div key={key.id} className="px-6 py-4">
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{key.name}</span>
                          {!key.is_active && (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-600">Revocada</span>
                          )}
                          {key.is_active && key.budget_usdc === 0 && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-600">Sin fondos</span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                          <span>Total depositado: <strong className="text-gray-600">${Number(key.budget_usdc).toFixed(2)}</strong></span>
                          <span>Gastado: <strong className="text-gray-600">${Number(key.spent_usdc).toFixed(3)}</strong></span>
                          <span>Disponible: <strong className="text-avax-600">${available.toFixed(3)}</strong></span>
                          {key.last_used_at && (
                            <span>Último uso: {new Date(key.last_used_at).toLocaleDateString('es')}</span>
                          )}
                        </div>
                        {/* Budget bar */}
                        {key.budget_usdc > 0 && (
                          <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100">
                            <div
                              className="h-1.5 rounded-full bg-avax-400"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}
                      </div>

                      {key.is_active && (
                        <div className="flex shrink-0 gap-2">
                          <button
                            onClick={() => setDepositKey({ id: key.id, name: key.name })}
                            className="rounded-lg border border-avax-200 bg-avax-50 px-3 py-1.5 text-xs font-medium text-avax-700 hover:bg-avax-100 transition"
                            title="Añadir USDC on-chain"
                          >
                            + Añadir USDC
                          </button>
                          <button
                            onClick={() => setCloseKey({ id: key.id, name: key.name, balance: available })}
                            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 transition"
                          >
                            Cerrar Key
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Emergency withdraw info */}
        <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="text-lg">ℹ️</span>
            <div className="text-xs text-blue-700">
              <p className="font-medium mb-1">Salida de emergencia garantizada</p>
              <p>
                Si WasiAI dejara de operar por más de 30 días, podrás recuperar tu USDC
                directamente desde el contrato sin nuestra intervención.
              </p>
              <p className="mt-1 font-mono text-blue-600 break-all">
                Contrato: {MARKETPLACE_ADDRESS || '(dirección no configurada — ver NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI)'}
              </p>
              <p className="mt-1">Función: <code className="bg-blue-100 px-1 rounded">emergencyWithdrawKey(bytes32 keyId)</code></p>
            </div>
          </div>
        </div>

        {/* Usage example */}
        <div className="mt-4 rounded-2xl bg-gray-900 p-5 text-white">
          <p className="mb-3 text-sm font-semibold text-gray-300">Uso en tu agente:</p>
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

      {/* Close Key Modal */}
      {closeKey && (
        <CloseKeyModal
          keyId={closeKey.id}
          keyName={closeKey.name}
          balance={closeKey.balance}
          onClose={() => setCloseKey(null)}
          onSuccess={() => {
            setCloseKey(null)
            loadKeys()
          }}
        />
      )}
    </main>
  )
}
