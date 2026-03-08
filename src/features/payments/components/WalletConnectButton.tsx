'use client'

import { useState, useRef, useEffect } from 'react'
import { useAccount, useConnect, useDisconnect, useConnectors, useBalance } from 'wagmi'
import { avalancheFuji } from 'viem/chains'

interface WalletConnectButtonProps { locale: string }

// ── Pill mostrado cuando hay wallet conectada ─────────────────────────────────
function WalletDetailsPill() {
  const { address }    = useAccount()
  const { disconnect } = useDisconnect()
  const { data: balance } = useBalance({ address, chainId: avalancheFuji.id })
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  if (!address) return null

  const shortAddr   = `${address.slice(0, 6)}...${address.slice(-4)}`
  const avaxBal     = balance ? `${(Number(balance.value) / 1e18).toFixed(4)} AVAX` : '...'
  const explorerUrl = `https://testnet.snowtrace.io/address/${address}`

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <span className="h-2 w-2 rounded-full bg-green-400 shrink-0" aria-hidden="true" />
        <span>{shortAddr}</span>
        <span className="text-gray-400 text-xs hidden sm:inline">{avaxBal}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 rounded-xl border border-gray-100 bg-white py-1 shadow-lg z-50">
          <div className="px-4 py-2.5 border-b border-gray-100">
            <p className="text-[11px] text-gray-400 font-mono break-all">{address}</p>
            <p className="text-xs text-gray-500 mt-0.5">{avaxBal}</p>
          </div>
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Ver en Snowtrace →
          </a>
          <div className="border-t border-gray-100 px-4 py-2">
            <button
              onClick={() => { disconnect(); setOpen(false) }}
              className="w-full rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Modal de selección de wallet ──────────────────────────────────────────────
function ConnectModal({ onClose }: { onClose: () => void }) {
  const { connect }  = useConnect()
  const connectors   = useConnectors()
  const ref          = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

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
              onClick={() => { connect({ connector }); onClose() }}
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

// ── Export principal ──────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function WalletConnectButton({ locale: _locale }: WalletConnectButtonProps) {
  const { isConnected } = useAccount()
  const [showModal, setShowModal] = useState(false)

  if (isConnected) return <WalletDetailsPill />

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        Connect Wallet
      </button>
      {showModal && <ConnectModal onClose={() => setShowModal(false)} />}
    </>
  )
}
