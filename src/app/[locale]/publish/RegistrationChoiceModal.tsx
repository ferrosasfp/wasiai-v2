'use client'

/**
 * RegistrationChoiceModal — WAS-160b
 * Shows when a creator with a connected wallet publishes an agent.
 * Lets them choose: on-chain (gas fee, selfRegisterAgent) or off-chain (free).
 */

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { createPublicClient, http, formatEther, formatUnits, encodeFunctionData } from 'viem'
import { avalancheFuji, avalanche } from 'viem/chains'
import { WASIAI_MARKETPLACE_ABI, toUSDCAtomics } from '@/lib/contracts/WasiAIMarketplace'
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
  onChoose: (choice: 'on_chain' | 'off_chain', txHash?: string) => void
  onCancel: () => void
}

type Step = 'choose' | 'signing' | 'confirming' | 'error'

export default function RegistrationChoiceModal({
  slug, pricePerCall, creatorAddress, contractAddress, chainId, onChoose, onCancel,
}: Props) {
  const t = useTranslations('publish')
  const [step, setStep]           = useState<Step>('choose')
  const [error, setError]         = useState<string | null>(null)
  const [gasEstimate, setGasEstimate] = useState<string | null>(null)
  const [balance, setBalance]     = useState<string | null>(null)
  const [registrationFee, setRegistrationFee] = useState<bigint>(0n)
  const [feeApplies, setFeeApplies] = useState(false)

  const chain = chainId === 43114 ? avalanche : avalancheFuji
  const rpcUrl = chainId === 43114
    ? process.env.NEXT_PUBLIC_RPC_MAINNET
    : process.env.NEXT_PUBLIC_RPC_TESTNET

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl || undefined) })

  // Estimate gas + fetch balance on mount
  useEffect(() => {
    async function estimate() {
      try {
        // NA-301b: Fetch registration fee + free tier info
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
        const costWei = gas * gasPrice
        setGasEstimate(formatEther(costWei))
        setBalance(formatEther(bal))
      } catch {
        setGasEstimate(null)
      }
    }
    estimate()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleOnChain() {
    const win = window as Window & { ethereum?: { request: (args: { method: string; params: unknown[] }) => Promise<string> } }
    if (!win.ethereum) {
      setError('Wallet not found')
      setStep('error')
      return
    }

    setStep('signing')

    try {
      const priceAtomics = toUSDCAtomics(pricePerCall)

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

      // Encode selfRegisterAgent call
      const data = encodeFunctionData({
        abi: WASIAI_MARKETPLACE_ABI,
        functionName: 'selfRegisterAgent',
        args: [slug, priceAtomics, 0n],
      })

      const txHash = await win.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{
          from: creatorAddress,
          to:   contractAddress,
          data,
        }],
      })

      setStep('confirming')

      // Wait for receipt
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash as `0x${string}`,
        timeout: 60_000,
      })

      if (receipt.status === 'reverted') {
        throw new Error('Transaction reverted')
      }

      onChoose('on_chain', txHash)
    } catch (err: unknown) {
      const msg = err instanceof Error
        ? err.message
        : (typeof err === 'object' && err !== null && 'message' in err)
          ? String((err as { message: unknown }).message)
          : typeof err === 'string' ? err : 'Unknown error'
      if (msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('denied')) {
        setError('Transaction rejected by user')
      } else {
        setError(msg)
      }
      setStep('error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">

        {step === 'choose' && (
          <>
            <h2 className="text-lg font-bold text-gray-900 mb-4">{t('registrationChoice.title')}</h2>

            {/* On-chain option */}
            <button
              onClick={handleOnChain}
              className="w-full text-left rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4 mb-3 hover:border-emerald-400 transition"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-emerald-600 font-semibold">{t('registrationChoice.onChainOption')}</span>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">ERC-8004</span>
              </div>
              <p className="text-sm text-gray-600">{t('registrationChoice.onChainDesc')}</p>
              {registrationFee > 0n && (
                feeApplies ? (
                  <p className="text-xs text-amber-600 mt-2">
                    📋 Registration fee: {formatUnits(registrationFee, 6)} USDC
                  </p>
                ) : (
                  <p className="text-xs text-green-600 mt-2">
                    🎉 Free registration — no fee for your first agents!
                  </p>
                )
              )}
              {gasEstimate && (
                <p className="text-xs text-gray-400 mt-1">
                  {t('registrationChoice.gasEstimate', { amount: Number(gasEstimate).toFixed(6) })}
                  {balance && ` · Balance: ${Number(balance).toFixed(4)} AVAX`}
                </p>
              )}
            </button>

            {/* Off-chain option */}
            <button
              onClick={() => onChoose('off_chain')}
              className="w-full text-left rounded-xl border-2 border-gray-200 bg-white p-4 mb-4 hover:border-gray-400 transition"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-gray-700 font-semibold">{t('registrationChoice.offChainOption')}</span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">Free</span>
              </div>
              <p className="text-sm text-gray-600">{t('registrationChoice.offChainDesc')}</p>
            </button>

            <button
              onClick={onCancel}
              className="w-full text-center text-sm text-gray-400 hover:text-gray-600 transition"
            >
              Cancel
            </button>
          </>
        )}

        {step === 'signing' && (
          <div className="text-center py-8">
            <div className="text-4xl mb-3">✍️</div>
            <p className="font-semibold text-gray-900">Sign transaction in your wallet</p>
            <p className="text-sm text-gray-500 mt-1">Confirm in Core Wallet or MetaMask</p>
          </div>
        )}

        {step === 'confirming' && (
          <div className="text-center py-8">
            <div className="text-4xl mb-3 animate-spin inline-block">⏳</div>
            <p className="font-semibold text-gray-900">Registering on-chain...</p>
            <p className="text-sm text-gray-500 mt-1">Waiting for confirmation</p>
          </div>
        )}

        {step === 'error' && (
          <div className="text-center py-8">
            <div className="text-4xl mb-3">❌</div>
            <p className="font-semibold text-gray-900 mb-2">Error</p>
            <p className="text-sm text-gray-500">{error}</p>
            <button
              onClick={() => { setStep('choose'); setError(null) }}
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
