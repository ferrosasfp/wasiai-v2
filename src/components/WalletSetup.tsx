'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  initialWallet: string | null
}

export function WalletSetup({ initialWallet }: Props) {
  const router = useRouter()
  const [wallet, setWallet]   = useState(initialWallet ?? '')
  const [editing, setEditing] = useState(!initialWallet)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [saved, setSaved]     = useState(false)

  async function handleSave() {
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      setError('Dirección inválida — debe ser 0x seguido de 40 caracteres hex')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch('/api/creator/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: wallet }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSaved(true)
      setEditing(false)
      // Refresh server component so WithdrawButton picks up hasWallet=true
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error guardando wallet')
    } finally {
      setLoading(false)
    }
  }

  // Configured state — show address + edit button
  if (!editing && (initialWallet || saved)) {
    return (
      <div className="mt-1 flex items-center gap-2">
        <p className="text-xs text-gray-400 font-mono truncate max-w-[260px]">
          {wallet || initialWallet}
        </p>
        <button
          onClick={() => { setEditing(true); setSaved(false) }}
          className="text-xs text-indigo-400 hover:text-indigo-600 hover:underline"
        >
          Editar
        </button>
      </div>
    )
  }

  // Setup state — show input form
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {!initialWallet && (
        <p className="text-xs text-amber-600">
          ⚠️ Sin wallet configurada — agrega tu dirección EVM para recibir pagos
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={wallet}
          onChange={e => { setWallet(e.target.value); setError(null) }}
          placeholder="0x..."
          spellCheck={false}
          className="w-64 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-mono text-gray-800 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
        <button
          onClick={handleSave}
          disabled={loading || wallet.length < 42}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? 'Guardando…' : 'Guardar'}
        </button>
        {initialWallet && (
          <button
            onClick={() => { setEditing(false); setWallet(initialWallet) }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Cancelar
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {saved && <p className="text-xs text-green-600">✅ Wallet guardada correctamente</p>}
    </div>
  )
}
