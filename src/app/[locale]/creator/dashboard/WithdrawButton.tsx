'use client'

import { useState, useEffect, startTransition } from 'react'
import { useTranslations }          from 'next-intl'
import { useUnifiedWalletClient }   from '@/features/wallet/hooks/useUnifiedWalletClient'
import { useWallet }               from '@/features/wallet/hooks/useWallet'
import { createPublicClient, http } from 'viem'
import { avalancheFuji, avalanche } from 'viem/chains'
import { CLAIM_EARNINGS_ABI, BATCH_SELF_REGISTER_ABI } from '@/lib/contracts/abis'
import { snowscanTx }               from '@/lib/chain'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
const MARKETPLACE_ADDRESS = CHAIN_ID === 43114
  ? (process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET ?? '')
  : (process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI    ?? '')

// SDD-217: Contract limits batchSelfRegister to 50 slugs per tx
const BATCH_SIZE = 50

interface Props {
  pending:       number
  hasWallet:     boolean
  walletAddress: string
}

interface OnChainStatus {
  registered:   string[]
  unregistered: string[]
}

interface AgentRow {
  slug:          string
  price_per_call: number
  erc8004_id:    number | null
}

type RegStep =
  | 'idle'
  | 'checking'
  | 'needsRegistration'
  | 'registering'
  | 'confirming_reg'
  | 'registered'
  | 'readyToWithdraw'
  | 'noEarnings'

type WithdrawStep = 'idle' | 'requesting' | 'signing' | 'confirming' | 'success' | 'error'

