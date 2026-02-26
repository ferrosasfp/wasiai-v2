import { createWalletClient, createPublicClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { avalancheFuji } from 'viem/chains'

export interface WalletConfig {
  privateKey: `0x${string}`
  rpcUrl: string
  chainId: number
}

export function initWallet(cfg: WalletConfig) {
  // Normaliza el private key — acepta con o sin 0x prefix
  const pk = cfg.privateKey.startsWith('0x')
    ? cfg.privateKey
    : (`0x${cfg.privateKey}` as `0x${string}`)

  const account = privateKeyToAccount(pk)

  if (cfg.chainId !== avalancheFuji.id) {
    throw new Error(`chainId ${cfg.chainId} no coincide con avalancheFuji (${avalancheFuji.id})`)
  }

  const walletClient = createWalletClient({
    account,
    chain: avalancheFuji,
    transport: http(cfg.rpcUrl),
  })

  const publicClient = createPublicClient({
    chain: avalancheFuji,
    transport: http(cfg.rpcUrl),
  })

  return {
    walletClient,
    publicClient,
    account,
    agentAddress: account.address,
  }
}
