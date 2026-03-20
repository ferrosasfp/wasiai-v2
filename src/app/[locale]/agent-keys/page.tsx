'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { AlertTriangle, Info, KeyRound, Bot, RefreshCw } from 'lucide-react'
import { useWallet } from '@/features/wallet/hooks/useWallet'
import { useUnifiedWalletClient } from '@/features/wallet/hooks/useUnifiedWalletClient'
import { WITHDRAW_KEY_ABI }       from '@/lib/contracts/abis'
import { keyHashToBytes32 }       from '@/lib/contracts/utils'
import { createPublicClient, http } from 'viem'
import { avalancheFuji, avalanche }  from 'viem/chains'

interface AgentKey {
  id: string
  name: string
  budget_usdc: number
  spent_usdc: number
  is_active: boolean
  last_used_at: string | null
  created_at: string
  raw_key?: string
  key_hash?: string                      // WAS-141: exposed to owner for on-chain withdrawKey call
  owner_wallet_address?: string | null   // HU-058: first depositor's wallet
  allowed_slugs: string[] | null
  allowed_categories: string[] | null
  balance_synced_at?: string | null      // WAS-218: last on-chain sync timestamp
  stale?: boolean                        // WAS-218: true if balance may be outdated
}

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
  keyId:               string
  keyName:             string
  ownerWalletAddress?: string | null   // HU-058: first depositor's wallet
  onClose:             () => void
  onSuccess:           () => void
}

