// Firma ERC-3009 (transferWithAuthorization) con viem v2.
// Construye el payload para el header X-402-Payment.
// CERO ethers.js — solo viem.

import { parseUnits, type WalletClient } from 'viem'

// Tipos EIP-712 de ERC-3009 (estándar Circle/USDC)
const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from',        type: 'address' },
    { name: 'to',          type: 'address' },
    { name: 'value',       type: 'uint256' },
    { name: 'validAfter',  type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce',       type: 'bytes32' },
  ],
} as const

export interface ERC3009Payment {
  from:        `0x${string}`
  to:          `0x${string}`
  value:       bigint
  validAfter:  bigint
  validBefore: bigint
  nonce:       `0x${string}`
  v:           number
  r:           `0x${string}`
  s:           `0x${string}`
}

export interface SignPaymentParams {
  walletClient:  WalletClient
  from:          `0x${string}`
  to:            `0x${string}`
  priceUsdc:     number          // número decimal, ej: 0.01
  usdcAddress:   `0x${string}`
  chainId:       number
}

export async function signERC3009Payment(
  params: SignPaymentParams
): Promise<ERC3009Payment> {
  const { walletClient, from, to, priceUsdc, usdcAddress, chainId } = params

  // Convierte precio decimal a microunidades (USDC tiene 6 decimales)
  const value = parseUnits(priceUsdc.toFixed(6), 6)

  const validAfter  = 0n
  // Validez: 1 hora desde ahora
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600)
  // Nonce aleatorio de 32 bytes (bytes32)
  const nonce = ('0x' +
    Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')) as `0x${string}`

  // Firma EIP-712 via viem
  const signature = await walletClient.signTypedData({
    account: from,
    domain: {
      name:              'USD Coin',
      version:           '2',
      chainId,
      verifyingContract: usdcAddress,
    },
    types:       TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message:     { from, to, value, validAfter, validBefore, nonce },
  })

  // Descomponer firma hex en v, r, s
  // signature es 65 bytes: r(32) + s(32) + v(1)
  const r = `0x${signature.slice(2, 66)}`   as `0x${string}`
  const s = `0x${signature.slice(66, 130)}` as `0x${string}`
  let v = parseInt(signature.slice(130, 132), 16)
  // ERC-3009 requiere v = 27 o 28
  if (v < 27) v += 27

  return { from, to, value, validAfter, validBefore, nonce, v, r, s }
}

/**
 * Construye el valor del header X-402-Payment.
 * Formato: Base64(JSON({ from, to, value, validAfter, validBefore, nonce, v, r, s }))
 * Los bigints se serializan como strings decimales.
 */
export function buildX402Header(payment: ERC3009Payment): string {
  const payload = JSON.stringify({
    from:        payment.from,
    to:          payment.to,
    value:       payment.value.toString(),
    validAfter:  payment.validAfter.toString(),
    validBefore: payment.validBefore.toString(),
    nonce:       payment.nonce,
    v:           payment.v,
    r:           payment.r,
    s:           payment.s,
  })
  return Buffer.from(payload, 'utf-8').toString('base64')
}
