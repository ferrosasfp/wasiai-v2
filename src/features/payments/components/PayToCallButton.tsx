'use client'

import { useState, useEffect, useRef } from 'react'
import { useWallet } from '@/features/wallet/hooks/useWallet'
import { CopyableOutput } from '@/components/ui/CopyableOutput'

function buildExampleFromSchema(schema: Record<string, unknown> | null | undefined): string {
  if (!schema) return ''
  if (schema.type === 'string') return schema.description ? `e.g. ${schema.description}` : 'Write your input here...'
  if (schema.type !== 'object') return ''
  const props = schema.properties as Record<string, Record<string, unknown>> | undefined
  if (!props) return ''
  const example: Record<string, unknown> = {}
  for (const [key, def] of Object.entries(props)) {
    if (def.type === 'string') {
      example[key] = def.enum && Array.isArray(def.enum)
        ? (def.default ?? def.enum[0])
        : (def.description ? `<${def.description}>` : `<${key}>`)
    } else if (def.type === 'number' || def.type === 'integer') {
      example[key] = 0
    } else if (def.type === 'boolean') {
      example[key] = true
    } else {
      example[key] = {}
    }
  }
  return JSON.stringify(example, null, 2)
}
import { WalletConnectModal } from './WalletConnectModal'
import { useTranslations } from 'next-intl'
import type { Model } from '@/features/models/types/models.types'
import { useWalletPayment }    from '../hooks/useWalletPayment'
import { WalletStatusBar }     from './WalletStatusBar'
import { FallbackApproveFlow } from './FallbackApproveFlow'
import { explorerTx } from '@/lib/chain'

interface PayToCallButtonProps {
  model:      Model
  onSuccess?: (result: unknown) => void
}

function InputExample({ example, onUse }: { example: string; onUse: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 text-xs text-gray-400">
      <span>Ej:</span>
      <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-600 truncate max-w-[200px]">{example}</code>
      <button type="button" onClick={() => onUse(example)} className="text-avax-500 hover:text-avax-600 hover:underline shrink-0">
        Usar ejemplo
      </button>
    </div>
  )
}

export function PayToCallButton({ model, onSuccess }: PayToCallButtonProps) {
  const t = useTranslations('payToCall')
  const { disconnect, address } = useWallet()
  const pendingPayRef = useRef(false)
  const [input, setInput] = useState('')
  const [showWalletModal, setShowWalletModal] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])


  const {
    ctx,
    approveConfirmed,
    switchToChain,
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
        onSwitchChain={switchToChain}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      />

      {/* Input */}
      <div className="space-y-1">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={buildExampleFromSchema(model.input_schema) || (model.metadata?.input_hint as string | undefined) || t('inputPlaceholder')}
          rows={6}
          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-avax-400 focus:outline-none resize-none"
        />
        {!!model.metadata?.input_example && !input && (
          <InputExample example={String(model.metadata.input_example)} onUse={setInput} />
        )}
      </div>

      {/* CTA */}
      <button
        onClick={handlePayClick}
        disabled={!mounted || isDisabled}
        className={`w-full rounded-xl py-3 font-semibold text-white transition disabled:opacity-60 ${
          ctx.state === 'success' ? 'bg-green-600 hover:bg-green-700' :
          ctx.state === 'error'   ? 'bg-red-600 hover:bg-red-700'    :
                                    'bg-avax-500 hover:bg-avax-600'
        }`}
      >
        {mounted ? buttonLabel : t('pay', { price: model.price_per_call })}
      </button>

      {/* Gasless note */}
      {mounted && ctx.state === 'idle' && ctx.address && (
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
                href={explorerTx(ctx.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-avax-500 hover:underline"
              >
                tx ↗
              </a>
            )}
          </div>
          <CopyableOutput content={typeof ctx.result === 'string' ? ctx.result : JSON.stringify(ctx.result, null, 2)} />
        </div>
      )}
    </div>
  )
}
