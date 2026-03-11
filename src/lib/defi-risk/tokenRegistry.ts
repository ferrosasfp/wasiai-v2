/**
 * Token Registry — known tokens on Avalanche Fuji (testnet) and Mainnet
 * Supports symbol, name, partial name, raw address, and free-text resolution.
 */

export interface TokenInfo {
  address: string          // ERC-20 address (or WAVAX for native AVAX)
  chainlinkFeed?: string   // Chainlink AggregatorV3 feed address
  name: string
  symbol: string
}

// ── Fuji Testnet (chain 43113) ────────────────────────────────────────────────
const FUJI_TOKENS: TokenInfo[] = [
  {
    symbol: 'AVAX',
    name:   'Avalanche',
    address:       '0xd00ae08403B9bbb9124bB305C09058E32C39A48c',
    chainlinkFeed: '0x5498BB86BC934c8D34FDA08E81D444153d0D06aD',
  },
  {
    symbol: 'USDC',
    name:   'USD Coin',
    address:       '0x5425890298aed601595a70AB815c96711a31Bc65',
    chainlinkFeed: '0x7898AcCC83587C3C55116c5230C17a6Cd9C71bad',
  },
]

// ── Mainnet (chain 43114) ─────────────────────────────────────────────────────
const MAINNET_TOKENS: TokenInfo[] = [
  {
    symbol: 'AVAX',
    name:   'Avalanche',
    address:       '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
    chainlinkFeed: '0x0A77230d17318075983913bC2145DB16C7366156',
  },
  {
    symbol: 'USDC',
    name:   'USD Coin',
    address:       '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    chainlinkFeed: '0xF096872672F44d6EBA71527d2623Ba88ecc3ef1',
  },
  {
    symbol: 'USDT',
    name:   'Tether USD',
    address:       '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
    chainlinkFeed: '0xEBE676ee90Fe1112671f19b6B7459bC678B67e8',
  },
  {
    symbol: 'WBTC',
    name:   'Bitcoin',
    address:       '0x152b9d0FdC40C096757F570A51E494bd4b943E50',
    chainlinkFeed: '0x2779D32d5166BAaa2B2b658333bA7e6Ec0C65743',
  },
  {
    symbol: 'WETH',
    name:   'Ethereum',
    address:       '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB',
    chainlinkFeed: '0x976B3D034E162d8bD72D6b9C989d545b839003b0',
  },
  {
    symbol: 'LINK',
    name:   'Chainlink',
    address:       '0x5947BB275c521040051D82396192181b413227A3',
    chainlinkFeed: '0x49ccd9ca821EfEab2b98c60DC60F518E765ede9a',
  },
  {
    symbol: 'JOE',
    name:   'Trader Joe',
    address:       '0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd',
  },
  {
    symbol: 'PNG',
    name:   'Pangolin',
    address:       '0x60781C2586D68229fde47564546784ab3fACA982',
  },
  {
    symbol: 'QI',
    name:   'BENQI',
    address:       '0x8729438EB15e2C8B576fCc6AeCdA6A148776C0F5',
  },
]

/** Extra aliases for partial/natural-language matching */
const ALIASES: Record<string, string> = {
  wavax:      'AVAX',
  avalanche:  'AVAX',
  avax:       'AVAX',
  bitcoin:    'WBTC',
  btc:        'WBTC',
  'btc.b':    'WBTC',
  ethereum:   'WETH',
  eth:        'WETH',
  ether:      'WETH',
  usdt:       'USDT',
  tether:     'USDT',
  usdc:       'USDC',
  'usd coin': 'USDC',
  link:       'LINK',
  chainlink:  'LINK',
  joe:        'JOE',
  'trader joe': 'JOE',
  traderjoe:  'JOE',
  png:        'PNG',
  pangolin:   'PNG',
  qi:         'QI',
  benqi:      'QI',
}

/** Get the active chain ID from env (defaults to Fuji 43113) */
export function getActiveChainId(): number {
  const raw = process.env.NEXT_PUBLIC_CHAIN_ID
  return raw ? parseInt(raw, 10) : 43113
}

/** Return the token list for the given chain */
export function getTokenList(chainId?: number): TokenInfo[] {
  const id = chainId ?? getActiveChainId()
  return id === 43114 ? MAINNET_TOKENS : FUJI_TOKENS
}

/**
 * Resolve a free-form input (symbol, name, address, or natural-language text)
 * to a TokenInfo, or null if unrecognized.
 *
 * Examples:
 *   resolveToken("AVAX")              → AVAX TokenInfo
 *   resolveToken("precio de AVAX")    → AVAX TokenInfo
 *   resolveToken("analyze joe token") → JOE TokenInfo
 *   resolveToken("0x5425...")         → USDC TokenInfo (by address) or pass-through
 */
export function resolveToken(input: string, chainId?: number): TokenInfo | null {
  const tokens = getTokenList(chainId)
  const raw = input.trim()

  // 1. Raw address pass-through: find in registry or return a stub
  if (/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    const byAddr = tokens.find(t => t.address.toLowerCase() === raw.toLowerCase())
    return byAddr ?? null  // null = unknown address (caller keeps it as-is)
  }

  const lower = raw.toLowerCase()

  // 2. Direct symbol match (case-insensitive)
  const bySymbol = tokens.find(t => t.symbol.toLowerCase() === lower)
  if (bySymbol) return bySymbol

  // 3. Alias match
  const canonicalSymbol = ALIASES[lower]
  if (canonicalSymbol) {
    const byAlias = tokens.find(t => t.symbol === canonicalSymbol)
    if (byAlias) return byAlias
  }

  // 4. Partial name match
  const byName = tokens.find(t => t.name.toLowerCase().includes(lower))
  if (byName) return byName

  // 5. Scan free text: look for any known symbol or alias word
  const words = lower.split(/[\s,._-]+/)
  for (const word of words) {
    const sym = ALIASES[word] ?? word.toUpperCase()
    const match = tokens.find(t => t.symbol === sym)
    if (match) return match
  }

  return null
}

/**
 * Like resolveToken but returns address string directly.
 * If the input is already a valid 0x address (not in registry), returns it as-is.
 * Returns null only if completely unresolvable.
 */
export function resolveTokenAddress(input: string, chainId?: number): string | null {
  const raw = input.trim()
  if (/^0x[0-9a-fA-F]{40}$/.test(raw)) return raw  // pass-through unknown addresses
  const info = resolveToken(raw, chainId)
  return info ? info.address : null
}
