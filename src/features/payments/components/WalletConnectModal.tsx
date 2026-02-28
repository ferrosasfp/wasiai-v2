'use client'

import { useConnect, useConnectors } from 'wagmi'
import { useTranslations } from 'next-intl'

interface WalletConnectModalProps {
  open: boolean
  onClose: () => void
  onConnected?: () => void  // callback opcional post-conexión (WAS-46 lo usa)
}

export function WalletConnectModal({ open, onClose, onConnected }: WalletConnectModalProps) {
  const { connect } = useConnect()
  const allConnectors = useConnectors()
  const t = useTranslations('wallet')

  // Deduplicar connectors: por nombre, excluir "Injected" raw
  const connectors = allConnectors.filter((c, i, arr) =>
    arr.findIndex(x => x.name === c.name) === i && c.name !== 'Injected'
  )

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl p-6 w-72 space-y-3"
        onClick={e => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-gray-700">
          {t('selectWallet')}
        </p>
        {connectors.map(connector => (
          <button
            key={connector.uid}
            onClick={() => {
              connect(
                { connector },
                {
                  onSuccess: () => {
                    onConnected?.()
                  },
                }
              )
              onClose()
            }}
            className="w-full flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 text-sm hover:bg-gray-50 transition"
          >
            {connector.icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={connector.icon} alt={connector.name} className="w-6 h-6 rounded-full" />
            ) : (
              <span className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs">W</span>
            )}
            <span className="font-medium text-gray-800">{connector.name}</span>
          </button>
        ))}
        <button
          onClick={onClose}
          className="w-full text-xs text-gray-400 hover:text-gray-600 pt-1"
        >
          {t('cancel')}
        </button>
      </div>
    </div>
  )
}
