'use client'

import { useState } from 'react'

interface Props {
  pending: number
  hasWallet: boolean
}

export function WithdrawButton({ pending, hasWallet }: Props) {
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<{ txHash?: string; error?: string } | null>(null)

  async function handleWithdraw() {
    setLoading(true)
    setResult(null)
    try {
      const res  = await fetch('/api/creator/withdraw', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult({ txHash: data.tx_hash })
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : 'Withdrawal failed' })
    } finally {
      setLoading(false)
    }
  }

  if (!hasWallet) {
    return (
      <button disabled className="rounded-xl bg-gray-100 px-5 py-2.5 text-sm font-semibold text-gray-400 cursor-not-allowed">
        No wallet
      </button>
    )
  }

  if (result?.txHash) {
    return (
      <a
        href={`https://testnet.snowscan.xyz/tx/${result.txHash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-xl bg-green-100 px-5 py-2.5 text-sm font-semibold text-green-700 hover:bg-green-200 transition"
      >
        ✅ View tx ↗
      </a>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleWithdraw}
        disabled={loading || pending <= 0}
        className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? 'Withdrawing…' : 'Withdraw USDC →'}
      </button>
      {result?.error && (
        <p className="text-xs text-red-500">{result.error}</p>
      )}
    </div>
  )
}
