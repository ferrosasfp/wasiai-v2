'use client'

import { useState } from 'react'
import type { Model } from '@/features/models/types/models.types'

interface PayToCallButtonProps {
  model: Model
  onSuccess?: (result: unknown) => void
}

type CallState = 'idle' | 'paying' | 'calling' | 'success' | 'error'

export function PayToCallButton({ model, onSuccess }: PayToCallButtonProps) {
  const [state, setState] = useState<CallState>('idle')
  const [input, setInput] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [walletAddress, setWalletAddress] = useState<string | null>(null)

  async function connectWallet() {
    try {
      // Use browser's ethereum provider directly (MetaMask, etc.)
      const eth = (window as unknown as { ethereum?: { request: (args: { method: string }) => Promise<string[]> } }).ethereum
      if (!eth) {
        alert('Please install MetaMask to connect your wallet')
        return
      }
      const accounts = await eth.request({ method: 'eth_requestAccounts' })
      if (accounts[0]) setWalletAddress(accounts[0])
    } catch {
      setError('Failed to connect wallet')
    }
  }

  async function handleCall() {
    if (!walletAddress) {
      await connectWallet()
      return
    }
    if (!input.trim()) return

    setState('calling')
    setError(null)

    try {
      const probe = await fetch(`/api/v1/models/${model.slug}/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      })

      if (probe.status === 402) {
        setState('paying')
        const paymentInfo = await probe.json()
        const paymentHeader = `x402:mock:${walletAddress}:${paymentInfo.price}:${model.currency}`
        setState('calling')
        const paid = await fetch(`/api/v1/models/${model.slug}/invoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-payment': paymentHeader },
          body: JSON.stringify({ input }),
        })
        const data = await paid.json()
        setResult(typeof data.result === 'string' ? data.result : JSON.stringify(data.result, null, 2))
        setState('success')
        onSuccess?.(data.result)
      } else {
        const data = await probe.json()
        setResult(typeof data.result === 'string' ? data.result : JSON.stringify(data.result, null, 2))
        setState('success')
        onSuccess?.(data.result)
      }
    } catch {
      setState('error')
      setError('Call failed. Please try again.')
    }
  }

  const buttonLabel: Record<CallState, string> = {
    idle: walletAddress ? `Pay $${model.price_per_call} USDC & Call` : 'Connect Wallet to Call',
    paying: `Paying $${model.price_per_call} USDC...`,
    calling: 'Calling model...',
    success: '✓ Success — call again',
    error: 'Retry',
  }

  return (
    <div className="space-y-3">
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder="Enter your input for the model..."
        rows={3}
        className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-indigo-400 focus:outline-none resize-none"
      />

      {walletAddress && (
        <div className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-2">
          <span className="text-xs text-gray-500">
            {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
          </span>
          <button onClick={() => setWalletAddress(null)} className="text-xs text-red-400 hover:text-red-600">
            Disconnect
          </button>
        </div>
      )}

      <button
        onClick={handleCall}
        disabled={state === 'calling' || state === 'paying'}
        className={`w-full rounded-xl py-3 font-semibold text-white transition disabled:opacity-60 ${
          state === 'success' ? 'bg-green-600 hover:bg-green-700' :
          state === 'error' ? 'bg-red-600 hover:bg-red-700' :
          'bg-indigo-600 hover:bg-indigo-700'
        }`}
      >
        {buttonLabel[state]}
      </button>

      {state === 'success' && result && (
        <div className="rounded-xl bg-gray-50 p-4">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">Result</p>
          <pre className="whitespace-pre-wrap font-mono text-xs text-gray-700">{result}</pre>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  )
}
