import { getPublicClient }   from '@/shared/lib/web3/client'
import { readChainlinkFeed } from '@/lib/defi-risk/chainlink'
import { getSharedRedis }    from '@/lib/ratelimit'

const CACHE_KEY = 'wasiai:overhead:cache'
const CACHE_TTL = 60  // segundos

export interface OverheadResult {
  overhead:        number
  breakdown:       { gas: number; inference: number; buffer: number }
  circuitBreaker:  boolean
  cached:          boolean
}

export async function calcPlatformOverhead(creatorPrice: number): Promise<OverheadResult> {
  // 1. Intentar cache Redis (TTL 60s — evita 2 calls on-chain por request)
  try {
    const cached = await getSharedRedis().get<OverheadResult>(CACHE_KEY)
    if (cached) {
      return {
        ...cached,
        circuitBreaker: cached.overhead > creatorPrice,
        cached: true,
      }
    }
  } catch { /* cache miss — continuar */ }

  // 2. Calcular con timeout de 2s — FAIL-OPEN si falla
  try {
    const result = await Promise.race([
      _calculate(),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('overhead timeout')), 2000)
      ),
    ])
    if (!result) throw new Error('timeout')

    // 3. Cachear en Redis
    try {
      await getSharedRedis().set(CACHE_KEY, result, { ex: CACHE_TTL })
    } catch { /* cache write falla — no bloquear */ }

    return { ...result, circuitBreaker: result.overhead > creatorPrice, cached: false }
  } catch {
    // FAIL-OPEN: si Chainlink o gasPrice fallan, usar INFERENCE_COST como piso mínimo
    // Nunca retornar 0 — el overhead siempre existe aunque no podamos calcular gas
    const inferenceFloor = Number(process.env.INFERENCE_COST_USDC ?? '0.001')
    const overhead       = Math.round(inferenceFloor * 1.20 * 1_000_000) / 1_000_000
    return {
      overhead,
      breakdown:      { gas: 0, inference: inferenceFloor, buffer: inferenceFloor * 0.20 },
      circuitBreaker: false,
      cached:         false,
    }
  }
}

async function _calculate(): Promise<Omit<OverheadResult, 'circuitBreaker' | 'cached'>> {
  const client = getPublicClient()

  const [gasPrice, chainlinkResult] = await Promise.all([
    client.getGasPrice(),
    readChainlinkFeed(process.env.CHAINLINK_AVAX_USD_FEED!),
  ])

  // ChainlinkResult uses price_usd (not currentPrice)
  const avaxUsd   = chainlinkResult.price_usd
  const GAS_UNITS = 80_000n
  const gasCostAvax = Number(gasPrice * GAS_UNITS) / 1e18
  const gasCostUsdc = gasCostAvax * avaxUsd

  const INFERENCE_COST = Number(process.env.INFERENCE_COST_USDC ?? '0.001')
  const base   = gasCostUsdc + INFERENCE_COST
  const buffer = base * 0.20

  return {
    overhead:  Math.round((base + buffer) * 1_000_000) / 1_000_000,
    breakdown: { gas: gasCostUsdc, inference: INFERENCE_COST, buffer },
  }
}
