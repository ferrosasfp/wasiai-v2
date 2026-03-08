'use client'

import { useRef, useEffect } from 'react'
import { useConnect, useConnectors } from 'wagmi'

interface WalletConnectModalProps {
  open: boolean
  onClose: () => void
  onConnected?: () => void
}

export function WalletConnectModal({ open, onClose, onConnected }: WalletConnectModalProps) {
  const { connect }  = useConnect()
  const connectors   = useConnectors()
  const ref          = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div ref={ref} className="w-80 rounded-2xl border border-gray-100 bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Connect Wallet</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>
        <div className="flex flex-col gap-2">
          {connectors.map(connector => (
            <button
              key={connector.uid}
              onClick={() => {
                connect({ connector })
                onConnected?.()
                onClose()
              }}
              className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              {connector.icon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={connector.icon} alt="" className="h-5 w-5 rounded" />
              )}
              <span>{connector.name}</span>
            </button>
          ))}
          {connectors.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-4">
              No wallet detected. Install Core Wallet or MetaMask.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
