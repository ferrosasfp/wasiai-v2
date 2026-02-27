// src/lib/reputation.ts
// HU-4.4: Métricas de reputación calculadas desde agent_calls reales
// ⚠️ CRÍTICO: Usa 'called_at' (no 'created_at') para el filtro de 24h
// Columnas permitidas: status ('success'|'error'), latency_ms, is_trial, called_at
// Columnas PROHIBIDAS: duration_ms, status_code (no existen en el schema)
import { unstable_cache } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'

export interface ReputationData {
  uptimePct: number | null
  p50Ms: number | null
  p95Ms: number | null
  errorRatePct: number | null
  totalCalls: number
  hasData: boolean
  sufficientData: boolean
  usingFallback: boolean
}

const MIN_CALLS_THRESHOLD = 10

/**
 * Retorna métricas de reputación calculadas desde agent_calls.
 * Cache de 1 hora por agentId (revalidate: 3600).
 *
 * PERCENTILE_CONT disponible en staging (verificado AC-12) → función RPC activa.
 * Si la RPC falla, cae al fallback AVG(latency_ms).
 */
export const getAgentReputation = unstable_cache(
  async (agentId: string): Promise<ReputationData> => {
    const supabase = createServiceClient()

    // ── INTENTO 1: PERCENTILE_CONT via RPC ──────────────────────────────────
    try {
      const { data, error } = await supabase.rpc('get_agent_reputation_percentile', {
        p_agent_id: agentId,
      })

      if (!error && data) {
        const row = Array.isArray(data) ? data[0] : data
        const totalCalls = Number(row?.total_calls ?? 0)

        return {
          uptimePct:     totalCalls > 0 ? Number(row.uptime_pct ?? null) : null,
          p50Ms:         totalCalls > 0 ? Number(row.p50_ms ?? null) : null,
          p95Ms:         totalCalls > 0 ? Number(row.p95_ms ?? null) : null,
          errorRatePct:  totalCalls > 0 ? Number(row.error_rate_pct ?? null) : null,
          totalCalls,
          hasData:        totalCalls > 0,
          sufficientData: totalCalls >= MIN_CALLS_THRESHOLD,
          usingFallback:  false,
        }
      }
    } catch {
      // PERCENTILE_CONT no disponible o RPC no existe → fallback
    }

    // ── FALLBACK: AVG(latency_ms) ────────────────────────────────────────────
    // ⚠️ CRÍTICO: filtrar por called_at (NO created_at)
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const { data: rows, error } = await supabase
      .from('agent_calls')
      .select('status, latency_ms')
      .eq('agent_id', agentId)
      .eq('is_trial', false)
      .gte('called_at', cutoff)    // ← called_at, NO created_at

    if (error || !rows) {
      return {
        uptimePct: null, p50Ms: null, p95Ms: null, errorRatePct: null,
        totalCalls: 0, hasData: false, sufficientData: false, usingFallback: true,
      }
    }

    const totalCalls = rows.length
    if (totalCalls === 0) {
      return {
        uptimePct: null, p50Ms: null, p95Ms: null, errorRatePct: null,
        totalCalls: 0, hasData: false, sufficientData: false, usingFallback: true,
      }
    }

    const successCount = rows.filter(r => r.status === 'success').length
    const errorCount   = rows.filter(r => r.status === 'error').length
    const latencies    = rows.map(r => r.latency_ms).filter((v): v is number => v !== null)
    const avgLatency   = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : null

    return {
      uptimePct:     (successCount / totalCalls) * 100,
      p50Ms:         avgLatency,    // aprox: promedio, no mediana real
      p95Ms:         null,          // no calculable sin PERCENTILE_CONT
      errorRatePct:  (errorCount / totalCalls) * 100,
      totalCalls,
      hasData:        totalCalls > 0,
      sufficientData: totalCalls >= MIN_CALLS_THRESHOLD,
      usingFallback:  true,
    }
  },
  ['agent-reputation'],
  { revalidate: 3600 }   // 1 hora de cache
)
