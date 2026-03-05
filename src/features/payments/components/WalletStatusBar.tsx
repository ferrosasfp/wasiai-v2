'use client'

import { useEffect, useReducer } from 'react'
import { useTranslations } from 'next-intl'
import type { PaymentFlowState } from '../types/payment-flow.types'

interface WalletStatusBarProps {
  flowState:     PaymentFlowState
  address?:      `0x${string}`
  chainName?:    string
  usdcBalance?:  number
  priceUsdc:     number
  onSwitchChain: () => void   // DEBE ser handler de onClick, no llamar sola
  onConnect:     () => void
  onDisconnect:  () => void
}

export function WalletStatusBar({
  flowState,
  address,
  chainName,
  usdcBalance,
  priceUsdc,
  onSwitchChain,
  onConnect,
  onDisconnect,
}: WalletStatusBarProps) {
  const [mounted, markMounted] = useReducer(() => true, false)
  useEffect(markMounted, [markMounted])

  const t = useTranslations('wallet')

  const handleDisconnect = () => {
    onDisconnect()
  }

  // SSR guard: evitar hydration mismatch — wallet state solo existe en cliente
  if (!mounted) {
    return (
      <div className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3 text-sm">
        <span className="text-gray-400">{t('connectToContinue')}</span>
      </div>
    )
  }

  if (flowState === 'no_wallet') {
    return (
      <div className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3 text-sm">
        <span className="text-gray-500">{t('connectToContinue')}</span>
        <button
          onClick={onConnect}
          className="rounded-lg bg-avax-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-avax-600 transition"
        >
          {t('connect')}
        </button>
      </div>
    )
  }

  if (flowState === 'wrong_network') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-amber-800">
            {t('yourWalletIsOn')} <strong>{chainName}</strong>. WasiAI requiere Avalanche Fuji Testnet.
          </p>
          <button
            onClick={onSwitchChain}
            className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 transition"
          >
            {t('switchToFuji')}
          </button>
        </div>
        {address && (
          <div className="mt-2 flex justify-end">
            <button
              onClick={handleDisconnect}
              className="text-xs text-amber-600 hover:text-amber-800 transition"
            >
              {t('disconnect')}
            </button>
          </div>
        )}
      </div>
    )
  }

  if (flowState === 'switching_network') {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
        <svg className="h-4 w-4 animate-spin text-avax-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span>{t('switching')}</span>
      </div>
    )
  }

  if (flowState === 'insufficient_balance') {
    return (
      <div className="rounded-xl bg-red-50 px-4 py-3">
        <p className="text-sm text-red-700">
          USDC insuficiente. Tienes{' '}
          <strong>{usdcBalance?.toFixed(2) ?? '0.00'}</strong> USDC, necesitas{' '}
          <strong>{priceUsdc}</strong> USDC.
        </p>
        {address && (
          <div className="mt-2 flex justify-end">
            <button
              onClick={handleDisconnect}
              className="text-xs text-red-500 hover:text-red-700 transition"
            >
              {t('disconnect')}
            </button>
          </div>
        )}
      </div>
    )
  }

  // Estado normal (idle, signing, calling, success, error, etc.) con wallet conectada
  const truncatedAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : ''

  return (
    <div className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-2 text-xs text-gray-500">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-green-400" />
          {truncatedAddress}
        </span>
        {usdcBalance !== undefined && (
          <span className="rounded-md bg-green-100 px-2 py-0.5 font-medium text-green-700">
            USDC: {usdcBalance.toFixed(2)}
          </span>
        )}
      </div>
      <button
        onClick={handleDisconnect}
        className="rounded px-2 py-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition text-xs"
      >
        {t('disconnect')}
      </button>
    </div>
  )
}
