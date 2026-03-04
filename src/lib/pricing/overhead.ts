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

export interface OverheadResult {
  overhead:       number   // = gasFee (lo que se suma al creatorPrice)
  breakdown:      { gas: number }
  circuitBreaker: boolean
  cached:         boolean
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
      }
    }
  } catch { /* cache miss — continuar */ }

  // 2. Calcular con timeout 2s — FAIL-OPEN si falla
  try {
    const gas = await Promise.race([
      _calcGasFee(),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('gas timeout')), 2000)
      ),
    ])
    if (gas === null) throw new Error('timeout')

    try { await getSharedRedis().set(CACHE_KEY, gas, { ex: CACHE_TTL }) } catch { /* ignorar */ }

    return {
      overhead:       gas,
      breakdown:      { gas },
      circuitBreaker: gas > creatorPrice,
      cached:         false,
    }
  } catch {
    // FAIL-OPEN: si Chainlink falla, gas = 0
    // El usuario paga solo el precio del creator — nunca se bloquea una invocación
    return {
      overhead:       0,
      breakdown:      { gas: 0 },
      circuitBreaker: false,
      cached:         false,
    }
  }
}

async function _calcGasFee(): Promise<number> {
  const client = getPublicClient()
  const [gasPrice, chainlinkResult] = await Promise.all([
    client.getGasPrice(),
    readChainlinkFeed(process.env.CHAINLINK_AVAX_USD_FEED!),
  ])
  const avaxUsd     = chainlinkResult.price_usd
  const GAS_UNITS   = 80_000n
  const gasCostAvax = Number(gasPrice * GAS_UNITS) / 1e18
  return Math.round(gasCostAvax * avaxUsd * 1_000_000) / 1_000_000
}
