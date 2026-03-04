/**
 * agentWallet.ts — Self-custody wallets para agentes en Avalanche Fuji
 *
 * WAS-71 Fase 1: generate + store + address lookup
 * Fase 2 (Sprint 16): pagos autónomos agente→agente
 *
 * SEGURIDAD:
 * - Private key cifrada con AES-256-GCM (AGENT_WALLET_ENCRYPTION_KEY)
 * - NUNCA serializada fuera de getAgentWalletClient()
 * - Solo acceso via service role (RLS USING false en agent_wallets)
 */
import crypto from 'crypto'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createWalletClient, createPublicClient, http, formatEther } from 'viem'
import { avalancheFuji } from 'viem/chains'
import { createServiceClient } from '@/lib/supabase/service'

// ── Fail-fast en startup ──────────────────────────────────────────────────────
const KEY_HEX = process.env.AGENT_WALLET_ENCRYPTION_KEY
if (!KEY_HEX || KEY_HEX.length !== 64) {
  throw new Error(
    '[AgentWallet] AGENT_WALLET_ENCRYPTION_KEY must be set and 64 hex chars (32 bytes). ' +
    'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  )
}
const ENCRYPTION_KEY = Buffer.from(KEY_HEX, 'hex')

// ── Crypto helpers ────────────────────────────────────────────────────────────
function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

function decrypt(b64: string): string {
  const buf = Buffer.from(b64, 'base64')
  const iv  = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const ct  = buf.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv)
  decipher.setAuthTag(tag)
  return decipher.update(ct).toString('utf8') + decipher.final('utf8')
}

// ── Public client Fuji ────────────────────────────────────────────────────────
const publicClient = createPublicClient({
  chain: avalancheFuji,
  transport: http('https://api.avax-test.network/ext/bc/C/rpc'),
})

// ── Core functions ────────────────────────────────────────────────────────────

/**
 * Genera keypair, cifra private key, persiste en agent_wallets.
 * Idempotente: si ya existe, retorna address existente.
 */
export async function generateAgentWallet(
  agentId: string
): Promise<{ address: string }> {
  const supabase = createServiceClient()

  // Idempotencia: check si ya existe
  const { data: existing } = await supabase
    .from('agent_wallets')
    .select('wallet_address')
    .eq('agent_id', agentId)
    .single()

  if (existing) {
    return { address: existing.wallet_address }
  }

  // Generar keypair
  const privateKey = generatePrivateKey()            // `0x${string}`
  const account    = privateKeyToAccount(privateKey)
  const address    = account.address

  // Cifrar
  const encryptedPrivateKey = encrypt(privateKey)

  // Persistir
  const { error } = await supabase.from('agent_wallets').insert({
    agent_id:              agentId,
    encrypted_private_key: encryptedPrivateKey,
    wallet_address:        address,
  })

  if (error) {
    // Race condition: otro request insertó primero → retornar existente
    if (error.code === '23505') {
      const { data: race } = await supabase
        .from('agent_wallets')
        .select('wallet_address')
        .eq('agent_id', agentId)
        .single()
      return { address: race!.wallet_address }
    }
    throw new Error(`[AgentWallet] Failed to persist wallet: ${error.message}`)
  }

  return { address }
}

/**
 * Retorna address de la wallet del agente sin descifrar nada.
 * Retorna null si el agente no tiene wallet.
 */
export async function getAgentWalletAddress(
  agentId: string
): Promise<string | null> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('agent_wallets')
    .select('wallet_address')
    .eq('agent_id', agentId)
    .single()
  return data?.wallet_address ?? null
}

/**
 * Retorna balance AVAX nativo en Fuji (wei como string).
 * Balance 0 retorna "0", no lanza error.
 */
export async function getAgentWalletBalance(
  address: string
): Promise<{ balanceWei: string; balanceFormatted: string }> {
  try {
    const bal = await publicClient.getBalance({ address: address as `0x${string}` })
    return {
      balanceWei:       bal.toString(),
      balanceFormatted: formatEther(bal),
    }
  } catch {
    return { balanceWei: '0', balanceFormatted: '0' }
  }
}

/**
 * Descifra private key en memoria y retorna WalletClient de viem.
 * La private key NUNCA sale de esta función.
 * Para uso en Sprint 16 (pagos autónomos) — ya disponible en Fase 1.
 */
export async function getAgentWalletClient(agentId: string) {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('agent_wallets')
    .select('encrypted_private_key')
    .eq('agent_id', agentId)
    .single()

  if (error || !data) {
    throw new Error(`[AgentWallet] No wallet found for agent ${agentId}`)
  }

  const privateKey = decrypt(data.encrypted_private_key) as `0x${string}`
  const account    = privateKeyToAccount(privateKey)

  return createWalletClient({
    account,
    chain:     avalancheFuji,
    transport: http('https://api.avax-test.network/ext/bc/C/rpc'),
  })
}

/**
 * Lee el balance USDC de la wallet del agente.
 * USDC Fuji: 0x5425890298aed601595a70AB815c96711a31Bc65
 * USDC Mainnet: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
 */
const USDC_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs:  [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

// CHAIN_ID: usar variable de servidor; fallback a Fuji (43113)
const CHAIN_ID   = Number(process.env.CHAIN_ID ?? process.env.NEXT_PUBLIC_CHAIN_ID ?? 43113)
const USDC_ADDR  = CHAIN_ID === 43114
  ? '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E' as const
  : '0x5425890298aed601595a70AB815c96711a31Bc65' as const

export async function getAgentWalletUsdcBalance(
  address: string,
): Promise<{ balanceUsdc: string; balanceUsdcFormatted: string }> {
  try {
    const raw = await publicClient.readContract({
      address:      USDC_ADDR,
      abi:          USDC_ABI,
      functionName: 'balanceOf',
      args:         [address as `0x${string}`],
    })
    const formatted = (Number(raw) / 1_000_000).toFixed(2)
    return { balanceUsdc: raw.toString(), balanceUsdcFormatted: formatted }
  } catch {
    return { balanceUsdc: '0', balanceUsdcFormatted: '0.00' }
  }
}
