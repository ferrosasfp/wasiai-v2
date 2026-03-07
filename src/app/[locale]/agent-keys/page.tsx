'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AlertTriangle, Info, KeyRound, Bot } from 'lucide-react'
import { useWallet } from '@/features/wallet/hooks/useWallet'
import { useUnifiedWalletClient } from '@/features/wallet/hooks/useUnifiedWalletClient'

interface AgentKey {
  id: string
  name: string
  budget_usdc: number
  spent_usdc: number
  is_active: boolean
  last_used_at: string | null
  created_at: string
  raw_key?: string
  key_hash?: string  // WAS-141: exposed to owner for on-chain withdrawKey call
}

// ABI para withdrawKey on-chain
const WITHDRAW_KEY_ABI = [
  {
    name: 'withdrawKey',
    type: 'function' as const,
    inputs: [
      { name: 'keyId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

// ABI para USDC.transfer (embedded wallet deposit — Route C)
const USDC_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function' as const,
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const

// USDC contract addresses by chain
const USDC_BY_CHAIN: Record<number, string> = {
  43114: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', // Avalanche mainnet
  43113: '0x5425890298aed601595a70AB815c96711a31Bc65', // Fuji testnet
}

// Marketplace contract address (recipient for ERC-3009 transfer)
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
const USDC_ADDRESS = USDC_BY_CHAIN[CHAIN_ID] ?? USDC_BY_CHAIN[43113]
const MARKETPLACE_ADDRESS = CHAIN_ID === 43114
  ? (process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET ?? '')
  : (process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI    ?? '')

// ── DepositModal ──────────────────────────────────────────────────────────────

interface DepositModalProps {
  keyId:     string
  keyName:   string
  onClose:   () => void
  onSuccess: () => void
}

function DepositModal({ keyId, keyName, onClose, onSuccess }: DepositModalProps) {
  const t = useTranslations('agentKeys')
  const [amount, setAmount]     = useState(10)
  const [status, setStatus]     = useState<'idle' | 'signing' | 'submitting' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [txHash, setTxHash]     = useState('')
  const [balance, setBalance]   = useState<number | null>(null)
  const { address, chain, isThirdweb } = useWallet()
  const { signTypedData, writeContract, isReady } = useUnifiedWalletClient()

  // Load current on-chain balance
  useEffect(() => {
    fetch(`/api/agent-keys/${keyId}/balance`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setBalance(d.onChainBalance) })
      .catch(() => {})
  }, [keyId])

  async function handleDeposit() {
    setErrorMsg('')

    if (CHAIN_ID === 43114 && !MARKETPLACE_ADDRESS) {
      setErrorMsg('Mainnet contract not configured. Contact support.')
      return
    }
    if (!MARKETPLACE_ADDRESS) {
      setErrorMsg('Contract address not configured. Check NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI in env.')
      return
    }

    if (!isReady || !address) {
      setErrorMsg('Wallet no conectada. Conecta tu wallet para continuar.')
      return
    }

    if (chain?.id !== CHAIN_ID) {
      setErrorMsg(`Red incorrecta. Cambia a ${CHAIN_ID === 43114 ? 'Avalanche C-Chain' : 'Avalanche Fuji Testnet'}.`)
      return
    }

    const atomicAmount = BigInt(Math.round(amount * 1_000_000))

    try {
      setStatus('signing')

      if (isThirdweb) {
        // ── Route C: Embedded wallet — USDC.transfer directo ────────────────
        // EIP-3009 no funciona para smart accounts (ecrecover retorna admin EOA)
        const transferHash = await writeContract({
          address:      USDC_ADDRESS as `0x${string}`,
          abi:          USDC_TRANSFER_ABI as unknown as import('viem').Abi,
          functionName: 'transfer',
          args:         [MARKETPLACE_ADDRESS as `0x${string}`, atomicAmount],
          chainId:      CHAIN_ID,
        })

        setStatus('submitting')

        const res = await fetch(`/api/agent-keys/${keyId}/deposit`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ ownerAddress: address, amount, txHash: transferHash }),
        })

        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`)

        setTxHash(transferHash)
        setStatus('success')
        onSuccess()
        return
      }

      // ── Route B: EOA — EIP-3009 TransferWithAuthorization ───────────────
      const validAfter  = 0
      const validBefore = Math.floor(Date.now() / 1000) + 86400

      const nonceBytes = crypto.getRandomValues(new Uint8Array(32))
      const nonce      = '0x' + Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('')

      const signature = await signTypedData({
        domain: {
          name:              'USD Coin',
          version:           '2',
          chainId:           CHAIN_ID,
          verifyingContract: USDC_ADDRESS as `0x${string}`,
        },
        types: {
          TransferWithAuthorization: [
            { name: 'from',        type: 'address' },
            { name: 'to',         type: 'address' },
            { name: 'value',      type: 'uint256' },
            { name: 'validAfter', type: 'uint256' },
            { name: 'validBefore',type: 'uint256' },
            { name: 'nonce',      type: 'bytes32' },
          ],
        },
        primaryType: 'TransferWithAuthorization',
        message: {
          from:        address,
          to:          MARKETPLACE_ADDRESS as `0x${string}`,
          value:       atomicAmount,
          validAfter:  BigInt(validAfter),
          validBefore: BigInt(validBefore),
          nonce:       nonce as `0x${string}`,
        },
      })

      const sig = (signature as string).startsWith('0x') ? (signature as string).slice(2) : signature as string
      const r   = '0x' + sig.slice(0, 64)
      const s   = '0x' + sig.slice(64, 128)
      const v   = parseInt(sig.slice(128, 130), 16)

      setStatus('submitting')

      const res = await fetch(`/api/agent-keys/${keyId}/deposit`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ownerAddress: address, amount, validAfter, validBefore, nonce, v, r, s }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`)

      setTxHash(data.txHash ?? '')
      setStatus('success')
      onSuccess()

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      setStatus('error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{t('deposit.title')}</h2>
            <p className="text-sm text-gray-500">{keyName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {/* On-chain balance display */}
        {balance !== null && (
          <div className="mb-4 rounded-xl bg-blue-50 px-4 py-3">
            <p className="text-xs text-blue-600 font-medium">{t('deposit.balanceLabel')}</p>
            <p className="text-lg font-bold text-blue-800">${balance.toFixed(4)} USDC</p>
          </div>
        )}

        {status === 'success' ? (
          <div className="space-y-3 text-center">
            <div className="text-4xl">✅</div>
            <p className="font-semibold text-green-700">{t('deposit.success')}</p>
            {txHash && (
              <p className="text-xs text-gray-500 font-mono break-all">
                Tx: {txHash.slice(0, 20)}...{txHash.slice(-8)}
              </p>
            )}
            <button
              onClick={onClose}
              className="mt-2 w-full rounded-xl bg-avax-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-avax-600"
            >
              {t('deposit.done')}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                {t('deposit.amountLabel')}
              </label>
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(Math.max(1, Math.min(1000, Number(e.target.value))))}
                min={1}
                max={1000}
                step={1}
                disabled={status !== 'idle' && status !== 'error'}
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none disabled:opacity-60"
              />
              <p className="mt-1 text-xs text-gray-400">{t('deposit.amountHint')}</p>
            </div>

            {errorMsg && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-xs text-red-700">{errorMsg}</p>
              </div>
            )}

            {/* Info box */}
            <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 text-xs text-gray-500 space-y-1">
              <p>• {t('deposit.info1')}</p>
              <p>• {t('deposit.info2')}</p>
              <p>• {t('deposit.info3')}</p>
            </div>

            <button
              onClick={handleDeposit}
              disabled={status === 'signing' || status === 'submitting'}
              className="w-full rounded-xl bg-avax-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-avax-600 disabled:opacity-50 transition"
            >
              {status === 'signing'    ? t('deposit.signing') :
               status === 'submitting' ? t('deposit.submitting') :
               `${t('deposit.fundKey')} — $${amount} USDC`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── CloseKeyModal ─────────────────────────────────────────────────────────────

interface CloseKeyModalProps {
  keyId:     string
  keyName:   string
  balance:   number
  onClose:   () => void
  onSuccess: (txHash: string | null) => void
}

// ── WithdrawModal — WAS-141 ────────────────────────────────────────────────────
// Creator firma withdrawKey on-chain directamente (msg.sender, paga gas en AVAX)
// Soporta retiro parcial o total. Si retira todo → key se cierra en DB.
function WithdrawModal({ keyId, keyName, balance, keyHash, onClose, onSuccess }: {
  keyId: string; keyName: string; balance: number; keyHash: string
  onClose: () => void; onSuccess: () => void
}) {
  const t = useTranslations('agentKeys')
  const [amount,   setAmount]   = useState(balance)
  const [status,   setStatus]   = useState<'idle' | 'signing' | 'submitted' | 'polling' | 'success' | 'error'>('idle')
  const [txHash,   setTxHash]   = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const { address, chain } = useWallet()
  const { writeContract, isReady } = useUnifiedWalletClient()

  async function handleWithdraw() {
    setErrorMsg('')

    if (!keyHash) { setErrorMsg(t('withdraw.noHash')); return }
    if (amount <= 0 || amount > balance) {
      setErrorMsg(t('withdraw.invalidAmount').replace('${max}', balance.toFixed(4)))
      return
    }
    if (!MARKETPLACE_ADDRESS) { setErrorMsg(t('withdraw.noContract')); return }

    if (!isReady || !address) {
      setErrorMsg('Wallet no conectada. Conecta tu wallet para continuar.')
      return
    }

    if (chain?.id !== CHAIN_ID) {
      setErrorMsg(t('withdraw.wrongChain').replace('{chainId}', String(CHAIN_ID)))
      return
    }

    try {
      setStatus('signing')

      const atomicAmount = BigInt(Math.floor(amount * 1_000_000))
      const hex          = keyHash.replace(/^0x/i, '').toLowerCase()
      const bytes32KeyId = ('0x' + hex.padEnd(64, '0').slice(0, 64)) as `0x${string}`

      // writeContract: EOA paga gas en AVAX; embedded → thirdweb sponsorea
      const txHashResult = await writeContract({
        address:      MARKETPLACE_ADDRESS as `0x${string}`,
        abi:          WITHDRAW_KEY_ABI as unknown as import('viem').Abi,
        functionName: 'withdrawKey',
        args:         [bytes32KeyId, atomicAmount],
        chainId:      CHAIN_ID,
      })

      setTxHash(txHashResult)
      setStatus('polling')

      // Esperar confirmación on-chain via viem publicClient
      const { createPublicClient, http } = await import('viem')
      const { avalancheFuji, avalanche } = await import('viem/chains')
      const publicClient = createPublicClient({
        chain:     CHAIN_ID === 43114 ? avalanche : avalancheFuji,
        transport: http(CHAIN_ID === 43114
          ? 'https://api.avax.network/ext/bc/C/rpc'
          : 'https://api.avax-test.network/ext/bc/C/rpc'),
      })

      await publicClient.waitForTransactionReceipt({ hash: txHashResult, timeout: 30_000 })

      // Sync DB
      setStatus('submitted')
      const res = await fetch(`/api/agent-keys/${keyId}/withdraw`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ txHash: txHashResult, amount }),
      })
      const data2 = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data2.error ?? `Error ${res.status}`)

      setStatus('success')
      setTimeout(onSuccess, 1500)
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message
        : (err && typeof err === 'object' && 'message' in err) ? String((err as { message: unknown }).message)
        : String(err)
      setErrorMsg(msg)
      setStatus('error')
    }
  }

  const isLoading = ['signing', 'submitted', 'polling'].includes(status)

  const statusLabel = {
    signing:   t('withdraw.signing'),
    submitted: t('withdraw.submitting'),
    polling:   t('withdraw.polling'),
  }[status as string] ?? t('withdraw.withdrawBtn').replace('${amount}', amount.toFixed(4))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{t('withdraw.title')}</h2>
            <p className="text-sm text-gray-500">{keyName}</p>
          </div>
          <button onClick={onClose} disabled={isLoading} className="text-gray-400 hover:text-gray-600 text-xl leading-none disabled:opacity-30">✕</button>
        </div>

        {status === 'success' ? (
          <div className="text-center space-y-3">
            <div className="text-4xl">✅</div>
            <p className="font-semibold text-green-700">{t('withdraw.success')}</p>
            <p className="text-sm text-gray-500">
              {t('withdraw.sentToWallet').replace('{amount}', `$${amount.toFixed(4)}`)}
            </p>
            {txHash && (
              <a
                href={`${IS_FUJI ? 'https://testnet.snowtrace.io' : 'https://snowtrace.io'}/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-avax-500 underline"
              >
                {t('withdraw.viewTx')} →
              </a>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-4 text-center">
              <p className="text-xs text-gray-500 mb-1">{t('withdraw.availableLabel')}</p>
              <p className="text-3xl font-extrabold text-green-700">
                ${balance.toFixed(4)} <span className="text-base font-medium text-green-500">USDC</span>
              </p>
            </div>

            {/* Monto a retirar */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                {t('withdraw.amountLabel')}
              </label>
              <div className="flex items-center overflow-hidden rounded-xl border border-gray-200 focus-within:border-avax-400">
                <span className="border-r border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-400">$</span>
                <input
                  type="number"
                  step="0.0001"
                  min="0.01"
                  max={balance}
                  value={amount}
                  onChange={e => setAmount(Math.min(balance, Math.max(0, parseFloat(e.target.value) || 0)))}
                  disabled={isLoading}
                  className="flex-1 px-3 py-2.5 text-sm focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setAmount(balance)}
                  className="px-3 py-2.5 text-xs text-avax-500 hover:text-avax-600 font-medium"
                >
                  {t('withdraw.max')}
                </button>
              </div>
              {amount >= balance && (
                <p className="mt-1 text-xs text-amber-600 flex items-center gap-1"><AlertTriangle size={12} /> Retiro total — la key quedará cerrada.</p>
              )}
            </div>

            <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-xs text-blue-800">
              <Info size={13} className="shrink-0" /> {t('withdraw.gasNote')}
            </div>

            {errorMsg && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-xs text-red-700">{errorMsg}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={onClose}
                disabled={isLoading}
                className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleWithdraw}
                disabled={isLoading || amount <= 0 || amount > balance}
                className="flex-1 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 transition"
              >
                {isLoading ? statusLabel : t('withdraw.withdrawBtn', { amount: amount.toFixed(4) })}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const IS_FUJI = CHAIN_ID === 43113

// ── CloseKeyModal ─────────────────────────────────────────────────────────────
function CloseKeyModal({ keyId, keyName, balance, onClose, onSuccess }: CloseKeyModalProps) {
  const t = useTranslations('agentKeys')
  const tCommon = useTranslations('common')
  const [status, setStatus]     = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [result, setResult]     = useState<{ txHash: string | null; refundedUsdc: number } | null>(null)

  async function handleClose() {
    setStatus('loading')
    setErrorMsg('')
    try {
      // Desactivar la clave — los fondos se retiran por separado con WithdrawModal
      const res = await fetch(`/api/agent-keys/${keyId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ is_active: false }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`)

      setResult({ txHash: null, refundedUsdc: 0 })
      setStatus('success')
      onSuccess(data.txHash)
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{t('close.title')}</h2>
            <p className="text-sm text-gray-500">{keyName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {status === 'success' && result ? (
          <div className="space-y-3">
            <div className="text-center text-4xl">✅</div>
            <p className="text-center font-semibold text-green-700">{t('close.success')}</p>
            {result.refundedUsdc > 0 ? (
              <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
                <p className="font-medium">{t('close.refunded', { amount: result.refundedUsdc.toFixed(4) })}</p>
                <p className="mt-1 text-xs text-green-600">
                  {t('close.claimHint')}{' '}
                  <Link href="/creator/dashboard" className="underline">→</Link>
                </p>
              </div>
            ) : (
              <p className="text-center text-sm text-gray-500">{t('close.noRefund')}</p>
            )}
            {result.txHash && (
              <p className="text-center text-xs text-gray-400 font-mono break-all">
                Tx: {result.txHash.slice(0, 20)}...{result.txHash.slice(-8)}
              </p>
            )}
            <button
              onClick={onClose}
              className="w-full rounded-xl bg-avax-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-avax-600"
            >
              {t('close.done')}
            </button>
          </div>
        ) : (
          <div className="space-y-4">

            {/* Advertencia fondos pendientes — bloquea cierre */}
            {balance > 0 ? (
              <div className="rounded-xl bg-red-50 border border-red-300 px-4 py-4 text-sm">
                <div className="flex justify-center mb-2"><AlertTriangle size={24} className="text-red-400" /></div>
                <p className="font-semibold text-red-800 text-center">
                  Tienes <strong>${balance.toFixed(4)} USDC</strong> sin retirar
                </p>
                <p className="mt-2 text-xs text-red-700 text-center">
                  Si cierras esta key, el saldo se moverá a tus Earnings en el contrato.
                  Retira primero para recibirlos directamente en tu wallet.
                </p>
                <p className="mt-1 text-xs text-red-500 text-center">
                  🔜 Próximamente: tú pagarás el gas de este cierre desde tu wallet.
                </p>
              </div>
            ) : (
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
                <p className="font-medium">{t('close.warning')}</p>
                <ul className="mt-2 space-y-1 text-xs text-amber-700 list-disc list-inside">
                  <li>{t('close.warn1')}</li>
                  <li>{t('close.warn3')}</li>
                </ul>
              </div>
            )}

            {errorMsg && (
              <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-xs text-red-700">{errorMsg}</p>
              </div>
            )}

            {balance > 0 ? (
              // Con fondos: CTA principal = cerrar de todos modos (con advertencia)
              // El backend mueve fondos a Earnings automáticamente (HAL-025)
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleClose}
                  disabled={status === 'loading'}
                  className="w-full rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50 transition"
                >
                  {status === 'loading' ? t('close.closing') : 'Cerrar key (fondos van a Earnings)'}
                </button>
                <button
                  onClick={onClose}
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
                >
                  Cancelar — quiero retirar primero
                </button>
              </div>
            ) : (
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
                >
                  {tCommon('cancel')}
                </button>
                <button
                  onClick={handleClose}
                  disabled={status === 'loading'}
                  className="flex-1 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50 transition"
                >
                  {status === 'loading' ? t('close.closing') : t('close.confirmBtn')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AgentKeysPage() {
  const t = useTranslations('agentKeys')
  const tCommon = useTranslations('common')
  const [keys, setKeys]         = useState<AgentKey[]>([])
  const [loading, setLoading]   = useState(true)
  const [creating, setCreating] = useState(false)
  const [newKey, setNewKey]     = useState<AgentKey | null>(null)
  const [form, setForm]         = useState({ name: '' })
  const [showForm, setShowForm] = useState(false)
  const [copied, setCopied]     = useState(false)

  // Modal state
  const [depositKey,  setDepositKey]  = useState<{ id: string; name: string } | null>(null)
  const [closeKey,    setCloseKey]    = useState<{ id: string; name: string; balance: number } | null>(null)
  const [withdrawKey, setWithdrawKey] = useState<{ id: string; name: string; balance: number; keyHash: string } | null>(null)

  const loadKeys = useCallback(() => {
    fetch('/api/agent-keys')
      .then(res => res.ok ? res.json() : [])
      .then(data => { setKeys(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { loadKeys() }, [loadKeys])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    const res = await fetch('/api/agent-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.name, budget_usdc: 0 }),
    })
    if (res.ok) {
      const created = await res.json()
      setNewKey(created)
      setShowForm(false)
      loadKeys()
    }
    setCreating(false)
  }

  function copyKey(key: string) {
    navigator.clipboard.writeText(key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
            <p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="rounded-xl bg-avax-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-avax-600 transition"
          >
            {t('newKey')}
          </button>
        </div>

        {/* New key revealed */}
        {newKey?.raw_key && (
          <div className="mb-6 rounded-2xl border border-green-200 bg-green-50 p-5">
            <div className="flex items-start gap-3">
              <KeyRound size={20} className="text-gray-400" />
              <div className="flex-1">
                <p className="font-semibold text-green-800">{t('keyCreated')}</p>
                <p className="text-sm text-green-600">{t('keyOnce')}</p>
                <div className="mt-3 flex items-center gap-2">
                  <code className="flex-1 rounded-lg bg-white border border-green-200 px-3 py-2 text-sm font-mono text-gray-800 break-all">
                    {newKey.raw_key}
                  </code>
                  <button
                    onClick={() => copyKey(newKey.raw_key!)}
                    className="shrink-0 rounded-lg bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700"
                  >
                    {copied ? '✓' : tCommon('copy')}
                  </button>
                </div>
              </div>
            </div>
            <button onClick={() => setNewKey(null)} className="mt-3 text-xs text-green-600 hover:underline">
              {t('acknowledged')}
            </button>
          </div>
        )}

        {/* Create form */}
        {showForm && (
          <div className="mb-6 rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
            <h2 className="mb-1 font-semibold text-gray-900">{t('newKeyTitle')}</h2>
            <p className="mb-4 text-xs text-gray-400">{t('newKeyHint')}</p>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">{t('keyName')}</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder={t('keyNamePlaceholder')}
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-avax-400 focus:outline-none"
                  required
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-xl bg-avax-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-avax-600 disabled:opacity-50"
                >
                  {creating ? t('creating') : t('createKey')}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
                >
                  {tCommon('cancel')}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Keys list */}
        <div className="rounded-2xl bg-white shadow-sm border border-gray-100">
          {loading ? (
            <div className="py-12 text-center text-gray-400">{tCommon('loading')}</div>
          ) : keys.length === 0 ? (
            <div className="py-12 text-center">
              <div className="flex justify-center mb-3"><Bot size={40} className="text-gray-200" /></div>
              <p className="text-gray-500 text-sm">{t('noKeys')}</p>
              <button
                onClick={() => setShowForm(true)}
                className="mt-4 rounded-xl bg-avax-500 px-4 py-2 text-sm font-semibold text-white hover:bg-avax-600"
              >
                {t('createFirst')}
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {keys.map(key => {
                const available = Math.max(0, Number(key.budget_usdc) - Number(key.spent_usdc))
                const pct       = key.budget_usdc > 0
                  ? Math.min((key.spent_usdc / key.budget_usdc) * 100, 100)
                  : 0

                return (
                  <div key={key.id} className="px-6 py-4">
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{key.name}</span>
                          {!key.is_active && (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-600">{t('revoked')}</span>
                          )}
                          {key.is_active && key.budget_usdc === 0 && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-600">{t('noFunds')}</span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                          <span>{t('totalDeposited')}: <strong className="text-gray-600">${Number(key.budget_usdc).toFixed(2)}</strong></span>
                          <span>{t('spent')}: <strong className="text-gray-600">${Number(key.spent_usdc).toFixed(3)}</strong></span>
                          <span>{t('available')}: <strong className="text-avax-600">${available.toFixed(3)}</strong></span>
                          {key.last_used_at && (
                            <span>{t('lastUsed')}: {new Date(key.last_used_at).toLocaleDateString()}</span>
                          )}
                        </div>
                        {/* Budget bar */}
                        {key.budget_usdc > 0 && (
                          <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100">
                            <div
                              className="h-1.5 rounded-full bg-avax-400"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}
                      </div>

                      {key.is_active && (
                        <div className="flex shrink-0 gap-2">
                          <button
                            onClick={() => setDepositKey({ id: key.id, name: key.name })}
                            className="rounded-lg border border-avax-200 bg-avax-50 px-3 py-1.5 text-xs font-medium text-avax-700 hover:bg-avax-100 transition"
                            title={t('addUsdc')}
                          >
                            {t('addUsdc')}
                          </button>
                          {available > 0 && (
                            <button
                              onClick={() => setWithdrawKey({ id: key.id, name: key.name, balance: available, keyHash: key.key_hash ?? '' })}
                              className="rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 transition"
                            >
                              {t('withdrawBtn', { amount: available.toFixed(2) })}
                            </button>
                          )}
                          <button
                            onClick={() => setCloseKey({ id: key.id, name: key.name, balance: available })}
                            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 transition"
                          >
                            {t('closeKey')}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Emergency withdraw info */}
        <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="text-lg">ℹ️</span>
            <div className="text-xs text-blue-700">
              <p className="font-medium mb-1">{t('emergencyTitle')}</p>
              <p>{t('emergencyDesc')}</p>
              <p className="mt-1 font-mono text-blue-600 break-all">
                {t('contract')}: {MARKETPLACE_ADDRESS || '(dirección no configurada — ver NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI)'}
              </p>
              <p className="mt-1">{t('function')}: <code className="bg-blue-100 px-1 rounded">emergencyWithdrawKey(bytes32 keyId)</code></p>
            </div>
          </div>
        </div>

        {/* Usage example */}
        <div className="mt-4 rounded-2xl bg-gray-900 p-5 text-white">
          <p className="mb-3 text-sm font-semibold text-gray-300">{t('usageTitle')}:</p>
          <pre className="overflow-auto text-sm text-green-400">{`POST /api/v1/models/gpt-translator/invoke
x-agent-key: wasi_your_key_here
Content-Type: application/json

{ "input": "Translate: Hello world" }`}</pre>
        </div>
      </div>

      {/* Deposit Modal */}
      {withdrawKey && (
        <WithdrawModal
          keyId={withdrawKey.id}
          keyName={withdrawKey.name}
          balance={withdrawKey.balance}
          keyHash={withdrawKey.keyHash}
          onClose={() => setWithdrawKey(null)}
          onSuccess={() => { setWithdrawKey(null); setTimeout(loadKeys, 1500) }}
        />
      )}

      {depositKey && (
        <DepositModal
          keyId={depositKey.id}
          keyName={depositKey.name}
          onClose={() => setDepositKey(null)}
          onSuccess={() => {
            setDepositKey(null)
            // Pequeño delay para que la DB confirme el update antes de recargar
            setTimeout(loadKeys, 1500)
          }}
        />
      )}

      {/* Close Key Modal */}
      {closeKey && (
        <CloseKeyModal
          keyId={closeKey.id}
          keyName={closeKey.name}
          balance={closeKey.balance}
          onClose={() => setCloseKey(null)}
          onSuccess={() => {
            setCloseKey(null)
            loadKeys()
          }}
        />
      )}
    </main>
  )
}
