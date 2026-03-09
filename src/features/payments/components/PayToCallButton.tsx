'use client'

import { useState, useEffect, useRef } from 'react'
import { useWallet } from '@/features/wallet/hooks/useWallet'
import { WalletConnectModal } from './WalletConnectModal'
import { useTranslations } from 'next-intl'
import type { Model } from '@/features/models/types/models.types'
import { useWalletPayment }    from '../hooks/useWalletPayment'
import { WalletStatusBar }     from './WalletStatusBar'
import { FallbackApproveFlow } from './FallbackApproveFlow'

interface PayToCallButtonProps {
  model:      Model
  onSuccess?: (result: unknown) => void
}

export function PayToCallButton({ model, onSuccess }: PayToCallButtonProps) {
  const t = useTranslations('payToCall')
  const { disconnect, address } = useWallet()
  const pendingPayRef = useRef(false)
  const [input, setInput] = useState('')
  const [showWalletModal, setShowWalletModal] = useState(false)


  const {
    ctx,
    approveConfirmed,
    switchToFuji,
    pay,
    executeApprove,
    reset,
  } = useWalletPayment({
    slug:      model.slug,
    input,
    priceUsdc: model.price_per_call,
  })

  // After approve confirmed, automatically retry invoke
  useEffect(() => {
    if (approveConfirmed && ctx.state === 'approving') {
      pay()
    }
  }, [approveConfirmed]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-pay after wallet connects (WAS-46)
  useEffect(() => {
    if (address && pendingPayRef.current) {
      pendingPayRef.current = false
      pay()
    }
  }, [address]) // eslint-disable-line react-hooks/exhaustive-deps

  // Notify parent on success
  useEffect(() => {
    if (ctx.state === 'success' && ctx.result) {
      onSuccess?.(ctx.result)
    }
  }, [ctx.state, ctx.result]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleConnect = () => setShowWalletModal(true)

  function handlePayClick() {
    if (!address) {
      setShowWalletModal(true)
      return
    }
    pay()
  }

  function handleWalletConnected() {
    // onConnected ya se llama después de que wagmi confirmó la conexión
    // address puede estar disponible ya en este punto — disparar pay directo
    pendingPayRef.current = true
    // Pequeño timeout para que wagmi propague address al store antes de pay()
    setTimeout(() => {
      if (pendingPayRef.current) {
        pendingPayRef.current = false
        pay()
      }
    }, 300)
  }

  const handleDisconnect = () => {
    disconnect()
    reset()
  }

  // CTA button label
  const buttonLabel =
    ctx.state === 'no_wallet'            ? t('connectWallet')   :
    ctx.state === 'wrong_network'        ? t('switchNetwork')   :
    ctx.state === 'insufficient_balance' ? t('insufficient')                          :
    ctx.state === 'signing_eip3009'      ? t('signing')                               :
    ctx.state === 'transferring'         ? t('processing')                            :
    ctx.state === 'calling'              ? t('calling')                               :
    ctx.state === 'approving'            ? t('approving')                             :
    ctx.state === 'success'              ? t('done')                                  :
    ctx.state === 'error'                ? t('retry')                                 :
    t('pay', { price: model.price_per_call })

  const isProcessing = (
    ctx.state === 'signing_eip3009' ||
    ctx.state === 'transferring'    ||
    ctx.state === 'calling'         ||
    ctx.state === 'approving'       ||
    ctx.state === 'switching_network'
  )

  const isDisabled =
    isProcessing                                        ||
    ctx.state === 'insufficient_balance'                ||
    ctx.state === 'wrong_network'                       ||
    (ctx.state === 'idle' && !input.trim())

  // Fallback approve flow: visible during eip3009_failed, approving, or after confirm
  const showFallback = (
    ctx.state === 'eip3009_failed' ||
    ctx.state === 'approving'      ||
    (approveConfirmed && ctx.state !== 'success' && ctx.state !== 'error')
  )
  const approveFlowState: 'idle' | 'approving' | 'done' =
    approveConfirmed          ? 'done'      :
    ctx.state === 'approving' ? 'approving' :
                                'idle'

  return (
    <div className="space-y-3">
      {/* Wallet selector modal (WAS-46: uses shared WalletConnectModal from WAS-45) */}
      <WalletConnectModal
        open={showWalletModal}
        onClose={() => setShowWalletModal(false)}
        onConnected={handleWalletConnected}
      />

      {/* Wallet status bar */}
      <WalletStatusBar
        flowState={ctx.state}
        address={ctx.address}
        chainName={ctx.chainName}
        usdcBalance={ctx.usdcBalance}
        priceUsdc={model.price_per_call}
        onSwitchChain={switchToFuji}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      />

      {/* Input */}
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder={t('inputPlaceholder')}
        rows={3}
        className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-avax-400 focus:outline-none resize-none"
      />

      {/* CTA */}
      <button
        onClick={handlePayClick}
        disabled={isDisabled}
        className={`w-full rounded-xl py-3 font-semibold text-white transition disabled:opacity-60 ${
          ctx.state === 'success' ? 'bg-green-600 hover:bg-green-700' :
          ctx.state === 'error'   ? 'bg-red-600 hover:bg-red-700'    :
                                    'bg-avax-500 hover:bg-avax-600'
        }`}
      >
        {buttonLabel}
      </button>

      {/* Gasless note */}
      {ctx.state === 'idle' && ctx.address && (
        <p className="text-center text-xs text-gray-400">{t('gaslessNote')}</p>
      )}

      {/* Fallback approve flow (EIP-3009 not supported by wallet) */}
      {showFallback && (
        <FallbackApproveFlow
          amountUsdc={model.price_per_call}
          approveState={approveFlowState}
          txHash={ctx.txHash}
          onConfirm={() => {
            const amountWei = BigInt(Math.round(model.price_per_call * 1_000_000))
            executeApprove(amountWei)
          }}
          onCancel={reset}
        />
      )}

      {/* Error */}
      {ctx.state === 'error' && ctx.errorMessage && (
        <p className="text-sm text-red-500">{ctx.errorMessage}</p>
      )}

      {/* Success result */}
      {ctx.state === 'success' && ctx.result && (
        <div className="rounded-xl bg-gray-50 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
              {t('result')}
            </p>
            {ctx.txHash && (
              <a
                href={`https://testnet.snowtrace.io/tx/${ctx.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-avax-500 hover:underline"
              >
                tx ↗
              </a>
            )}
          </div>
          <pre className="whitespace-pre-wrap font-mono text-xs text-gray-700 overflow-auto max-h-64">
            {ctx.result}
          </pre>
        </div>
      )}
    </div>
  )
}
