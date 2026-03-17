import { recoverTypedDataAddress } from 'viem'
import { Redis } from '@upstash/redis'

let _redis: Redis | null = null
function getRedis(): Redis {
  return _redis ??= new Redis({
    url:   process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
}

// NA-010: usar WASIAI_OWNER_ADDRESS (server-only) para el check de autorización.
// NA-003 Parte A: NEXT_PUBLIC_OPERATOR_ADDRESS eliminado — operador NO tiene privilegios admin.
// NA-003 Parte B (Mainnet/Sprint 20): migrar WASIAI_OWNER_ADDRESS a Safe multisig 2-de-3.
const ALLOWED_ADDRESSES = [
  process.env.WASIAI_OWNER_ADDRESS,
].map(a => a?.toLowerCase()).filter(Boolean) as string[]

export const ADMIN_EIP712_DOMAIN = {
  name:    'WasiAI Admin',
  version: '1',
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113),
} as const

export const ADMIN_EIP712_TYPES = {
  AdminAction: [
    { name: 'action',    type: 'string'  },
    { name: 'nonce',     type: 'bytes32' },
    { name: 'timestamp', type: 'uint256' },
  ],
} as const

export interface AdminActionMessage {
  action:    string
  nonce:     `0x${string}`
  timestamp: bigint
}

/**
 * Verifica una firma EIP-712 de acción admin.
 * Retorna { ok: true } si es válida, { ok: false, reason } si no.
 */
export async function verifyAdminSignature(
  signature: `0x${string}`,
  message:   AdminActionMessage,
): Promise<{ ok: boolean; reason?: string }> {
  // Anti-replay: timestamp no puede tener más de 5 minutos
  const now       = BigInt(Math.floor(Date.now() / 1000))
  const MAX_AGE   = 300n // 5 minutos
  if (now - message.timestamp > MAX_AGE) {
    return { ok: false, reason: 'signature_expired' }
  }

  try {
    const recovered = await recoverTypedDataAddress({
      domain:     ADMIN_EIP712_DOMAIN,
      types:      ADMIN_EIP712_TYPES,
      primaryType: 'AdminAction',
      message,
      signature,
    })

    if (!ALLOWED_ADDRESSES.includes(recovered.toLowerCase())) {
      return { ok: false, reason: 'not_authorized' }
    }

    const nonceKey = `admin-nonce:${message.nonce}`
    const existing = await getRedis().get(nonceKey)
    if (existing) {
      return { ok: false, reason: 'nonce_already_used' }
    }
    await getRedis().set(nonceKey, '1', { ex: 360 }) // 6 min TTL

    return { ok: true }
  } catch {
    return { ok: false, reason: 'invalid_signature' }
  }
}
