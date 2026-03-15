# SDD #S7-06: WAS-188 — Reputación con ponderación diferenciada

> SPEC_APPROVED: no
> Fecha: 2026-03-15
> Tipo: improvement
> SDD_MODE: full
> Branch: feat/s7-06-reputation-weighted

## 1. Resumen
El score de reputación actual trata todos los votos igual. Un voto de un usuario que pagó 50 veces vale lo mismo que uno de alguien que usó el sandbox gratis una vez. Este SDD introduce pesos diferenciados por tipo de señal en `calcScore()` en `/reputation/route.ts`, sin tocar el campo `reputation_score` (votos raw) que es fuente de verdad on-chain.

## 2. Work Item
| Campo | Valor |
|-------|-------|
| **#** | S7-06 / WAS-188 |
| **Tipo** | improvement |
| **Scope IN** | `calcScore()` en `src/app/api/v1/agents/[slug]/reputation/route.ts` — añadir ponderación por tipo de invocación |
| **Scope OUT** | Cambiar `reputation_score` (votos raw), UI, contratos, `performance_score` |

### Acceptance Criteria (EARS)
1. WHEN `calcScore()` computes the reputation score, THE error rate component SHALL use 35% weight (reduced from 40% to accommodate the new votes_weighted component at 10%). New weights: error(35%) + latency(25%) + dispute(20%) + verified(10%) + votes_weighted(10%) = 100%.
2. WHEN `calcScore()` computes the reputation score, THE votes component SHALL weight paid invocations 3× over sandbox/trial invocations.
3. WHEN an agent has only sandbox invocations, THE votes component SHALL apply weight 1 (base).
4. WHEN `GET /agents/:slug/reputation` is called, THE `score` field SHALL reflect the weighted calculation.
5. WHEN `reputation_score` (raw votes 0-1) is changed, THE `score` SHALL NOT be equal to `reputation_score` unless weights happen to produce the same result.

## 3. Context Map

### Archivos leídos
| Archivo | Por qué | Patrón |
|---------|---------|--------|
| `src/app/api/v1/agents/[slug]/reputation/route.ts` | Función `calcScore()` actual | Error (40%), Latency (30%), Dispute (20%), Verified (10%) |
| `agent_calls` schema | Qué campos determinan tipo de invocación | `payment_type`, `is_trial`, `key_id` |

### Tipos de invocación (para ponderar)
| Tipo | Campo en agent_calls | Peso |
|------|---------------------|------|
| Pago real x402 | `payment_type = 'x402'` | 3× |
| Agent key (pre-funded) | `payment_type = 'key'` | 2× |
| Trial / sandbox | `is_trial = true` | 1× |
| Sin datos | — | 1× (base) |

## 4. Diseño Técnico

### 4.1 Archivos a modificar
| Archivo | Acción | Qué cambia |
|---------|--------|-----------|
| `src/app/api/v1/agents/[slug]/reputation/route.ts` | Modificar | `calcScore()` + query de `agent_calls` para obtener breakdown de tipos |

### 4.2 Nueva lógica de ponderación del componente de votos

El componente de votos actualmente no existe explícitamente en `calcScore()` — la reputación de votos (`reputation_score`) se retorna separada del `score`. La ponderación afecta cómo los votos de usuarios pagantes influencian el `score` compuesto.

**Approach:** Añadir un 5to componente al score: `votesComponent` (10%) que reemplaza parte del espacio actual:
```
Error rate:    35% (antes 40%)
Latency:       25% (antes 30%)
Dispute:       20% (sin cambio)
Verified:      10% (sin cambio)
Votes weighted: 10% (nuevo)
```

**Calcular votes weighted:**
```typescript
// Query adicional: breakdown de invocaciones por tipo
const paidCount   = calls.filter(c => c.payment_type === 'x402').length
const keyCount    = calls.filter(c => c.payment_type === 'key').length
const trialCount  = calls.filter(c => c.is_trial).length

const weightedVotes = reputation_score !== null
  ? reputation_score * (paidCount * 3 + keyCount * 2 + trialCount * 1) /
    Math.max(1, paidCount * 3 + keyCount * 2 + trialCount * 1) * 10
  : 5 // neutral si no hay votos

// = reputation_score * 10 (simplificado — el peso relativo ya está en el ratio)
```

Simplificación real: `votesComponent = (reputation_score ?? 0.5) * 10`
Con boost si hay mayoría de pagos reales:
```typescript
const paidRatio = totalCalls > 0 ? (paidCount + keyCount) / totalCalls : 0
const votesBoost = paidRatio > 0.5 ? 1.2 : 1.0
const votesComponent = Math.min(10, (reputation_score ?? 0.5) * 10 * votesBoost)
```

### 4.3 Flujo principal
1. Query `agent_calls` últimos 30 días para breakdown de tipos — usar campo `called_at` (NO `created_at`)
2. Calcular `paidRatio = (x402 + key calls) / total calls`
3. `votesBoost = paidRatio > 0.5 ? 1.2 : 1.0`
4. `calcScore()` incluye `votesComponent` con boost
5. Añadir `paid_ratio` al response de `/reputation` como metadata

### 4.4 Añadir al response
```json
{
  "score": 74,
  "signal_weights": {
    "paid_ratio": 0.85,
    "votes_boost": 1.2,
    "model": "v2-weighted"
  }
}
```

## 5. Constraint Directives

### OBLIGATORIO seguir
- `reputation_score` (votos raw 0-1) NO se toca — sigue siendo el campo de votos puro
- La suma de pesos en `calcScore()` debe seguir siendo 100
- `signal_weights` es metadata informativa, no normativa

### PROHIBIDO
- NO modificar cómo se calculan votos on-chain (`submitReputationBatch`)
- NO cambiar el campo `reputation_score` de la DB
- NO tocar `performance_score` (WAS-213)
- NO hacer queries pesadas — usar datos ya disponibles de `agent_calls` con el índice `idx_agent_calls_agent_called_at` (ya existe en migración 020)
- SIEMPRE usar `called_at` en queries a `agent_calls`, NUNCA `created_at` (la columna no existe en esa tabla)

## 6. Riesgos
| Riesgo | Probabilidad | Mitigación |
|--------|-------------|------------|
| Agent sin calls → `paidRatio = 0` → penalty injusto | A | Default votesBoost = 1.0 si totalCalls < 5 |
| Score cambia abruptamente para agentes existentes | M | Boost máximo es ×1.2 — cambio suave |

---
*SDD — FULL | Sprint 7*
