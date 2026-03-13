import { type NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { checkRateLimit, getIdentifier, getSharedRedis } from '@/lib/ratelimit'
import { Ratelimit } from '@upstash/ratelimit'

export const revalidate = 60

// NG-108: Rate limiting — 30 req/min por IP para endpoint público
let _statsLimit: Ratelimit | null = null
function getStatsLimit() {
  return _statsLimit ??= new Ratelimit({
    redis: getSharedRedis(),
    limiter: Ratelimit.slidingWindow(30, '1 m'),
    prefix: 'rl:stats',
  })
}

export async function GET(request: NextRequest) {
  // NG-108: Rate limiting
  const rlHit = await checkRateLimit(getStatsLimit(), getIdentifier(request))
  if (rlHit) return rlHit

  try {
    // WAS-132: recordInvocationOnChain() fue eliminado — el contrato siempre retorna 0.
    // Fuente de verdad: agent_keys.spent_usdc (volume) y pipeline_executions (invocations).
    const supabase = createServiceClient()

    const [volumeRes, invocationsRes] = await Promise.all([
      // Volume = suma de spent_usdc en todas las keys activas
      supabase
        .from('agent_keys')
        .select('spent_usdc')
        .eq('is_active', true),

      // Invocations = total de pipelines ejecutados
      supabase
        .from('pipeline_executions')
        .select('id', { count: 'exact', head: true }),
    ])

    const totalVolume = (volumeRes.data ?? []).reduce(
      (acc, row) => acc + (row.spent_usdc ?? 0),
      0,
    )

    const totalInvocations = invocationsRes.count ?? 0

    return NextResponse.json({
      volume:      parseFloat(totalVolume.toFixed(6)),
      invocations: totalInvocations,
      feePercent:  10,  // 10% platform fee (hardcoded — no cambia sin governance)
    })
  } catch {
    return NextResponse.json({ volume: null, invocations: null, feePercent: null })
  }
}
