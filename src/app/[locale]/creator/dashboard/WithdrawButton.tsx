'use client'

import { useState }                 from 'react'
import { useTranslations }          from 'next-intl'
import { useUnifiedWalletClient }   from '@/features/wallet/hooks/useUnifiedWalletClient'
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
  const { writeContract, isThirdweb } = useUnifiedWalletClient()

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

      // Step 2: Sign and submit claimEarnings tx
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

  // Embedded wallets (Google/thirdweb) cannot send on-chain txs via bundler.
  // Same pattern as Agent Keys — show amber notice, require EOA.
  if (isThirdweb) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button disabled className="rounded-xl bg-gray-100 px-5 py-2.5 text-sm font-semibold text-gray-400 cursor-not-allowed">
          {t('withdrawBtn')}
        </button>
        <p className="text-xs text-amber-600 max-w-[200px] text-right">
          {t('withdrawNeedsExternalWallet')}
        </p>
      </div>
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
