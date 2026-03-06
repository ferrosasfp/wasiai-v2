'use client'

/**
 * UpgradeOnChainModal — WAS-160c
 * Allows an off-chain agent owner to upgrade to on-chain registration.
 * Creator signs selfRegisterAgent() client-side, then backend verifies receipt.
 */

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { createPublicClient, http, formatEther, formatUnits, encodeFunctionData } from 'viem'
import { avalancheFuji, avalanche } from 'viem/chains'
import { WASIAI_MARKETPLACE_ABI, toUSDCAtomics } from '@/lib/contracts/WasiAIMarketplace'
import { ShieldCheck } from 'lucide-react'
import type { Address } from 'viem'
import { USDC_ADDRESS } from '@/lib/chain'

const ERC20_APPROVE_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

interface Props {
  slug: string
  pricePerCall: number
  creatorAddress: string
  contractAddress: string
  chainId: number
  onClose: () => void
}

type Step = 'info' | 'signing' | 'confirming' | 'saving' | 'done' | 'error'

export function UpgradeOnChainModal({
  slug, pricePerCall, creatorAddress, contractAddress, chainId, onClose,
}: Props) {
  const t = useTranslations('agent')
  const router = useRouter()
  const [step, setStep] = useState<Step>('info')
  const [error, setError] = useState<string | null>(null)
  const [gasEstimate, setGasEstimate] = useState<string | null>(null)
  const [balance, setBalance] = useState<string | null>(null)
  const [registrationFee, setRegistrationFee] = useState<bigint>(0n)
  const [feeApplies, setFeeApplies] = useState(false)

  const chain = chainId === 43114 ? avalanche : avalancheFuji
  const rpcUrl = chainId === 43114
    ? process.env.NEXT_PUBLIC_RPC_MAINNET
    : process.env.NEXT_PUBLIC_RPC_TESTNET

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl || undefined) })

  useEffect(() => {
    async function estimate() {
      try {
        // Fetch registration fee from contract
        const [fee, freeLimit, userCount] = await Promise.all([
          publicClient.readContract({
            address: contractAddress as Address,
            abi: WASIAI_MARKETPLACE_ABI,
            functionName: 'registrationFee',
          }) as Promise<bigint>,
          publicClient.readContract({
            address: contractAddress as Address,
            abi: WASIAI_MARKETPLACE_ABI,
            functionName: 'freeRegistrationsPerUser',
          }) as Promise<bigint>,
          publicClient.readContract({
            address: contractAddress as Address,
            abi: WASIAI_MARKETPLACE_ABI,
            functionName: 'userRegistrationCount',
            args: [creatorAddress as Address],
          }) as Promise<bigint>,
        ])
        setRegistrationFee(fee)
        const needsFee = fee > 0n && userCount >= freeLimit
        setFeeApplies(needsFee)

        const [gas, gasPrice, bal] = await Promise.all([
          publicClient.estimateContractGas({
            address: contractAddress as Address,
            abi: WASIAI_MARKETPLACE_ABI,
            functionName: 'selfRegisterAgent',
            args: [slug, toUSDCAtomics(pricePerCall), 0n],
            account: creatorAddress as Address,
          }),
          publicClient.getGasPrice(),
          publicClient.getBalance({ address: creatorAddress as Address }),
        ])
        setGasEstimate(formatEther(gas * gasPrice))
        setBalance(formatEther(bal))
      } catch {
        setGasEstimate(null)
      }
    }
    estimate()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const benefits = [
    { key: 'ownership', icon: '🔒' },
    { key: 'composability', icon: '🌐' },
    { key: 'reputation', icon: '📊' },
    { key: 'censorship', icon: '🛡️' },
    { key: 'badge', icon: '🏷️' },
  ] as const

  async function handleUpgrade() {
    const win = window as Window & { ethereum?: { request: (args: { method: string; params: unknown[] }) => Promise<string> } }
    if (!win.ethereum) {
      setError('Wallet not found')
      setStep('error')
      return
    }

    setStep('signing')

    try {
      // NA-301b: Approve USDC only if user exceeded free registrations
      if (feeApplies) {
        const approveData = encodeFunctionData({
          abi: ERC20_APPROVE_ABI,
          functionName: 'approve',
          args: [contractAddress as Address, registrationFee],
        })

        const approveTx = await win.ethereum.request({
          method: 'eth_sendTransaction',
          params: [{
            from: creatorAddress,
            to: USDC_ADDRESS,
            data: approveData,
          }],
        })

        await publicClient.waitForTransactionReceipt({
          hash: approveTx as `0x${string}`,
          timeout: 60_000,
        })
      }

      const data = encodeFunctionData({
        abi: WASIAI_MARKETPLACE_ABI,
        functionName: 'selfRegisterAgent',
        args: [slug, toUSDCAtomics(pricePerCall), 0n],
      })

      const txHash = await win.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{
          from: creatorAddress,
          to: contractAddress,
          data,
        }],
      })

      setStep('confirming')

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash as `0x${string}`,
        timeout: 60_000,
      })

      if (receipt.status === 'reverted') {
        throw new Error('Transaction reverted')
      }

      // Notify backend to verify and update DB
      setStep('saving')
      const res = await fetch(`/api/creator/agents/${slug}/upgrade-onchain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash }),
      })

      if (!res.ok) {
        const json = await res.json() as { error?: string }
        throw new Error(json.error ?? 'Backend verification failed')
      }

      setStep('done')
      setTimeout(() => {
        onClose()
        router.refresh()
      }, 1500)

    } catch (err: unknown) {
      const msg = err instanceof Error
        ? err.message
        : (typeof err === 'object' && err !== null && 'message' in err)
          ? String((err as { message: unknown }).message)
          : typeof err === 'string' ? err : 'Unknown error'
      if (msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('denied')) {
        setError('Transaction rejected')
      } else {
        setError(msg)
      }
      setStep('error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">

        {step === 'info' && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <ShieldCheck className="h-6 w-6 text-emerald-600" />
              <h2 className="text-lg font-bold text-gray-900">{t('upgrade.title')}</h2>
            </div>

            <div className="space-y-2 mb-6">
              {benefits.map(b => (
                <div key={b.key} className="flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2">
                  <span className="text-lg">{b.icon}</span>
                  <span className="text-sm text-gray-700">{t(`upgrade.benefits.${b.key}`)}</span>
                </div>
              ))}
            </div>

            {registrationFee > 0n && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 mb-4">
                {feeApplies ? (
                  <>
                    <p className="text-sm text-amber-800 font-medium">
                      📋 Registration fee: {formatUnits(registrationFee, 6)} USDC
                    </p>
                    <p className="text-xs text-amber-600 mt-1">
                      You&apos;ve used your free registrations. A fee is required for additional agents.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-green-700 font-medium">
                    🎉 Free registration — no fee for your first agents!
                  </p>
                )}
              </div>
            )}

            {gasEstimate && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4 mb-4">
                <p className="text-sm text-emerald-700 font-medium">
                  {t('upgrade.gasEstimate', { amount: Number(gasEstimate).toFixed(6) })}
                </p>
                {balance && (
                  <p className="text-xs text-emerald-600 mt-1">
                    {t('upgrade.balance', { amount: Number(balance).toFixed(4) })}
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleUpgrade}
                className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 transition"
              >
                {t('upgrade.confirm')}
              </button>
            </div>
          </>
        )}

        {step === 'signing' && (
          <div className="text-center py-8">
            <div className="text-4xl mb-3">✍️</div>
            <p className="font-semibold text-gray-900">Sign transaction in your wallet</p>
          </div>
        )}

        {step === 'confirming' && (
          <div className="text-center py-8">
            <div className="text-4xl mb-3 animate-spin inline-block">⏳</div>
            <p className="font-semibold text-gray-900">{t('upgrade.upgrading')}</p>
            <p className="text-sm text-gray-500 mt-1">Waiting for block confirmation</p>
          </div>
        )}

        {step === 'saving' && (
          <div className="text-center py-8">
            <div className="text-4xl mb-3 animate-spin inline-block">⏳</div>
            <p className="font-semibold text-gray-900">Verifying on-chain...</p>
          </div>
        )}

        {step === 'done' && (
          <div className="text-center py-8">
            <div className="text-4xl mb-3">✅</div>
            <p className="font-semibold text-gray-900">{t('upgrade.success')}</p>
          </div>
        )}

        {step === 'error' && (
          <div className="text-center py-8">
            <div className="text-4xl mb-3">❌</div>
            <p className="font-semibold text-gray-900 mb-2">Error</p>
            <p className="text-sm text-gray-500">{t('upgrade.error', { message: error ?? 'Unknown' })}</p>
            <button
              onClick={() => { setStep('info'); setError(null) }}
              className="mt-4 rounded-xl bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200 transition"
            >
              Try again
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
