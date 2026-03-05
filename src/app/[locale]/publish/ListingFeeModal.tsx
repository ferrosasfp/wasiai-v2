'use client'

/**
 * ListingFeeModal — WAS-131
 * Modal de pago de listing fee via EIP-712 TransferWithAuthorization.
 * El creator firma con su wallet (Core, MetaMask) para publicar agentes adicionales.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

interface Props {
  slug:            string
  listingFee:      number
  treasuryAddress: string
  creatorWallet:   string
  locale:          string
  onCancel:        () => void
}

type Step = 'confirm' | 'signing' | 'paying' | 'done' | 'error'

export default function ListingFeeModal({
  slug, listingFee, treasuryAddress, creatorWallet, locale, onCancel,
}: Props) {
  const router            = useRouter()
  const t                 = useTranslations('publish')
  const [step, setStep]   = useState<Step>('confirm')
  const [error, setError] = useState<string | null>(null)

  async function handleSign() {
    // [Adversary-2] Verificar wallet disponible antes de intentar firmar
    const win = window as Window & { ethereum?: unknown }
    if (typeof window === 'undefined' || !win.ethereum) {
      setError('Necesitas una wallet compatible (Core, MetaMask) para continuar')
      setStep('error')
      return
    }

    setStep('signing')

    try {
      const validBefore   = String(Math.floor(Date.now() / 1000) + 300)
      const nonceBytes    = crypto.getRandomValues(new Uint8Array(32))
      const nonce         = '0x' + Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('')
      const value         = String(Math.round(listingFee * 1_000_000))

      const authorization = {
        from:        creatorWallet,
        to:          treasuryAddress,
        value,
        validAfter:  '0',
        validBefore,
        nonce,
      }

      // EIP-712 payload exacto — estructura NO modificable
      const typedData = {
        domain: {
          name:              'USD Coin',
          version:           '2',
          chainId:           43114,
          verifyingContract: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
        },
        types: {
          TransferWithAuthorization: [
            { name: 'from',        type: 'address' },
            { name: 'to',          type: 'address' },
            { name: 'value',       type: 'uint256' },
            { name: 'validAfter',  type: 'uint256' },
            { name: 'validBefore', type: 'uint256' },
            { name: 'nonce',       type: 'bytes32' },
          ],
        },
        primaryType: 'TransferWithAuthorization',
        message:     authorization,
      }

      const eth = win.ethereum as {
        request: (args: { method: string; params: unknown[] }) => Promise<string>
      }

      const signature = await eth.request({
        method: 'eth_signTypedData_v4',
        params: [creatorWallet, JSON.stringify(typedData)],
      })

      setStep('paying')

      const res = await fetch('/api/creator/listing-fee-pay', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ slug, signature, authorization }),
      })

      if (!res.ok) {
        const json = await res.json() as { error?: string }
        throw new Error(json.error ?? 'Payment failed')
      }

      setStep('done')
      setTimeout(() => router.push(`/${locale}/creator/dashboard`), 1500)

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      if (
        msg.toLowerCase().includes('rejected') ||
        msg.toLowerCase().includes('denied') ||
        msg.toLowerCase().includes('cancelled') ||
        msg.toLowerCase().includes('user rejected')
      ) {
        setError('Firma rechazada. Intenta de nuevo cuando estés listo.')
      } else {
        setError(msg)
      }
      setStep('error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">

        {step === 'confirm' && (
          <>
            <h2 className="text-lg font-bold text-gray-900 mb-2">{t('listingFee.title')}</h2>
            <p className="text-sm text-gray-600 mb-4">{t('listingFee.description')}</p>
            <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 mb-6">
              <p className="text-xs text-gray-500">{t('listingFee.feeLabel')}</p>
              <p className="text-2xl font-bold text-gray-900">${listingFee.toFixed(2)} USDC</p>
              <p className="text-xs text-gray-400 mt-1">{t('listingFee.feeHint')}</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={onCancel}
                className="flex-1 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
              >
                {t('listingFee.cancel')}
              </button>
              <button
                onClick={handleSign}
                className="flex-1 rounded-xl bg-avax-500 px-4 py-2 text-sm font-semibold text-white hover:bg-avax-400 transition"
              >
                {t('listingFee.signAndPublish')}
              </button>
            </div>
          </>
        )}

        {step === 'signing' && (
          <div className="text-center py-8">
            <div className="text-4xl mb-3">✍️</div>
            <p className="font-semibold text-gray-900">{t('listingFee.waitingSignature')}</p>
            <p className="text-sm text-gray-500 mt-1">{t('listingFee.confirmWallet')}</p>
          </div>
        )}

        {step === 'paying' && (
          <div className="text-center py-8">
            <div className="text-4xl mb-3 animate-spin inline-block">⏳</div>
            <p className="font-semibold text-gray-900">{t('listingFee.processing')}</p>
            <p className="text-sm text-gray-500 mt-1">{t('listingFee.confirming')}</p>
          </div>
        )}

        {step === 'done' && (
          <div className="text-center py-8">
            <div className="text-4xl mb-3">✅</div>
            <p className="font-semibold text-gray-900">¡Agente publicado!</p>
            <p className="text-sm text-gray-500 mt-1">{t('listingFee.redirecting')}</p>
          </div>
        )}

        {step === 'error' && (
          <div className="text-center py-8">
            <div className="text-4xl mb-3">❌</div>
            <p className="font-semibold text-gray-900 mb-2">Error</p>
            <p className="text-sm text-gray-500">{error}</p>
            <button
              onClick={() => { setStep('confirm'); setError(null) }}
              className="mt-4 rounded-xl bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200 transition"
            >
              Intentar de nuevo
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
