# Build Report — WAS-188: Reputación con ponderación diferenciada

**Status:** ✅ DONE  
**Commit:** `447a28087`  
**Branch:** `main`  
**Fecha:** 2026-03-15  

---

## Cambios implementados

### Archivo modificado
`src/app/api/v1/agents/[slug]/reputation/route.ts`

### 1. `calcScore()` — nueva firma y ponderación
- **Antes:** `(errorRate7d, p95Ms, disputeRate, isVerified) → number`
- **Ahora:** `(..., reputationScore, paidRatio, totalCalls) → { score, signalWeights }`

Nuevos pesos:
| Componente | Antes | Ahora |
|-----------|-------|-------|
| Error rate | 40% | 35% |
| Latency | 30% | 25% |
| Dispute | 20% | 20% |
| Verified | 10% | 10% |
| Votes weighted | — | 10% (**nuevo**) |

### 2. votesComponent (nuevo)
```typescript
const votesBoost = totalCalls >= 5 && paidRatio > 0.5 ? 1.2 : 1.0
const votesComponent = Math.min(10, (reputationScore ?? 0.5) * 10 * votesBoost)
```
- `totalCalls < 5` → `votesBoost = 1.0` (no penalizar agentes nuevos)
- `paidRatio > 0.5` → `votesBoost = 1.2` (boost por mayoría de pagos reales)
- `reputation_score` (raw 0-1) **NO se modifica**

### 3. Query adicional `agent_calls` (últimos 30 días)
```sql
SELECT payment_type, is_trial
FROM agent_calls
WHERE agent_id = ? AND called_at >= NOW() - INTERVAL '30 days'
-- uses idx_agent_calls_agent_called_at
```
- Usa `called_at` (columna correcta) — `created_at` no existe en `agent_calls`

### 4. Fixes adicionales (columna `called_at`)
- `calcTrend()`: corregido `.select('status, called_at')` y filtros `.gte('called_at', ...)`
- `lastCall` query: corregido `.select('called_at')`, `.order('called_at', ...)`, response usa `lastCall?.called_at`

### 5. Response — campo nuevo
```json
{
  "signal_weights": {
    "paid_ratio": 0.85,
    "votes_boost": 1.2,
    "model": "v2-weighted"
  }
}
```

---

## Verificación
- ✅ `tsc --noEmit` — 0 errores
- ✅ `reputation_score` intacto (fuente on-chain)
- ✅ `performance_score` no tocado
- ✅ `submitReputationBatch` no tocado
- ✅ Suma de pesos = 100% (35+25+20+10+10)
- ✅ `called_at` en todos los queries a `agent_calls`

---

## Constraints cumplidos
- ❌ NO git push
- ✅ NO se modifica `reputation_score`
- ✅ NO se modifica `performance_score`
- ✅ NO se toca `submitReputationBatch`
- ✅ totalCalls < 5 → votesBoost = 1.0
- ✅ Query usa `called_at` (idx `idx_agent_calls_agent_called_at`)
