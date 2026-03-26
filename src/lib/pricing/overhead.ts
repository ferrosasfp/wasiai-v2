/**
 * overhead.ts — Calcula el costo de gas on-chain por invocación
 *
 * Modelo económico WasiAI:
 *   - El usuario paga: creatorPrice + gasFee
 *   - El 10% de platform fee es INTERNO (WasiAI retiene del pago al creator)
 *   - WasiAI NO cobra por inferencia — eso es costo del creator
 *   - El gas (AVAX) lo cubre WasiAI operationally, pero se le traslada al usuario en USDC
 *
 * gasFee = costo real on-chain (Chainlink AVAX/USD × 80k gas units)
 */
import { readChainlinkFeed } from '@/lib/defi-risk/chainlink'
import { getSharedRedis }    from '@/lib/ratelimit'
import { getPublicClient }   from '@/shared/lib/web3/client'

const CACHE_KEY = 'wasiai:gas:v1'
const CACHE_TTL = 60  // segundos

export type GasSource = 'redis' | 'chainlink' | 'coingecko' | 'env_fallback' | 'none'

export interface OverheadResult {
  overhead:       number   // = gasFee (lo que se suma al creatorPrice)
  breakdown:      { gas: number }
  circuitBreaker: boolean
  cached:         boolean
  gas_source:     GasSource    // ← NEW
}

export async function calcPlatformOverhead(creatorPrice: number): Promise<OverheadResult> {
  // 1. Cache Redis (TTL 60s — evita calls on-chain por cada request)
  try {
    const cached = await getSharedRedis().get<number>(CACHE_KEY)
    if (cached !== null && cached !== undefined) {
      return {
        overhead:       cached,
        breakdown:      { gas: cached },
        circuitBreaker: cached > creatorPrice,
        cached:         true,
        gas_source:     'redis',
      }
    }
  } catch { /* cache miss — continuar */ }

  // 2. Calcular con timeout 2s — FAIL-OPEN si falla
  try {
    const result = await Promise.race([
      _calcGasFee(),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('gas timeout')), 2000)
      ),
    ])
    if (result === null) throw new Error('timeout')
    const { gas, source } = result as { gas: number; source: GasSource }

    try { await getSharedRedis().set(CACHE_KEY, gas, { ex: CACHE_TTL }) } catch { /* ignorar */ }

    return {
      overhead:       gas,
      breakdown:      { gas },
      circuitBreaker: gas > creatorPrice,
      cached:         false,
      gas_source:     source,
    }
  } catch {
    // FAIL-OPEN: si Chainlink falla, gas = 0
    // El usuario paga solo el precio del creator — nunca se bloquea una invocación
    return {
      overhead:       0,
      breakdown:      { gas: 0 },
      circuitBreaker: false,
      cached:         false,
      gas_source:     'none',
    }
  }
}

const GAS_UNITS = 80_000n

async function _calcGasFee(): Promise<{ gas: number; source: GasSource }> {
  const client = getPublicClient()

  const [gasPrice, avaxResult] = await Promise.all([
    client.getGasPrice(),
    _getAvaxUsd(),
  ])

  const gasCostAvax = Number(gasPrice * GAS_UNITS) / 1e18
  const gas = Math.round(gasCostAvax * avaxResult.price * 1_000_000) / 1_000_000
  return { gas, source: avaxResult.source }
}

/**
 * Obtiene precio AVAX/USD.
 * 1. Chainlink on-chain (confiable en mainnet)
 * 2. CoinGecko free API (fallback — funciona en testnet)
 * 3. Env var AVAX_USD_FALLBACK (último recurso)
 */
async function _getAvaxUsd(): Promise<{ price: number; source: GasSource }> {
  // Intento 1: Chainlink
  if (process.env.CHAINLINK_AVAX_USD_FEED) {
    try {
      const result = await readChainlinkFeed(process.env.CHAINLINK_AVAX_USD_FEED)
      if (result.price_usd > 0) return { price: result.price_usd, source: 'chainlink' }
    } catch { /* fallback */ }
  }

  // Intento 2: CoinGecko free API
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=avalanche-2&vs_currencies=usd',
      { next: { revalidate: 60 } },
    )
    if (res.ok) {
      const data = await res.json() as { 'avalanche-2'?: { usd?: number } }
      const price = data['avalanche-2']?.usd
      if (price && price > 0) return { price, source: 'coingecko' }
    }
  } catch { /* fallback */ }

  // Intento 3: env var configurada manualmente
  const fallback = Number(process.env.AVAX_USD_FALLBACK ?? '0')
  if (fallback > 0) return { price: fallback, source: 'env_fallback' }

  throw new Error('No AVAX/USD price available')
}

export async function getCachedGasOverhead(): Promise<{ overhead: number; gas_source: GasSource } | null> {
  try {
    const cached = await getSharedRedis().get<number>(CACHE_KEY)
    if (cached !== null && cached !== undefined) {
      return { overhead: cached, gas_source: 'redis' }
    }
  } catch { /* miss */ }
  return null
}
