'use client'

import { PayToCallButton } from '@/features/payments/components/PayToCallButton'
import type { Model } from '../types/models.types'

interface Props {
  model: Model
}

const TREASURY = process.env.NEXT_PUBLIC_WASIAI_TREASURY

export function ModelCallSection({ model }: Props) {
  if (!TREASURY) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-700">
        ⚠️ <strong>Payments not configured yet.</strong>
        <br />
        <span className="text-amber-600">
          Set <code className="font-mono text-xs">NEXT_PUBLIC_WASIAI_TREASURY</code> to enable calling this model.
        </span>
      </div>
    )
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
      {/* Price header */}
      <div className="mb-5 text-center">
        <p className="text-4xl font-extrabold text-gray-900">${model.price_per_call}</p>
        <p className="text-sm text-gray-500">per call · USDC · Avalanche</p>
      </div>

      {/* Stats */}
      <div className="mb-5 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-gray-50 px-3 py-2 text-center">
          <p className="font-semibold text-gray-900">{model.total_calls.toLocaleString()}</p>
          <p className="text-xs text-gray-400">Total calls</p>
        </div>
        <div className="rounded-xl bg-gray-50 px-3 py-2 text-center">
          <p className="font-semibold text-gray-900 capitalize">{model.chain}</p>
          <p className="text-xs text-gray-400">Network</p>
        </div>
      </div>

      {/* Payment component */}
      <PayToCallButton model={model} />

      {/* Trust footer */}
      <p className="mt-3 text-center text-xs text-gray-400">
        ⚡ Gasless · Powered by x402 + Ultravioleta DAO
      </p>
    </div>
  )
}
