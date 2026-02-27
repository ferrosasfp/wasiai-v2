import { createConfig, http } from 'wagmi'
import { injected, coinbaseWallet } from 'wagmi/connectors'
import { supportedChains, defaultChain } from './chains'

export const wagmiConfig = createConfig({
  chains: supportedChains,
  ssr: true, // Prevents wagmi hydration mismatches in Next.js App Router
  multiInjectedProviderDiscovery: true, // EIP-6963: discover each wallet separately
  connectors: [
    injected(),                              // Core, Rabby, etc.
    injected({ target: 'metaMask' }),        // MetaMask explícito
    coinbaseWallet({ appName: 'WasiAI' }),   // Coinbase Wallet
  ],
  transports: Object.fromEntries(
    supportedChains.map((chain) => [
      chain.id,
      http(
        chain.id === defaultChain.id
          ? (process.env.NEXT_PUBLIC_RPC_TESTNET || undefined)
          : (process.env.NEXT_PUBLIC_RPC_MAINNET || undefined)
      ),
    ])
  ) as Record<number, ReturnType<typeof http>>,
})
