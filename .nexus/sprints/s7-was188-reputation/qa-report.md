# QA Report — WAS-188 Reputation Endpoint
**Sprint:** s7-was188-reputation  
**Commits verificados:** `447a28087` (inicial) + `e6033cf74` (corrección BUG-02)  
**Archivo:** `src/app/api/v1/agents/[slug]/reputation/route.ts`  
**Fecha:** 2026-03-14  
**Veredicto:** ✅ **QA PASS**

---

## Criterios de Aceptación

### AC-1: calcScore ponderación = 100%
**CUMPLE** ✅  
Evidencia — `route.ts` función `calcScore`:
- `errorComponent = (1 - Math.min(errorRate7d/100, 1)) * 35` → 35%
- `latencyScore = Math.max(0, 25 - (p95Ms/2000)*25)` → 25%
- `disputeComponent = (1 - Math.min(disputeRate, 1)) * 20` → 20%
- `verifiedBonus = isVerified ? 10 : 0` → 10%
- `votesComponent = Math.min(10, (reputationScore ?? 0.5) * 10 * votesBoost)` → 10%

Suma máxima teórica: 35 + 25 + 20 + 10 + 10 = **100** ✅

---

### AC-2: votes_weighted pondera x402(×3), key(×2), trial(×1) en weightedPaidRatio
**CUMPLE** ✅  
Evidencia — `route.ts` líneas ~167–171:
```ts
const weightedTotal     = paidCount * 3 + keyCount * 2 + trialCount * 1
const weightedPaidRatio = totalCalls30d > 0
  ? (paidCount * 3 + keyCount * 2) / Math.max(1, weightedTotal)
  : 0
```
- x402 → factor ×3 ✅  
- key → factor ×2 ✅  
- trial → factor ×1 ✅

---

### AC-3: sandbox/trial (totalCalls < 5 o weightedPaidRatio < 0.5) → votesBoost = 1.0
**CUMPLE** ✅  
Evidencia — `route.ts` dentro de `calcScore`:
```ts
const votesBoost = totalCalls >= 5 && paidRatio > 0.5 ? 1.2 : 1.0
```
Lógica equivalente: si `totalCalls < 5` OR `paidRatio <= 0.5` → `votesBoost = 1.0` ✅  
(Solo se eleva a 1.2 cuando ambas condiciones se cumplen simultáneamente)

---

### AC-4: GET /reputation retorna `score` con cálculo ponderado
**CUMPLE** ✅  
Evidencia — `route.ts` handler GET:
```ts
const { score, signalWeights } = calcScore({ ... })
return NextResponse.json({ score, ... }, { status: 200, headers: CORS })
```
`score` proviene directamente de `calcScore` con la ponderación v2-weighted ✅

---

### AC-5: `signal_weights` en response con paid_ratio, votes_boost, model:"v2-weighted"
**CUMPLE** ✅  
Evidencia — `route.ts` función `calcScore` return:
```ts
return {
  score,
  signalWeights: {
    paid_ratio:  paidRatio,
    votes_boost: votesBoost,
    model:       'v2-weighted',
  },
}
```
Y en el `return NextResponse.json`:
```ts
signal_weights: signalWeights,  // WAS-188: metadata de ponderación
```
Todos los campos requeridos presentes ✅

---

### AC-6: Queries a agent_calls usan `called_at` (NUNCA `created_at`)
**CUMPLE** ✅  
Evidencia — tres queries a `agent_calls`:
1. `calcTrend`: `.select('status, called_at')` + `.gte('called_at', ...)` ✅
2. `lastCall`: `.select('called_at')` + `.order('called_at', { ascending: false })` ✅
3. `callsBreakdown`: `.gte('called_at', new Date(...).toISOString())` ✅

No aparece `created_at` en ninguna query ✅

---

## Build Verification
```
npx tsc --noEmit
```
**Sin errores** — output vacío ✅

---

## Resumen

| AC | Descripción | Estado |
|----|-------------|--------|
| AC-1 | Ponderación 35/25/20/10/10 = 100% | ✅ CUMPLE |
| AC-2 | votes_weighted: x402×3, key×2, trial×1 | ✅ CUMPLE |
| AC-3 | sandbox/trial → votesBoost = 1.0 | ✅ CUMPLE |
| AC-4 | GET retorna score ponderado | ✅ CUMPLE |
| AC-5 | signal_weights con paid_ratio/votes_boost/model | ✅ CUMPLE |
| AC-6 | Queries usan called_at, nunca created_at | ✅ CUMPLE |
| BUILD | tsc --noEmit sin errores | ✅ PASS |

---

## ✅ QA PASS

Todos los criterios de aceptación verificados con evidencia concreta archivo:línea.  
Fix BUG-02 (commit `e6033cf74`) correctamente implementado: weighted ratio en lugar de flat ratio.
