'use client'

import { useState, useEffect }      from 'react'
import { useTranslations }          from 'next-intl'
import { useUnifiedWalletClient }   from '@/features/wallet/hooks/useUnifiedWalletClient'
import { useWallet }               from '@/features/wallet/hooks/useWallet'
import { createPublicClient, http } from 'viem'
import { avalancheFuji, avalanche } from 'viem/chains'
import { CLAIM_EARNINGS_ABI }       from '@/lib/contracts/abis'
import { snowscanTx }               from '@/lib/chain'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
const MARKETPLACE_ADDRESS = CHAIN_ID === 43114
  ? (process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET ?? '')
  : (process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI    ?? '')

interface Props {
  pending:       number
  hasWallet:     boolean
  walletAddress: string
}

export function WithdrawButton({ pending, hasWallet, walletAddress }: Props) {
  const t = useTranslations('dashboard')
  const { writeContract, isReady } = useUnifiedWalletClient()
  const { address: connectedAddress } = useWallet()

  // Avoid hydration mismatch — wallet state only known client-side
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const [status, setStatus]   = useState<'idle' | 'requesting' | 'signing' | 'confirming' | 'success' | 'error'>('idle')
  const [txHash, setTxHash]   = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const isDisabled = status === 'requesting' || status === 'signing' || status === 'confirming'

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

  async function handleWithdraw() {
    setErrorMsg('')
    try {
      // B-2: Guard — connected wallet must match registered withdrawal wallet
      if (!connectedAddress) {
        setErrorMsg('No wallet connected. Please connect your wallet first.')
        setStatus('error')
        return
      }
      if (connectedAddress.toLowerCase() !== walletAddress.toLowerCase()) {
        setErrorMsg('Connected wallet does not match your registered withdrawal wallet. Please switch to the correct wallet.')
        setStatus('error')
        return
      }

      // Step 1: Request voucher from backend
      setStatus('requesting')
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

      // Step 2: Submit claimEarnings tx
      setStatus('signing')
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

      // Step 3: Wait for confirmation
      setStatus('confirming')
      const pub = createPublicClient({
        chain:     CHAIN_ID === 43114 ? avalanche : avalancheFuji,
        transport: http(),
      })
      await pub.waitForTransactionReceipt({ hash: hash as `0x${string}`, confirmations: 1 })

      // Step 4: Notify backend to zero out pending_earnings_usdc
      const res = await fetch('/api/creator/withdraw', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ txHash: hash }),
      })
      const data = await res.json() as { error?: string; realAmount?: number }
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`)

      setTxHash(hash)
      setStatus('success')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      setStatus('error')
    }
  }

  // Wait for client mount to avoid hydration mismatch
  if (!mounted) {
    return (
      <button disabled className="rounded-xl bg-gray-100 px-5 py-2.5 text-sm font-semibold text-gray-400 cursor-not-allowed">
        {t('withdrawBtn')}
      </button>
    )
  }

  // No wallet connected
  if (!isReady) {
    return (
      <button disabled className="rounded-xl bg-gray-100 px-5 py-2.5 text-sm font-semibold text-gray-400 cursor-not-allowed">
        {t('withdrawBtn')}
      </button>
    )
  }

  if (status === 'success' && txHash) {
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

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleWithdraw}
        disabled={isDisabled || pending <= 0}
        className="rounded-xl bg-avax-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-avax-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {status === 'requesting'  ? <span className="animate-pulse">{t('withdrawRequesting')}</span>
          : status === 'signing'    ? <span className="animate-pulse">{t('withdrawSigning')}</span>
          : status === 'confirming' ? <span className="animate-pulse">{t('withdrawConfirming')}</span>
          : t('withdrawBtn')}
      </button>
      {errorMsg && (
        <p className="text-xs text-red-500">{errorMsg}</p>
      )}
    </div>
  )
}