export function WithdrawButton({ pending, hasWallet, walletAddress }: Props) {
  const t = useTranslations('dashboard')
  const { writeContract, isReady } = useUnifiedWalletClient()
  const { address: connectedAddress } = useWallet()

  // Avoid hydration mismatch — wallet state only known client-side
  const [mounted, setMounted] = useState(false)
  useEffect(() => { startTransition(() => setMounted(true)) }, [])

  // Registration state
  const [regStep, setRegStep]             = useState<RegStep>('idle')
  const [onChainStatus, setOnChainStatus] = useState<OnChainStatus | null>(null)
  const [regTxHash, setRegTxHash]         = useState('')
  const [regErrorMsg, setRegErrorMsg]     = useState('')

  // Withdraw state
  const [withdrawStep, setWithdrawStep]   = useState<WithdrawStep>('idle')
  const [txHash, setTxHash]               = useState('')
  const [errorMsg, setErrorMsg]           = useState('')

  // On mount: fetch on-chain status
  useEffect(() => {
    if (!mounted || !hasWallet || !walletAddress) return
    void fetchOnChainStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, hasWallet, walletAddress])

  async function fetchOnChainStatus() {
    setRegStep('checking')
    try {
      const res = await fetch('/api/creator/agents/on-chain-status')
      if (!res.ok) {
        setRegStep('idle')
        return
      }
      const data = await res.json() as OnChainStatus
      setOnChainStatus(data)

      if (data.unregistered.length > 0) {
        setRegStep('needsRegistration')
      } else if (pending > 0) {
        setRegStep('readyToWithdraw')
      } else {
        setRegStep('noEarnings')
      }
    } catch {
      setRegStep('idle')
    }
  }

  async function handleRegister() {
    if (!connectedAddress) {
      setRegErrorMsg('No wallet connected. Please connect your wallet first.')
      return
    }
    if (connectedAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      setRegErrorMsg('Connected wallet does not match your registered wallet.')
      return
    }
    if (!onChainStatus || onChainStatus.unregistered.length === 0) return

    setRegErrorMsg('')
    setRegStep('registering')

    try {
      // Fetch agent details (slug, price_per_call, erc8004_id) for unregistered slugs
      const slugsToRegister = onChainStatus.unregistered
      const agentRes = await fetch(
        `/api/creator/agents/batch-details?slugs=${slugsToRegister.join(',')}`
      )

      let agentDetails: AgentRow[]
      if (agentRes.ok) {
        agentDetails = await agentRes.json() as AgentRow[]
      } else {
        // Fallback: use slugs with price=0, erc8004Id=0
        agentDetails = slugsToRegister.map(s => ({ slug: s, price_per_call: 0, erc8004_id: null }))
      }

      // Build lookup map
      const detailMap = new Map(agentDetails.map(a => [a.slug, a]))

      const pub = createPublicClient({
        chain:     CHAIN_ID === 43114 ? avalanche : avalancheFuji,
        transport: http(),
      })

      // Process in chunks of 50 (contract limit)
      const chunks: string[][] = []
      for (let i = 0; i < slugsToRegister.length; i += BATCH_SIZE) {
        chunks.push(slugsToRegister.slice(i, i + BATCH_SIZE))
      }

      let lastHash = ''

      for (const chunk of chunks) {
        const slugs      = chunk
        const prices     = chunk.map(s => {
          const detail = detailMap.get(s)
          const usdcFloat = detail?.price_per_call ?? 0
          // Convert float USDC to atomics: 0.01 → 10000
          return BigInt(Math.round(usdcFloat * 1_000_000))
        })
        const erc8004Ids = chunk.map(s => {
          const detail = detailMap.get(s)
          // AC-10: agents without erc8004Id → register with 0 (non-blocking)
          return BigInt(detail?.erc8004_id ?? 0)
        })

        setRegStep('registering')

        const hash = await writeContract({
          address:      MARKETPLACE_ADDRESS as `0x${string}`,
          abi:          BATCH_SELF_REGISTER_ABI,
          functionName: 'batchSelfRegister',
          args:         [slugs, prices, erc8004Ids],
          chainId:      CHAIN_ID,
        })

        setRegStep('confirming_reg')
        setRegTxHash(hash)

        // AC-8: Polling with 30s timeout
        try {
          await Promise.race([
            pub.waitForTransactionReceipt({ hash: hash as `0x${string}`, confirmations: 1 }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('TIMEOUT')), 30_000)
            ),
          ])
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          if (msg === 'TIMEOUT') {
            setRegErrorMsg(`${t('registerPending')} — ${snowscanTx(hash)}`)
            setRegStep('needsRegistration')
            return
          }
          throw err
        }

        lastHash = hash
      }

      setRegTxHash(lastHash)
      setRegStep('registered')
      // AC-11: Show success message. Do NOT advance to withdraw (earnings are still $0).
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setRegErrorMsg(msg)
      setRegStep('needsRegistration')
    }
  }

  // Existing withdraw logic (W2.3 — unchanged)
  async function handleWithdraw() {
    setErrorMsg('')
    try {
      if (!connectedAddress) {
        setErrorMsg('No wallet connected. Please connect your wallet first.')
        setWithdrawStep('error')
        return
      }
      if (connectedAddress.toLowerCase() !== walletAddress.toLowerCase()) {
        setErrorMsg('Connected wallet does not match your registered withdrawal wallet. Please switch to the correct wallet.')
        setWithdrawStep('error')
        return
      }

      setWithdrawStep('requesting')
      const voucherRes = await fetch('/api/creator/earnings/voucher', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({}),
      })
      const voucher = await voucherRes.json() as {
        grossAmountAtomics: number
        grossAmountUsdc:    number
        deadline:           string
        nonce:              string
        signature:          string
        error?:             string
      }
      if (!voucherRes.ok) throw new Error(voucher.error ?? `Voucher error ${voucherRes.status}`)

      setWithdrawStep('signing')
      const hash = await writeContract({
        address:      MARKETPLACE_ADDRESS as `0x${string}`,
        abi:          CLAIM_EARNINGS_ABI,
        functionName: 'claimEarnings',
        args: [
          walletAddress     as `0x${string}`,
          BigInt(voucher.grossAmountAtomics),
          BigInt(voucher.deadline),
          voucher.nonce     as `0x${string}`,
          voucher.signature as `0x${string}`,
        ],
        chainId: CHAIN_ID,
      })

      setWithdrawStep('confirming')
      const pub = createPublicClient({
        chain:     CHAIN_ID === 43114 ? avalanche : avalancheFuji,
        transport: http(),
      })
      await pub.waitForTransactionReceipt({ hash: hash as `0x${string}`, confirmations: 1 })

      const res = await fetch('/api/creator/withdraw', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ txHash: hash }),
      })
      const data = await res.json() as { error?: string; realAmount?: number }
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`)

      setTxHash(hash)
      setWithdrawStep('success')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      setWithdrawStep('error')
    }
  }

  // --- Render ---

  if (!hasWallet || !walletAddress) {
    return (
      <button
        disabled
        className="rounded-xl bg-gray-100 px-5 py-2.5 text-sm font-semibold text-gray-400 cursor-not-allowed"
      >
        {t('withdrawNoWallet')}
      </button>
    )
  }

  // Wait for client mount to avoid hydration mismatch
  if (!mounted) {
    return (
      <button disabled className="rounded-xl bg-gray-100 px-5 py-2.5 text-sm font-semibold text-gray-400 cursor-not-allowed">
        {t('withdrawBtn')}
      </button>
    )
  }

  if (!isReady) {
    return (
      <button disabled className="rounded-xl bg-gray-100 px-5 py-2.5 text-sm font-semibold text-gray-400 cursor-not-allowed">
        {t('withdrawBtn')}
      </button>
    )
  }

  // Checking on-chain status (W3.2: spinner)
  if (regStep === 'checking') {
    return (
      <button disabled className="rounded-xl bg-gray-100 px-5 py-2.5 text-sm font-semibold text-gray-400 cursor-not-allowed animate-pulse">
        {t('withdrawBtn')}
      </button>
    )
  }

  // AC-11: Registration success message — NOT advancing to withdraw
  if (regStep === 'registered') {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-emerald-600 font-medium">{t('registerSuccess')}</p>
        {regTxHash && (
          <a
            href={snowscanTx(regTxHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 underline"
          >
            {t('withdrawViewTx')} ↗
          </a>
        )}
      </div>
    )
  }

  // AC-4: Needs registration banner (independent of pending earnings)
  if (regStep === 'needsRegistration' && onChainStatus && onChainStatus.unregistered.length > 0) {
    const count = onChainStatus.unregistered.length
    const isRegistering = regStep === ('registering' as RegStep) || regStep === ('confirming_reg' as RegStep)

    return (
      <div className="flex flex-col gap-3">
        {/* Registration banner */}
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">{t('registerTitle')}</p>
          <p className="text-xs text-amber-700 mt-1">{t('registerDesc')}</p>

          {/* AC-5: Show slugs to register */}
          <ul className="mt-2 text-xs text-amber-700 list-disc list-inside max-h-20 overflow-y-auto">
            {onChainStatus.unregistered.map(slug => (
              <li key={slug}>{slug}</li>
            ))}
          </ul>

          {regErrorMsg && (
            <p className="text-xs text-red-500 mt-2">{regErrorMsg}</p>
          )}

          <button
            onClick={handleRegister}
            disabled={isRegistering}
            className="mt-3 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isRegistering
              ? <span className="animate-pulse">{t('registerPending')}</span>
              : t('registerButton', { count })
            }
          </button>
        </div>

        {/* Withdraw section — always shown separately (AC-2/AC-12) */}
        {renderWithdrawButton()}
      </div>
    )
  }

  // Registering / confirming (shouldn't normally reach here but guard anyway)
  if (regStep === 'registering' || regStep === 'confirming_reg') {
    return (
      <div className="flex flex-col gap-2">
        <button
          disabled
          className="rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-semibold text-white cursor-not-allowed animate-pulse"
        >
          {regStep === 'confirming_reg' ? t('registerPending') : t('registerPending')}
        </button>
        {regTxHash && (
          <a href={snowscanTx(regTxHash)} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 underline">
            {t('withdrawViewTx')} ↗
          </a>
        )}
      </div>
    )
  }

  // AC-2/AC-3/AC-12: No unregistered agents → just show withdraw
  return renderWithdrawButton()

  function renderWithdrawButton() {
    // Withdraw success
    if (withdrawStep === 'success' && txHash) {
      return (
        <a
          href={snowscanTx(txHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-xl bg-green-100 px-5 py-2.5 text-sm font-semibold text-green-700 hover:bg-green-200 transition"
        >
          ✅ {t('withdrawViewTx')} ↗
        </a>
      )
    }

    const isWithdrawing = withdrawStep === 'requesting' || withdrawStep === 'signing' || withdrawStep === 'confirming'

    return (
      <div className="flex flex-col items-end gap-1">
        {/* AC-3: disabled with tooltip when no earnings */}
        {pending <= 0 ? (
          <div title={t('withdrawNoEarnings')}>
            <button
              disabled
              className="rounded-xl bg-gray-100 px-5 py-2.5 text-sm font-semibold text-gray-400 cursor-not-allowed"
            >
              {t('withdrawBtn')}
            </button>
          </div>
        ) : (
          <button
            onClick={handleWithdraw}
            disabled={isWithdrawing}
            className="rounded-xl bg-avax-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-avax-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {withdrawStep === 'requesting'  ? <span className="animate-pulse">{t('withdrawRequesting')}</span>
              : withdrawStep === 'signing'    ? <span className="animate-pulse">{t('withdrawSigning')}</span>
              : withdrawStep === 'confirming' ? <span className="animate-pulse">{t('withdrawConfirming')}</span>
              : t('withdrawBtn')}
          </button>
        )}
        {errorMsg && (
          <p className="text-xs text-red-500">{errorMsg}</p>
        )}
      </div>
    )
  }
}
