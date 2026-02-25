import { ethers } from 'ethers'

export interface CallReceipt {
  keyId:       string  // bytes32 hex (0x...)
  callId:      string  // UUID del agent_call en DB
  agentSlug:   string
  amountUsdc:  number  // en dólares, ej: 0.001
  timestamp:   number  // unix seconds
}

/**
 * Firma un recibo de llamada con la clave privada del operador.
 *
 * El usuario puede verificar esta firma para auditar que WasiAI
 * no fabricó llamadas ni cobró de más.
 *
 * Mensaje determinístico: keccak256(abi.encodePacked(keyId, callId, agentSlug, atomicAmount, timestamp))
 */
export function signReceipt(receipt: CallReceipt): Promise<string> {
  const operatorKey = process.env.OPERATOR_PRIVATE_KEY?.trim()
  if (!operatorKey) throw new Error('OPERATOR_PRIVATE_KEY not set')

  const wallet = new ethers.Wallet(
    operatorKey.startsWith('0x') ? operatorKey : `0x${operatorKey}`
  )

  const message = ethers.solidityPackedKeccak256(
    ['bytes32', 'string', 'string', 'uint256', 'uint256'],
    [
      receipt.keyId,
      receipt.callId,
      receipt.agentSlug,
      BigInt(Math.round(receipt.amountUsdc * 1_000_000)), // atomic USDC
      BigInt(receipt.timestamp),
    ]
  )

  return wallet.signMessage(ethers.getBytes(message))
}

/**
 * Verifica un recibo criptográfico.
 * Útil para el endpoint público de auditoría y para tests.
 *
 * @returns true si la firma es del operador configurado
 */
export function verifyReceipt(receipt: CallReceipt, signature: string): boolean {
  try {
    const message = ethers.solidityPackedKeccak256(
      ['bytes32', 'string', 'string', 'uint256', 'uint256'],
      [
        receipt.keyId,
        receipt.callId,
        receipt.agentSlug,
        BigInt(Math.round(receipt.amountUsdc * 1_000_000)),
        BigInt(receipt.timestamp),
      ]
    )
    const recovered = ethers.verifyMessage(ethers.getBytes(message), signature)
    const operatorKey = process.env.OPERATOR_PRIVATE_KEY?.trim() ?? ''
    const operatorAddress = new ethers.Wallet(
      operatorKey.startsWith('0x') ? operatorKey : `0x${operatorKey}`
    ).address
    return recovered.toLowerCase() === operatorAddress.toLowerCase()
  } catch {
    return false
  }
}
