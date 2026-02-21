'use client'

import { useState } from 'react'
import { useWalletClient, useAccount, useConnect } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { createPaymentFromWalletClient } from 'uvd-x402-sdk/wagmi'
import type { Model } from '@/features/models/types/models.types'

interface PayToCallButtonProps {
  model: Model
  onSuccess?: (result: unknown) => void
}

type CallState = 'idle' | 'connecting' | 'signing' | 'calling' | 'success' | 'error'

const AVALANCHE_CHAIN_ID = 43114

export function PayToCallButton({ model, onSuccess }: PayToCallButtonProps) {
  const { data: walletClient } = useWalletClient({ chainId: AVALANCHE_CHAIN_ID })
  const { isConnected, address } = useAccount()
  const { connect } = useConnect()

  const [state, setState]   = useState<CallState>('idle')
  const [input, setInput]   = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [error, setError]   = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)

  async function handleCall() {
    if (!isConnected) {
      setState('connecting')
      connect({ connector: injected() })
      setState('idle')
      return
    }

    if (!input.trim()) return
    setError(null)
    setResult(null)
    setTxHash(null)

    try {
      // 1. Probe endpoint — expect 402 with payment instructions
      setState('signing')

      const probe = await fetch(`/api/v1/models/${model.slug}/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      })

      if (probe.status !== 402) {
        // Already paid or free — use response directly
        const data = await probe.json()
        setResult(typeof data.result === 'string' ? data.result : JSON.stringify(data.result, null, 2))
        setState('success')
        onSuccess?.(data.result)
        return
      }

      // 2. Build x402 payment header via Ultravioleta DAO facilitator (Avalanche)
      //    createPaymentFromWalletClient signs EIP-712 typed data — no gas needed
      const paymentHeader = await createPaymentFromWalletClient(walletClient, {
        recipient: process.env.NEXT_PUBLIC_WASIAI_TREASURY ?? '',
        amount: String(model.price_per_call),
        chainName: 'avalanche',
        x402Version: 1,
      })

      // 3. Retry with payment
      setState('calling')

      const paid = await fetch(`/api/v1/models/${model.slug}/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT': paymentHeader,
        },
        body: JSON.stringify({ input }),
      })

      if (!paid.ok) {
        const err = await paid.json()
        throw new Error(err.error ?? `Error ${paid.status}`)
      }

      const data = await paid.json()
      setResult(typeof data.result === 'string' ? data.result : JSON.stringify(data.result, null, 2))
      setTxHash(data.meta?.tx_hash ?? null)
      setState('success')
      onSuccess?.(data.result)

    } catch (err) {
      setState('error')
      const msg = err instanceof Error ? err.message : 'Unknown error'

      if (msg.includes('INSUFFICIENT_BALANCE')) {
        setError('Not enough USDC on Avalanche. Add funds and try again.')
      } else if (msg.includes('SIGNATURE_REJECTED') || msg.includes('rejected')) {
        setError('Payment cancelled.')
      } else if (msg.includes('CHAIN_NOT_SUPPORTED')) {
        setError('Switch your wallet to Avalanche C-Chain.')
      } else {
        setError(msg)
      }
    }
  }

  const buttonLabel: Record<CallState, string> = {
    idle: isConnected
      ? `Pay $${model.price_per_call} USDC & Call`
      : 'Connect Wallet to Call',
    connecting: 'Connecting wallet...',
    signing:    'Sign payment (no gas)...',
    calling:    'Calling model...',
    success:    '✓ Done — call again',
    error:      'Retry',
  }

  return (
    <div className="space-y-3">
      {/* Input */}
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder="Enter your input for the model..."
        rows={3}
        className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-indigo-400 focus:outline-none resize-none"
      />

      {/* Wallet info */}
      {isConnected && address && (
        <div className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-2 text-xs text-gray-500">
          <span>🔗 {address.slice(0, 6)}...{address.slice(-4)} · Avalanche</span>
          <span className="text-indigo-500">Gasless via Ultravioleta DAO</span>
        </div>
      )}

      {/* CTA */}
      <button
        onClick={handleCall}
        disabled={['connecting', 'signing', 'calling'].includes(state)}
        className={`w-full rounded-xl py-3 font-semibold text-white transition disabled:opacity-60 ${
          state === 'success' ? 'bg-green-600 hover:bg-green-700' :
          state === 'error'   ? 'bg-red-600 hover:bg-red-700' :
                                'bg-indigo-600 hover:bg-indigo-700'
        }`}
      >
        {buttonLabel[state]}
      </button>

      {/* Payment info */}
      {state === 'idle' && isConnected && (
        <p className="text-center text-xs text-gray-400">
          Signs an EIP-712 message — no AVAX needed for gas ⚡
        </p>
      )}

      {/* Result */}
      {state === 'success' && result && (
        <div className="rounded-xl bg-gray-50 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Result</p>
            {txHash && (
              <a
                href={`https://snowtrace.io/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-indigo-500 hover:underline"
              >
                tx ↗
              </a>
            )}
          </div>
          <pre className="whitespace-pre-wrap font-mono text-xs text-gray-700">{result}</pre>
        </div>
      )}

      {/* Error */}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  )
}
