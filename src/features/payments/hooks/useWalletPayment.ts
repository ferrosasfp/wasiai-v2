'use client'

import { useState, useCallback, useRef } from 'react'
import { useWaitForTransactionReceipt } from 'wagmi'
import { useWallet } from '@/features/wallet/hooks/useWallet'
import { useUnifiedWalletClient } from '@/features/wallet/hooks/useUnifiedWalletClient'
import { useChainGuard } from './useChainGuard'
import { useUsdcBalance } from './useUsdcBalance'
import {
  FUJI_CHAIN_ID,
  USDC_FUJI_ADDRESS,
  WASIAI_OPERATOR_ADDRESS,
  USDC_EIP712_CONFIG,
} from '@/shared/lib/web3/fuji'
import type {
  PaymentFlowState,
  PaymentFlowContext,
  X402Requirements,
  X402PaymentHeader,
} from '../types/payment-flow.types'

const USDC_ABI_APPROVE = [
  {
    name: 'approve',
    type: 'function' as const,
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'value',   type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const

interface UseWalletPaymentOptions {
  slug:        string
  input:       string
  priceUsdc:   number
}

export function useWalletPayment({ slug, input, priceUsdc }: UseWalletPaymentOptions) {
  const [flowState, setFlowState] = useState<PaymentFlowState>('idle')
  const [result,    setResult]    = useState<string>()
  const [txHash,    setTxHash]    = useState<`0x${string}`>()
  const [errorMsg,  setErrorMsg]  = useState<string>()
  const [approveTx, setApproveTx] = useState<`0x${string}`>()

  // Guardar requirements del probe para el flujo fallback
  const requirementsRef = useRef<X402Requirements | null>(null)

  const { address }   = useWallet()
  const { isReady, writeContract: unifiedWriteContract, signTypedData } = useUnifiedWalletClient()
  const { isConnected, isCorrectChain, currentChainName, switchToFuji } = useChainGuard()
  const { usdcBalance, hasEnoughBalance, isLoading: balanceLoading } = useUsdcBalance(priceUsdc)
  const { isSuccess: approveConfirmed } = useWaitForTransactionReceipt({ hash: approveTx })

  /** Deriva el estado del flujo a partir del contexto */
  function deriveState(): PaymentFlowState {
    // Estados en vuelo tienen prioridad — nunca los interrumpas con condiciones externas
    if (
      flowState === 'signing_eip3009' ||
      flowState === 'transferring'    ||
      flowState === 'calling'         ||
      flowState === 'approving'
    ) {
      return flowState
    }
    if (!isConnected)       return 'no_wallet'
    if (!isCorrectChain)    return 'wrong_network'
    // Solo evaluar balance cuando ya terminó de cargar — evita hydration mismatch
    if (!balanceLoading && usdcBalance !== undefined && !hasEnoughBalance) return 'insufficient_balance'
    return flowState  // 'idle', 'eip3009_failed', 'success', 'error', etc.
  }

  const pay = useCallback(async () => {
    if (!isReady || !address) return
    setErrorMsg(undefined)

    // ── Probe del endpoint ──────────────────────────────────────────
    setFlowState('calling')
    let probeRes: Response
    try {
      probeRes = await fetch(`/api/v1/models/${slug}/invoke`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ input }),
      })
    } catch {
      setErrorMsg('Error de red. Verifica tu conexión e intenta de nuevo.')
      setFlowState('error')
      return
    }

    if (probeRes.status !== 402) {
      const data = await probeRes.json() as { result?: string; error?: string }
      if (probeRes.ok) {
        setResult(typeof data.result === 'string' ? data.result : JSON.stringify(data.result))
        setFlowState('success')
      } else {
        setErrorMsg(data.error ?? 'Error inesperado del servidor.')
        setFlowState('error')
      }
      return
    }

    const requirements: X402Requirements = await probeRes.json() as X402Requirements
    requirementsRef.current = requirements
    const amountWei = BigInt(requirements.maxAmountRequired)

    // ── Route A: x402 EIP-3009 payment (EOA wallets) ──────────────────
    // (Route C for embedded wallets removed in HU-071)
    // User signs off-chain (signTypedData) → server settles via transferWithAuthorization
    setFlowState('signing_eip3009')
    try {
      const nonce       = crypto.getRandomValues(new Uint8Array(32))
      const nonceHex    = ('0x' + Array.from(nonce).map(b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`
      const validBefore = Math.floor(Date.now() / 1000) + 300  // 5 min

      const signature = await signTypedData({
        domain: {
          name:              USDC_EIP712_CONFIG.name,
          version:           USDC_EIP712_CONFIG.version,
          chainId:           FUJI_CHAIN_ID,
          verifyingContract: requirements.asset,
        },
        types: {
          TransferWithAuthorization: [
            { name: 'from',        type: 'address' },
            { name: 'to',          type: 'address' },
            { name: 'value',       type: 'uint256' },
            { name: 'validAfter',  type: 'uint256' },
            { name: 'validBefore', type: 'uint256' },
            { name: 'nonce',       type: 'bytes32'  },
          ],
        },
        primaryType: 'TransferWithAuthorization',
        message: {
          from:        address,
          to:          requirements.payTo,
          value:       amountWei,
          validAfter:  0n,
          validBefore: BigInt(validBefore),
          nonce:       nonceHex,
        },
      })

      const paymentHeader: X402PaymentHeader = {
        x402Version: 1,
        scheme:      'exact',
        network:     requirements.network,
        payload: {
          signature,
          authorization: {
            from:        address,
            to:          requirements.payTo,
            value:       amountWei.toString(),
            validAfter:  '0',
            validBefore: validBefore.toString(),
            nonce:       nonceHex,
          },
        },
      }

      setFlowState('calling')
      const paidRes = await fetch(`/api/v1/models/${slug}/invoke`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT':    btoa(JSON.stringify(paymentHeader)),
        },
        body: JSON.stringify({ input }),
      })

      const paidData = await paidRes.json() as { result?: string; error?: string; meta?: { tx_hash?: `0x${string}` } }
      if (paidRes.ok) {
        setResult(typeof paidData.result === 'string' ? paidData.result : JSON.stringify(paidData.result))
        setTxHash(paidData.meta?.tx_hash)
        setFlowState('success')
      } else {
        setErrorMsg(paidData.error ?? 'Error procesando el pago.')
        setFlowState('error')
      }

    } catch (err: unknown) {
      const code    = (err as { code?: number })?.code
      const message = (err as { message?: string })?.message ?? ''

      if (code === 4001) {
        setErrorMsg('Cancelaste la operación. Puedes intentar de nuevo.')
        setFlowState('error')
        return
      }

      const isTechnicalFailure =
        message.includes('METHOD_NOT_FOUND') ||
        message.includes('not supported') ||
        message.includes('EIP-712_NOT_SUPPORTED_THIRDWEB') ||
        code === -32601

      if (isTechnicalFailure) {
        setFlowState('eip3009_failed')
      } else {
        setErrorMsg('Error al firmar la autorización. Intenta de nuevo.')
        setFlowState('error')
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, address, slug, input, signTypedData, unifiedWriteContract])

  /** Ejecutar fallback approve — works for both thirdweb and wagmi wallets */
  const executeApprove = useCallback(async (amountWei: bigint) => {
    if (!address) return
    setFlowState('approving')
    try {
      const hash = await unifiedWriteContract({
        address:      USDC_FUJI_ADDRESS,
        abi:          USDC_ABI_APPROVE as unknown as import('viem').Abi,
        functionName: 'approve',
        args:         [WASIAI_OPERATOR_ADDRESS, amountWei],
        chainId:      FUJI_CHAIN_ID,
      })
      setApproveTx(hash)
      setTxHash(hash)
    } catch (err: unknown) {
      const code = (err as { code?: number })?.code
      if (code === 4001) {
        setErrorMsg('Cancelaste la aprobación. Puedes intentar de nuevo.')
      } else {
        setErrorMsg('Error al ejecutar la aprobación on-chain.')
      }
      setFlowState('eip3009_failed')
    }
  }, [address, unifiedWriteContract])

  const currentFlowState = deriveState()

  const ctx: PaymentFlowContext = {
    state:             currentFlowState,
    address,
    chainId:           undefined,
    chainName:         currentChainName,
    usdcBalance,
    hasEnoughBalance,
    fallbackAvailable: flowState === 'eip3009_failed',
    result,
    txHash,
    errorMessage:      errorMsg,
  }

  return {
    ctx,
    balanceLoading,
    approveConfirmed,
    switchToFuji,
    pay,
    executeApprove,
    reset: () => { setFlowState('idle'); setErrorMsg(undefined) },
  }
}
