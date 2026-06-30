export const FUJI_CHAIN_ID = 43113 as const

export const USDC_FUJI_ADDRESS = '0x5425890298aed601595a70AB815c96711a31Bc65' as `0x${string}`

const _rawOperator = process.env.NEXT_PUBLIC_WASIAI_OPERATOR
if (!_rawOperator || !/^0x[0-9a-fA-F]{40}$/.test(_rawOperator)) {
  // En runtime (browser o server) lanzar advertencia; en build time puede ser undefined
  if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
    console.warn('[WasiAI] NEXT_PUBLIC_WASIAI_OPERATOR no configurado o inválido. Los pagos fallarán.')
  }
}
export const WASIAI_OPERATOR_ADDRESS = (_rawOperator ?? '0xf432baf1315ccDB23E683B95b03fD54Dd3e447Ba') as `0x${string}`

// C-2 (audit 2026-06-30): the hardcoded WASIAI_MARKETPLACE_ADDRESS export was a
// stale, dead constant (no importers) that risked masking the env-resolved
// address. Removed. Use getMarketplaceAddress(chainId) from
// '@/lib/contracts/WasiAIMarketplace' (env-resolved) instead.

export const USDC_EIP712_CONFIG = {
  name: 'USD Coin',
  version: '2',
} as const

export const FUJI_CHAIN_PARAMS = {
  chainId:             '0xA869' as string,   // 43113 en hex
  chainName:           'Avalanche Fuji Testnet',
  nativeCurrency:      { name: 'AVAX', symbol: 'AVAX', decimals: 18 as number },
  rpcUrls:             ['https://api.avax-test.network/ext/bc/C/rpc'] as string[],
  blockExplorerUrls:   ['https://testnet.snowtrace.io/'] as string[],
}
