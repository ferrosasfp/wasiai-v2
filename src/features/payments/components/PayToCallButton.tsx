'use client'

import { useState } from 'react'
import { useWalletClient, useAccount, useConnect } from 'wagmi'
import { injected } from 'wagmi/connectors'
import type { Model } from '@/features/models/types/models.types'

interface PayToCallButtonProps {
  model: Model
  onSuccess?: (result: unknown) => void
}

type CallState = 'idle' | 'connecting' | 'signing' | 'calling' | 'success' | 'error'

const AVALANCHE_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)

// USDC EIP-712 config per chain — supports both Avalanche mainnet and Fuji testnet.
// The SDK wagmi adapter doesn't know 'avalanche-testnet', so we sign manually.
const USDC_CONFIG: Record<number, { name: string; version: string; address: string }> = {
  43114: { name: 'USD Coin', version: '2', address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E' },
  43113: { name: 'USD Coin', version: '2', address: '0x5425890298aed601595a70AB815c96711a31Bc65' },
}

function generateNonce(): `0x${string}` {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return ('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`
}

interface X402Requirements {
  network: string
  asset: string
  payTo: string
  maxAmountRequired: string
  x402Version?: number
}

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

      // 2. Read 402 body to get payment requirements from server
      const probeBody = await probe.json() as X402Requirements

      if (!walletClient) {
        throw new Error('Wallet client not ready. Make sure your wallet is connected to Avalanche.')
      }

      // 3. Sign EIP-712 TransferWithAuthorization manually.
      //    We read asset/payTo/amount from the server 402 body, so this works for
      //    both mainnet and Fuji without depending on the SDK wagmi adapter.
      const usdcCfg = USDC_CONFIG[AVALANCHE_CHAIN_ID]
      if (!usdcCfg) throw new Error(`Unsupported chain: ${AVALANCHE_CHAIN_ID}`)

      const nonce = generateNonce()
      const validBefore = Math.floor(Date.now() / 1000) + 300
      const amountWei = BigInt(probeBody.maxAmountRequired)

      const domain = {
        name:              usdcCfg.name,
        version:           usdcCfg.version,
        chainId:           AVALANCHE_CHAIN_ID,
        verifyingContract: probeBody.asset as `0x${string}`,
      } as const

      const types = {
        TransferWithAuthorization: [
          { name: 'from',        type: 'address' },
          { name: 'to',          type: 'address' },
          { name: 'value',       type: 'uint256' },
          { name: 'validAfter',  type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce',       type: 'bytes32' },
        ],
      } as const

      const typedMessage = {
        from:        address as `0x${string}`,
        to:          probeBody.payTo as `0x${string}`,
        value:       amountWei,
        validAfter:  BigInt(0),
        validBefore: BigInt(validBefore),
        nonce,
      }

      const signature = await walletClient.signTypedData({
        domain,
        types,
        primaryType: 'TransferWithAuthorization',
        message: typedMessage,
      })

      // 4. Build the x402 header (base64-encoded JSON) — same format as SDK
      const payloadData = {
        signature,
        authorization: {
          from:        address,
          to:          probeBody.payTo,
          value:       amountWei.toString(),
          validAfter:  '0',
          validBefore: validBefore.toString(),
          nonce,
        },
      }

      const x402Header = {
        x402Version: 1,
        scheme:      'exact',
        network:     probeBody.network,
        payload:     payloadData,
      }

      const paymentHeader = btoa(JSON.stringify(x402Header))

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