function DepositModal({ keyId, keyName, ownerWalletAddress, onClose, onSuccess }: DepositModalProps) {
  const t = useTranslations('agentKeys')
  const [amount, setAmount]         = useState(10)
  const [status, setStatus]         = useState<'idle' | 'signing' | 'submitting' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg]     = useState('')
  const [txHash, setTxHash]         = useState('')
  const [balance, setBalance]       = useState<number | null>(null)
  const [depositWarning, setDepositWarning] = useState('')  // HU-058
  const { address, chain } = useWallet()
  const { signTypedData, isReady } = useUnifiedWalletClient()

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
      setErrorMsg(t('errorWalletNotConnected'))
      return
    }

    if (chain?.id !== CHAIN_ID) {
      setErrorMsg(t('errorWrongNetwork', { network: CHAIN_ID === 43114 ? 'Avalanche C-Chain' : 'Avalanche Fuji Testnet' }))
      return
    }

    const atomicAmount = BigInt(Math.round(amount * 1_000_000))

    try {
      setStatus('signing')

      // ── EIP-3009 TransferWithAuthorization (EOA) ───────────────────────
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
      if (data.warning) setDepositWarning(data.warning)

      setTxHash(data.txHash ?? '')
      setStatus('success')
      refreshNavBalance()
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
            {depositWarning && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800 text-left flex items-start gap-2">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                <span>{depositWarning}</span>
              </div>
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

            {/* HU-058: Warning si la key ya tiene otra wallet registrada */}
            {ownerWalletAddress &&
             address &&
             ownerWalletAddress.toLowerCase() !== address.toLowerCase() && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-2 text-xs text-amber-800">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <span>
                  Esta key solo puede retirarse con{' '}
                  <span className="font-mono font-semibold">
                    {ownerWalletAddress.slice(0,6)}…{ownerWalletAddress.slice(-4)}
                  </span>.
                  Tu wallet actual puede depositar pero no retirar.
                </span>
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
  keyHash:   string
  onClose:   () => void
  onSuccess: (txHash: string | null) => void
}

// ── WithdrawModal — HU-063 ─────────────────────────────────────────────────────
// Retiro directo: usuario firma withdrawKey(keyId, amount) desde su wallet.
// Retiros parciales permitidos. Usuario paga gas en AVAX.
// API solo sincroniza DB tras verificar evento KeyWithdrawn on-chain.
function WithdrawModal({ keyId, keyName, balance, keyHash, onClose, onSuccess }: {
  keyId: string; keyName: string; balance: number; keyHash: string
  onClose: () => void; onSuccess: () => void
}) {
  const t = useTranslations('agentKeys')
  const { writeContract }       = useUnifiedWalletClient()
  const [amount, setAmount]     = useState(balance)
  const [status, setStatus]     = useState<'idle' | 'signing' | 'submitting' | 'success' | 'error'>('idle')
  const [txHash, setTxHash]     = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleWithdraw() {
    setErrorMsg('')
    try {
      setStatus('signing')
      const bytes32KeyId = keyHashToBytes32(keyHash)
      const atomicAmount = BigInt(Math.round(amount * 1_000_000))

      const hash = await writeContract({
        address:      MARKETPLACE_ADDRESS as `0x${string}`,
        abi:          WITHDRAW_KEY_ABI,
        functionName: 'withdrawKey',
        args:         [bytes32KeyId, atomicAmount],
        chainId:      CHAIN_ID,
      })

      // Esperar confirmación on-chain antes de llamar al API (evita "not yet mined")
      setStatus('submitting')
      const pub = createPublicClient({
        chain:     CHAIN_ID === 43114 ? avalanche : avalancheFuji,
        transport: http(),
      })
      await pub.waitForTransactionReceipt({ hash: hash as `0x${string}`, confirmations: 1 })

      const res = await fetch(`/api/agent-keys/${keyId}/withdraw`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ txHash: hash, amount }),
      })
      const data = await res.json() as { error?: string; realAmount?: number }
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`)

      setTxHash(hash)
      setStatus('success')
      refreshNavBalance()
      onSuccess()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      setStatus('error')
    }
  }

  const isDisabled = status === 'signing' || status === 'submitting'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{t('withdraw.title')}</h2>
            <p className="text-sm text-gray-500">{keyName}</p>
          </div>
          <button onClick={onClose} disabled={isDisabled} className="text-gray-400 hover:text-gray-600 text-xl leading-none disabled:opacity-30">✕</button>
        </div>

        {status === 'success' ? (
          <div className="text-center space-y-3">
            <div className="text-4xl">✅</div>
            <p className="font-semibold text-green-700">{t('withdraw.success')}</p>
            <p className="text-sm text-gray-500">
              {t('withdraw.sentToWallet').replace('{amount}', `$${amount.toFixed(2)}`)}
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
            {/* Balance disponible */}
            <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-center">
              <p className="text-xs text-gray-500 mb-1">{t('withdraw.availableLabel')}</p>
              <p className="text-2xl font-extrabold text-green-700">
                ${balance.toFixed(2)} <span className="text-sm font-medium text-green-500">USDC</span>
              </p>
            </div>

            {/* Input de monto — retiros parciales */}
            <div className="space-y-1">
              <label className="text-xs text-gray-500">{t('withdraw.amountLabel')}</label>
              <input
                type="number"
                min={0.01}
                max={balance}
                step={0.01}
                value={amount}
                onChange={e => setAmount(Math.min(balance, Math.max(0.01, Number(e.target.value))))}
                disabled={isDisabled}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-avax-400 disabled:opacity-50"
              />
              <p className="text-xs text-gray-400 text-right">Máx: ${balance.toFixed(2)} USDC</p>
            </div>

            {/* Aviso gas AVAX */}
            <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 flex items-start gap-2 text-xs text-blue-800">
              <Info size={13} className="shrink-0 mt-0.5" />
              <span>{t('withdrawGasNote')}</span>
            </div>

            {/* Estados signing / submitting */}
            {status === 'signing' && (
              <p className="text-center text-sm text-gray-500 animate-pulse">{t('withdrawConfirmWallet')}</p>
            )}
            {status === 'submitting' && (
              <p className="text-center text-sm text-gray-500 animate-pulse">Sincronizando...</p>
            )}

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
                disabled={isDisabled}
                className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleWithdraw}
                disabled={isDisabled || amount <= 0 || amount > balance}
                className="flex-1 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 transition"
              >
                {isDisabled ? t('withdraw.submitting') : t('withdrawAmountBtn', { amount: amount.toFixed(2) })}
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
function CloseKeyModal({ keyId, keyName, balance, keyHash, onClose, onSuccess }: CloseKeyModalProps) {
  const t = useTranslations('agentKeys')
  const tCommon = useTranslations('common')
  const { writeContract }       = useUnifiedWalletClient()
  const [status, setStatus]     = useState<'idle' | 'signing' | 'withdrawing' | 'closing' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [result, setResult]     = useState<{ txHash: string | null; refundedUsdc: number } | null>(null)

  const { isReady }        = useUnifiedWalletClient()
  const { address, chain } = useWallet()

  async function handleClose() {
    setErrorMsg('')
    try {
      let withdrawTxHash: string | null = null

      // Si hay fondos: retirar on-chain primero (usuario firma withdrawKey)
      if (balance > 0) {
        if (!isReady || !address) {
          setErrorMsg(t('errorWalletNotConnected'))
          return
        }
        if (chain?.id !== CHAIN_ID) {
          setErrorMsg(t('errorWrongNetwork', { network: CHAIN_ID === 43114 ? 'Avalanche C-Chain' : 'Avalanche Fuji Testnet' }))
          return
        }
        setStatus('signing')
        const bytes32KeyId = keyHashToBytes32(keyHash)
        const atomicAmount = BigInt(Math.round(balance * 1_000_000))

        const hash = await writeContract({
          address:      MARKETPLACE_ADDRESS as `0x${string}`,
          abi:          WITHDRAW_KEY_ABI,
          functionName: 'withdrawKey',
          args:         [bytes32KeyId, atomicAmount],
          chainId:      CHAIN_ID,
        })
        withdrawTxHash = hash

        // Esperar confirmación antes de sincronizar DB
        setStatus('withdrawing')
        const pub = createPublicClient({
          chain:     CHAIN_ID === 43114 ? avalanche : avalancheFuji,
          transport: http(),
        })
        await pub.waitForTransactionReceipt({ hash: hash as `0x${string}`, confirmations: 1 })

        // Sincronizar retiro en DB
        const wRes = await fetch(`/api/agent-keys/${keyId}/withdraw`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ txHash: hash, amount: balance }),
        })
        const wData = await wRes.json() as { error?: string }
        if (!wRes.ok) throw new Error(wData.error ?? `Withdraw sync failed: ${wRes.status}`)
      }

      // Marcar key como inactiva en DB
      setStatus('closing')
      const res = await fetch(`/api/agent-keys/${keyId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ is_active: false }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`)

      setResult({ txHash: withdrawTxHash, refundedUsdc: balance })
      setStatus('success')
      onSuccess(withdrawTxHash)
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const isDisabled = status === 'signing' || status === 'withdrawing' || status === 'closing'
  const statusLabel = status === 'signing' ? t('closeSigningLabel')
    : status === 'withdrawing' ? t('closeWithdrawingLabel')
    : status === 'closing' ? t('closeClosingLabel')
    : balance > 0 ? t('closeWithdrawBtn') : t('close.confirmBtn')

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
            {result.refundedUsdc > 0 && (
              <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700 text-center">
                <p className="font-semibold">{t('closeFundsReceived', { amount: result.refundedUsdc.toFixed(2) })}</p>
              </div>
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

            {balance > 0 ? (
              <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-4 text-sm text-center space-y-2">
                <p className="text-2xl">✋</p>
                <p className="font-semibold text-gray-800">
                  {t('closeWithFundsBanner', { amount: `$${balance.toFixed(2)}` })}
                </p>
                <p className="text-xs text-gray-500">
                  {t('closeWithFundsGasNote')}
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

            {/* Estado de progreso */}
            {(status === 'signing' || status === 'withdrawing' || status === 'closing') && (
              <p className="text-center text-sm text-gray-500 animate-pulse">{statusLabel}</p>
            )}

            <div className="flex flex-col gap-2">
              <button
                onClick={handleClose}
                disabled={isDisabled}
                className="w-full rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50 transition"
              >
                {isDisabled ? statusLabel : (balance > 0 ? t('closeAndReceiveBtn') : t('close.confirmBtn'))}
              </button>
              <button
                onClick={onClose}
                disabled={isDisabled}
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-30"
              >
                {tCommon('cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

function refreshNavBalance() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('apikey:refresh'))
  }
}

export default function AgentKeysPage() {
  const t = useTranslations('agentKeys')
  const tCommon = useTranslations('common')
  const { address } = useWallet()   // HU-058: ownership check
  const [keys, setKeys]         = useState<AgentKey[]>([])
  const [loading, setLoading]   = useState(true)
  const [creating, setCreating] = useState(false)
  const [newKey, setNewKey]     = useState<AgentKey | null>(null)
  const [form, setForm]         = useState({ name: '', allowed_slugs: '', allowed_categories: '' })
  const [showForm, setShowForm] = useState(false)
  const [copied, setCopied]     = useState(false)

  // WAS-218: sync state per key
  const [syncingKeyId, setSyncingKeyId] = useState<string | null>(null)
  const [syncMsg, setSyncMsg]           = useState<{ id: string; msg: string } | null>(null)

  async function handleSyncBalance(keyId: string) {
    setSyncingKeyId(keyId)
    setSyncMsg(null)
    try {
      const res = await fetch(`/api/agent-keys/${keyId}/sync-balance`, { method: 'POST' })
      if (res.status === 429) {
        setSyncMsg({ id: keyId, msg: t('syncRateLimit') })
        return
      }
      if (!res.ok) {
        setSyncMsg({ id: keyId, msg: 'Sync failed' })
        return
      }
      const data = await res.json() as { budget_usdc: number; balance_synced_at: string; stale: boolean }
      // Update local state for this key
      setKeys(prev => prev.map(k =>
        k.id === keyId
          ? { ...k, budget_usdc: data.budget_usdc, balance_synced_at: data.balance_synced_at, stale: data.stale }
          : k
      ))
      setSyncMsg({ id: keyId, msg: t('syncSuccess') })
      setTimeout(() => setSyncMsg(prev => prev?.id === keyId ? null : prev), 3000)
    } catch {
      setSyncMsg({ id: keyId, msg: 'Sync failed' })
    } finally {
      setSyncingKeyId(null)
    }
  }

  // Modal state
  const [depositKey,  setDepositKey]  = useState<{ id: string; name: string; ownerWalletAddress?: string | null } | null>(null)
  const [closeKey,    setCloseKey]    = useState<{ id: string; name: string; balance: number; keyHash: string } | null>(null)
  const [withdrawKey, setWithdrawKey] = useState<{ id: string; name: string; balance: number; keyHash: string } | null>(null)

  const loadKeys = useCallback((bustCache = false) => {
    fetch('/api/agent-keys', bustCache ? { headers: { 'Cache-Control': 'no-cache' } } : undefined)
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
      body: JSON.stringify({
        name: form.name,
        budget_usdc: 0,
        allowed_slugs: form.allowed_slugs ? form.allowed_slugs.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        allowed_categories: form.allowed_categories ? form.allowed_categories.split(',').map(s => s.trim()).filter(Boolean) : undefined,
      }),
    })
    if (res.ok) {
      const created = await res.json()
      setNewKey(created)
      setShowForm(false)
      loadKeys(true)
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
                <p className="mt-1 text-xs text-amber-700 font-medium">⚠️ {t('keyShareWarning')}</p>
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
              {/* WAS-186: Scope opcional */}
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-3">
                <p className="text-xs font-medium text-gray-500">{t('scopeOptional')}</p>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">{t('scopeAllowedSlugs')}</label>
                  <input
                    type="text"
                    value={form.allowed_slugs}
                    onChange={e => setForm(p => ({ ...p, allowed_slugs: e.target.value }))}
                    placeholder={t('scopeAllowedSlugsPh')}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs focus:border-avax-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">{t('scopeAllowedCategories')}</label>
                  <input
                    type="text"
                    value={form.allowed_categories}
                    onChange={e => setForm(p => ({ ...p, allowed_categories: e.target.value }))}
                    placeholder={t('scopeAllowedCategoriesPh')}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs focus:border-avax-400 focus:outline-none"
                  />
                </div>
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
                // WAS-257: available = remaining balance (budget - spent)
                const available = Math.max(0, Number(key.budget_usdc) - Number(key.spent_usdc))
                // WAS-218: stale if balance_synced_at is null or > 5 min ago
                const syncedMs = key.balance_synced_at ? new Date(key.balance_synced_at).getTime() : 0
                const isStale = key.stale || !key.balance_synced_at || (Date.now() - syncedMs > 5 * 60 * 1000)
                const isSyncing = syncingKeyId === key.id

                return (
                  <div key={key.id} className="px-6 py-4">
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{key.name}</span>
                          {!key.is_active && (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-600">{t('revoked')}</span>
                          )}
                          {key.is_active && available === 0 && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-600">{t('noFunds')}</span>
                          )}
                          {/* WAS-218: stale indicator */}
                          {isStale && (
                            <span
                              className="flex items-center gap-0.5 rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700 cursor-help"
                              title={t('balanceStale')}
                            >
                              <AlertTriangle size={10} />
                              <span>{t('balanceStale')}</span>
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                          {/* WAS-218: show only Available (on-chain truth); spent_usdc hidden */}
                          <span>{t('available')}: <strong className="text-avax-600">${available.toFixed(3)}</strong></span>
                          {key.last_used_at && (
                            <span>{t('lastUsed')}: {new Date(key.last_used_at).toLocaleDateString()}</span>
                          )}
                          {/* Sync feedback */}
                          {syncMsg?.id === key.id && (
                            <span className="text-green-600 font-medium">{syncMsg.msg}</span>
                          )}
                        </div>
                        {/* Scope (WAS-186) */}
                        <div className="mt-2 flex flex-wrap gap-1 text-xs">
                          {!key.allowed_slugs && !key.allowed_categories ? (
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700 font-medium">{t('scopeFullAccess')}</span>
                          ) : (
                            <>
                              {key.allowed_slugs && key.allowed_slugs.map(slug => (
                                <span key={slug} className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700 font-mono">{slug}</span>
                              ))}
                              {key.allowed_categories && key.allowed_categories.map(cat => (
                                <span key={cat} className="rounded-full bg-purple-100 px-2 py-0.5 text-purple-700">{cat}</span>
                              ))}
                            </>
                          )}
                        </div>
                      </div>

                      {key.is_active && address && (
                        <div className="flex shrink-0 gap-2">
                          {/* WAS-218: Sync balance button */}
                          <button
                            onClick={() => handleSyncBalance(key.id)}
                            disabled={isSyncing}
                            className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 transition disabled:opacity-50"
                            title={t('balanceStale')}
                          >
                            <RefreshCw size={12} className={isSyncing ? 'animate-spin' : ''} />
                          </button>

                          {/* Add USDC */}
                          <button
                            onClick={() => setDepositKey({ id: key.id, name: key.name, ownerWalletAddress: key.owner_wallet_address })}
                            className="rounded-lg border border-avax-200 bg-avax-50 px-3 py-1.5 text-xs font-medium text-avax-700 hover:bg-avax-100 transition"
                            title={t('addUsdc')}
                          >
                            {t('addUsdc')}
                          </button>

                          {/* Withdraw + Close Key — solo la wallet owner */}
                          {(() => {
                            const isOwnerWallet = !key.owner_wallet_address ||
                              (!!address && key.owner_wallet_address.toLowerCase() === address.toLowerCase())
                            const ownerShort = key.owner_wallet_address
                              ? `${key.owner_wallet_address.slice(0,6)}…${key.owner_wallet_address.slice(-4)}`
                              : ''
                            return (
                              <>
                                {available > 0 && (
                                  isOwnerWallet ? (
                                    <button
                                      onClick={() => setWithdrawKey({ id: key.id, name: key.name, balance: available, keyHash: key.key_hash ?? '' })}
                                      className="rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 transition"
                                    >
                                      {t('withdrawBtn', { amount: available.toFixed(2) })}
                                    </button>
                                  ) : (
                                    <div
                                      className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-400 cursor-not-allowed"
                                      title={`Solo puede retirar ${ownerShort}`}
                                    >
                                      🔒 {t('withdrawBtn', { amount: available.toFixed(2) })}
                                    </div>
                                  )
                                )}
                                {(available === 0 || isOwnerWallet) ? (
                                  <button
                                    onClick={() => setCloseKey({ id: key.id, name: key.name, balance: available, keyHash: key.key_hash ?? '' })}
                                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 transition"
                                  >
                                    {t('closeKey')}
                                  </button>
                                ) : (
                                  <div
                                    className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-400 cursor-not-allowed"
                                    title={t('closeKeyRequiresWallet', { wallet: ownerShort })}
                                  >
                                    🔒 {t('closeKey')}
                                  </div>
                                )}
                              </>
                            )
                          })()}
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
          onSuccess={() => { setWithdrawKey(null); setTimeout(() => loadKeys(true), 1500) }}
        />
      )}

      {depositKey && (
        <DepositModal
          keyId={depositKey.id}
          keyName={depositKey.name}
          ownerWalletAddress={depositKey.ownerWalletAddress}
          onClose={() => setDepositKey(null)}
          onSuccess={() => {
            setDepositKey(null)
            setTimeout(() => loadKeys(true), 1500)
          }}
        />
      )}

      {/* Close Key Modal */}
      {closeKey && (
        <CloseKeyModal
          keyId={closeKey.id}
          keyName={closeKey.name}
          balance={closeKey.balance}
          keyHash={closeKey.keyHash}
          onClose={() => setCloseKey(null)}
          onSuccess={() => {
            setCloseKey(null)
            loadKeys(true)
          }}
        />
      )}
    </main>
  )
}
