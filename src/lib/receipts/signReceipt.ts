import { privateKeyToAccount } from 'viem/accounts'
import { keccak256, encodePacked, toBytes } from 'viem'
import { recoverMessageAddress } from 'viem'

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
 *
 * HAL-010: Migrado de ethers → viem
 */
export async function signReceipt(receipt: CallReceipt): Promise<string> {
  const operatorKey = process.env.OPERATOR_PRIVATE_KEY?.trim()
  if (!operatorKey) throw new Error('OPERATOR_PRIVATE_KEY not set')

  const key = operatorKey.startsWith('0x') ? operatorKey : `0x${operatorKey}`
  const account = privateKeyToAccount(key as `0x${string}`)

  const message = keccak256(encodePacked(
    ['bytes32', 'string', 'string', 'uint256', 'uint256'],
    [
      receipt.keyId as `0x${string}`,
      receipt.callId,
      receipt.agentSlug,
      BigInt(Math.round(receipt.amountUsdc * 1_000_000)), // atomic USDC
      BigInt(receipt.timestamp),
    ]
  ))

  return account.signMessage({ message: { raw: toBytes(message) } })
}

/**
 * Verifica un recibo criptográfico.
 * Útil para el endpoint público de auditoría y para tests.
 *
 * @returns true si la firma es del operador configurado
 *
 * HAL-010: Migrado de ethers → viem
 */
export async function verifyReceipt(receipt: CallReceipt, signature: string): Promise<boolean> {
  try {
    const message = keccak256(encodePacked(
      ['bytes32', 'string', 'string', 'uint256', 'uint256'],
      [
        receipt.keyId as `0x${string}`,
        receipt.callId,
        receipt.agentSlug,
        BigInt(Math.round(receipt.amountUsdc * 1_000_000)),
        BigInt(receipt.timestamp),
      ]
    ))

    const recovered = await recoverMessageAddress({
      message: { raw: toBytes(message) },
      signature: signature as `0x${string}`,
    })

    const operatorKey = process.env.OPERATOR_PRIVATE_KEY?.trim() ?? ''
    const key = operatorKey.startsWith('0x') ? operatorKey : `0x${operatorKey}`
    const account = privateKeyToAccount(key as `0x${string}`)

    return recovered.toLowerCase() === account.address.toLowerCase()
  } catch {
    return false
  }
}
