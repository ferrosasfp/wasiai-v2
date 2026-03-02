'use client'

import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'

const OPERATOR_ADDRESS = process.env.NEXT_PUBLIC_OPERATOR_ADDRESS ?? ''
const OWNER_ADDRESS    = process.env.NEXT_PUBLIC_WASIAI_OWNER ?? ''

// Direcciones permitidas para acceder al admin (owner + operator)
const ADMIN_ALLOWED = [
  OPERATOR_ADDRESS,
  OWNER_ADDRESS,
  '0x94DCDb84207724A609B17e4838936832EA59B9eD', // owner testnet
  '0xf432baf1315ccDB23E683B95b03fD54Dd3e447Ba', // operator testnet
].map(a => a.toLowerCase()).filter(Boolean)

interface AdminStatus {
  platformFeeBps:    number
  avaxBalance:       number
  avaxBalanceLow:    boolean
  settlementMode:    'vercel' | 'chainlink'
  lastSettlement:    string | null
  pendingRecordings: number
}

export default function AdminPage() {
  const { address, isConnected } = useAccount()
  const [status, setStatus]       = useState<AdminStatus | null>(null)
  const [loading, setLoading]     = useState(true)
  const [newBps, setNewBps]       = useState<string>('')
  const [feeMsg, setFeeMsg]       = useState<string>('')
  const [settleMsg, setSettleMsg] = useState<string>('')

  const isOwner = isConnected && !!address && ADMIN_ALLOWED.includes(address.toLowerCase())

  async function loadStatus() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/status')
      if (res.ok) setStatus(await res.json() as AdminStatus)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadStatus() }, [])

  async function handleUpdateFee() {
    if (!isOwner) return
    setFeeMsg('Sending tx…')
    try {
      const res = await fetch('/api/admin/fee', {
        method: 'POST',
        headers: {
          'Content-Type':     'application/json',
          'X-Admin-Signature': address ?? '',  // simplified: address as proof of identity
        },
        body: JSON.stringify({ bps: Number(newBps) }),
      })
      const data = await res.json() as { ok?: boolean; txHash?: string; error?: string }
      if (data.ok) {
        setFeeMsg(`✅ Fee updated — tx: ${data.txHash?.slice(0, 12)}…`)
        void loadStatus()
      } else {
        setFeeMsg(`❌ ${data.error ?? 'Failed'}`)
      }
    } catch (err) {
      setFeeMsg(`❌ ${String(err)}`)
    }
  }

  async function handleToggleMode(mode: 'vercel' | 'chainlink') {
    if (!isOwner) return
    setSettleMsg('Updating…')
    try {
      const res = await fetch('/api/admin/settlement', {
        method: 'POST',
        headers: {
          'Content-Type':     'application/json',
          'X-Admin-Signature': address ?? '',
        },
        body: JSON.stringify({ action: 'toggle', mode }),
      })
      const data = await res.json() as { ok?: boolean; settlementMode?: string; error?: string }
      if (data.ok) {
        setSettleMsg(`✅ Mode set to ${data.settlementMode}`)
        void loadStatus()
      } else {
        setSettleMsg(`❌ ${data.error ?? 'Failed'}`)
      }
    } catch (err) {
      setSettleMsg(`❌ ${String(err)}`)
    }
  }

  async function handleRunSettlement() {
    if (!isOwner) return
    setSettleMsg('Running settlement…')
    try {
      const res = await fetch('/api/admin/settlement', {
        method: 'POST',
        headers: {
          'Content-Type':     'application/json',
          'X-Admin-Signature': address ?? '',
        },
        body: JSON.stringify({ action: 'run' }),
      })
      const data = await res.json() as { ok?: boolean; txHash?: string | null; message?: string; error?: string }
      if (data.ok) {
        setSettleMsg(data.txHash ? `✅ Settled — tx: ${data.txHash.slice(0, 12)}…` : `✅ ${data.message ?? 'Done'}`)
        void loadStatus()
      } else {
        setSettleMsg(`❌ ${data.error ?? 'Failed'}`)
      }
    } catch (err) {
      setSettleMsg(`❌ ${String(err)}`)
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">WasiAI Admin Panel</h1>
        <div className="text-sm text-gray-400">
          {isConnected ? (
            <span className="flex items-center gap-2">
              <span className="font-mono">{address?.slice(0, 6)}…{address?.slice(-4)}</span>
              {isOwner ? (
                <span className="rounded bg-avax-500 px-2 py-0.5 text-xs text-white">Owner</span>
              ) : (
                <span className="rounded bg-red-700 px-2 py-0.5 text-xs text-white">Not authorized</span>
              )}
            </span>
          ) : (
            <span className="text-yellow-400">Connect wallet to manage</span>
          )}
        </div>
      </div>

      {!isOwner && (
        <div className="rounded-lg border border-red-700 bg-red-950 p-4 text-red-300">
          Access restricted to WasiAI operator ({OPERATOR_ADDRESS.slice(0, 6)}…{OPERATOR_ADDRESS.slice(-4)})
        </div>
      )}

      {loading && <p className="text-gray-400">Loading status…</p>}

      {status && (
        <>
          {/* Platform Fee */}
          <section className="rounded-lg border border-gray-700 bg-gray-900 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-avax-400">Platform Fee</h2>
            <p className="text-gray-300">
              Current: <span className="font-bold text-white">{status.platformFeeBps} bps ({(status.platformFeeBps / 100).toFixed(2)}%)</span>
            </p>
            {isOwner && (
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={0}
                  max={3000}
                  placeholder="bps (0–3000)"
                  value={newBps}
                  onChange={e => setNewBps(e.target.value)}
                  className="w-40 rounded bg-gray-800 border border-gray-600 px-3 py-1.5 text-white placeholder-gray-500 focus:outline-none focus:border-avax-500"
                />
                <button
                  onClick={handleUpdateFee}
                  className="rounded bg-avax-500 px-4 py-1.5 text-sm text-white hover:bg-avax-600 disabled:opacity-50"
                >
                  Update Fee
                </button>
              </div>
            )}
            {feeMsg && <p className="text-sm text-gray-300">{feeMsg}</p>}
          </section>

          {/* Operational Health */}
          <section className="rounded-lg border border-gray-700 bg-gray-900 p-6 space-y-3">
            <h2 className="text-lg font-semibold text-avax-400">Operational Health</h2>
            <div className="flex items-center gap-3">
              <span className="text-gray-300">Operator AVAX balance:</span>
              <span className={`font-bold ${status.avaxBalanceLow ? 'text-red-400' : 'text-green-400'}`}>
                {status.avaxBalance.toFixed(4)} AVAX
              </span>
              {status.avaxBalanceLow && (
                <span className="rounded bg-red-700 px-2 py-0.5 text-xs text-white animate-pulse">
                  ⚠ LOW BALANCE
                </span>
              )}
            </div>
            <div className="text-gray-300">
              Pending recordings: <span className="font-bold text-white">{status.pendingRecordings}</span>
            </div>
          </section>

          {/* Settlement Batch */}
          <section className="rounded-lg border border-gray-700 bg-gray-900 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-avax-400">Settlement Batch</h2>

            <div className="text-gray-300">
              Current mode:{' '}
              <span className="font-bold text-white uppercase">{status.settlementMode}</span>
            </div>

            {status.lastSettlement && (
              <div className="text-gray-300 text-sm">
                Last settlement: {new Date(status.lastSettlement).toLocaleString()}
              </div>
            )}

            {isOwner && (
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={() => handleToggleMode('vercel')}
                  disabled={status.settlementMode === 'vercel'}
                  className="rounded border border-gray-600 px-4 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-40"
                >
                  Vercel Cron
                </button>
                <button
                  onClick={() => handleToggleMode('chainlink')}
                  disabled={status.settlementMode === 'chainlink'}
                  className="rounded border border-avax-600 px-4 py-1.5 text-sm text-avax-300 hover:bg-avax-900 disabled:opacity-40"
                >
                  Chainlink Automation
                </button>
                <button
                  onClick={handleRunSettlement}
                  className="rounded bg-avax-500 px-4 py-1.5 text-sm text-white hover:bg-avax-600"
                >
                  Run Now
                </button>
              </div>
            )}
            {settleMsg && <p className="text-sm text-gray-300">{settleMsg}</p>}
          </section>
        </>
      )}
    </div>
  )
}
