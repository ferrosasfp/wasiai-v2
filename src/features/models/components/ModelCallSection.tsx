'use client'

import { useTranslations } from 'next-intl'
import { PayToCallButton } from '@/features/payments/components/PayToCallButton'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import type { Model } from '../types/models.types'
import { Zap } from 'lucide-react'

interface Props {
  model: Model
  isAuthenticated?: boolean
}

const TREASURY = process.env.NEXT_PUBLIC_WASIAI_TREASURY

export function ModelCallSection({ model, isAuthenticated = false }: Props) {
  const tAnalytics = useTranslations('analytics')
  const tMarket = useTranslations('marketplace')
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
        <p className="text-sm text-gray-500">{tMarket('perCall')}</p>
      </div>

      {/* Stats */}
      <div className="mb-5 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-gray-50 px-3 py-2 text-center">
          <p className="font-semibold text-gray-900">{model.total_calls.toLocaleString('en-US')}</p>
          <p className="text-xs text-gray-400">{tAnalytics('total_calls')}</p>
        </div>
        <div className="rounded-xl bg-gray-50 px-3 py-2 text-center">
          <p className="font-semibold text-gray-900 capitalize">{model.chain}</p>
          <p className="text-xs text-gray-400">{tMarket('network')}</p>
        </div>
      </div>

      {/* Payment section — only for authenticated users */}
      {isAuthenticated ? (
        <>
          <ErrorBoundary>
            <PayToCallButton model={model} />
          </ErrorBoundary>
          <p className="mt-3 text-center text-xs text-gray-400">
            <span className="inline-flex items-center gap-1"><Zap size={11} />Gasless · Powered by WasiAI × Avalanche</span>
          </p>
        </>
      ) : (
        <p className="text-center text-sm text-gray-500">
          {tMarket('loginToCall') ?? 'Log in to call this agent'}
        </p>
      )}
    </div>
  )
}
