# Logic Audit — WAS-188 Reputación con Ponderación Diferenciada
> Commit: `447a28087`
> Archivo: `src/app/api/v1/agents/[slug]/reputation/route.ts`
> Auditor: NexusAgil Logic Auditor v1.3
> Fecha: 2026-03-15

---

## Veredicto: 🔴 REQUIERE CORRECCIÓN

Se encontraron **2 bugs** (1 HIGH, 1 MEDIUM) que incumplen ACs contractuales del SDD.

---

## Checklist de Trazabilidad AC → Código

### AC1 — Error rate component usa fórmula existente (40%)
**Estado: ❌ FALLA**

El SDD dice literalmente:
> WHEN `calcScore()` computes the reputation score, THE error rate component SHALL use the **existing formula (40%)**.

El código implementa:
```typescript
const errorComponent = errorRate7d !== null
  ? (1 - Math.min(errorRate7d / 100, 1)) * 35  // ← 35, NO 40
  : 26.25
```

La sección 4.2 del SDD introduce una redistribución de pesos (error 35%, latency 25%), pero el AC1 es explícito: "SHALL use the existing formula (40%)". Hay una **contradicción interna en el SDD** entre AC1 y la sección 4.2.

**Bug**: El código implementó el diseño técnico (4.2) pero viola AC1. Si AC1 es la fuente de verdad contractual, el error rate debe ser 40% y la suma de pesos no cierra a 100% con votesComponent al 10% — alguien debe decidir cuál es correcta.

**Impacto**: Score reducido hasta ~3.5 puntos vs AC1. Suma de pesos: 35+25+20+10+10 = 100 ✅ (el diseño 4.2 es internamente consistente, pero contradice el AC).

---

### AC2 — votes_weighted pondera x402(×3), key(×2), trial(×1)
**Estado: ❌ FALLA (MEDIO)**

El AC dice:
> THE votes component SHALL weight paid invocations 3× over sandbox/trial invocations.

La ponderación esperada implica: `weightedTotal = paidCount*3 + keyCount*2 + trialCount*1`.

El código calcula:
```typescript
const paidCount  = callsBreakdown?.filter(c => c.payment_type === 'x402').length ?? 0
const keyCount   = callsBreakdown?.filter(c => c.payment_type === 'key').length ?? 0
const paidRatio  = totalCalls30d > 0 ? (paidCount + keyCount) / totalCalls30d : 0
```

**Bug**: `paidRatio` trata x402 y key con el **mismo peso (×1)** en el numerador. No aplica los multiplicadores diferenciados (×3 vs ×2). Un agente con 10 calls `key` y 0 calls `x402` obtiene el mismo `paidRatio` que uno con 10 calls `x402`. Esto viola la jerarquía x402 > key especificada en el AC.

El SDD en 4.2 simplifica hacia un ratio binario, pero esa simplificación **abandona** la ponderación diferenciada que es el corazón del AC. La implementación correcta sería:

```typescript
const weightedPaid = paidCount * 3 + keyCount * 2
const weightedTotal = weightedPaid + trialCount * 1
const paidRatio = weightedTotal > 0 ? weightedPaid / weightedTotal : 0
```

**Impacto**: Un agente con mayoría de calls `key` (×2) se beneficia igual que uno con mayoría `x402` (×3). La diferenciación de valor entre usuarios x402 vs key se pierde.

---

### AC3 — Solo sandbox/trial → votesBoost = 1.0
**Estado: ✅ PASA**

```typescript
const votesBoost = totalCalls >= 5 && paidRatio > 0.5 ? 1.2 : 1.0
```
Si `paidRatio = 0` (todo sandbox/trial), `votesBoost = 1.0`. ✅
Si `totalCalls < 5`, `votesBoost = 1.0` (mitigación de agentes nuevos). ✅

---

### AC4 — GET /reputation retorna `score` con cálculo ponderado
**Estado: ✅ PASA**

```typescript
const { score, signalWeights } = calcScore({ ... })
return NextResponse.json({ score, ... })
```
El `score` se retorna correctamente. ✅

---

### AC5 — `reputation_score` ≠ `score` a menos que coincidan por casualidad
**Estado: ✅ PASA**

`reputation_score` es 0.0–1.0, `score` es 0–100. No son iguales por diseño. ✅

---

### CRÍTICO: `called_at` en queries (NUNCA `created_at`)
**Estado: ✅ PASA — todos los queries usan `called_at`**

| Query | Campo usado |
|-------|-------------|
| `calcTrend` | `called_at` ✅ |
| `lastCall` (order by) | `called_at` ✅ |
| `callsBreakdown` (gte filter) | `called_at` ✅ |

---

## Otros Hallazgos (No bloquean, observaciones)

### OBS-1: Latency neutral default no es verdaderamente neutral (LOW)
```typescript
: 16.67 // valor neutral si no hay datos
```
`16.67 / 25 = 0.667` → asume performance del 67% para agentes sin datos.
El punto medio matemático sería `12.5` (50%). Mismo patrón en error: `26.25 / 35 = 0.75`.
Es un default intencionalmente optimista, pero no está documentado el razonamiento.
**Recomendación**: Añadir comentario explicando que es deliberadamente optimista (dar beneficio de la duda a agentes sin datos).

### OBS-2: `is_trial` no se verifica en `callsBreakdown`
El SDD especifica trial como `is_trial = true`. El código cuenta `trialCount` implícitamente como `totalCalls30d - paidCount - keyCount`, pero en realidad **nunca calcula `trialCount` explícitamente** — solo usa `paidRatio`. Si hubiera calls con `payment_type = null` y `is_trial = false` (por ejemplo, calls legacy), estas caerían en el denominador sin ser contadas como ningún tipo. No es un bug crítico dado el diseño simplificado, pero vale la pena documentarlo.

### OBS-3: `disputeRate` hardcodeado a 0
```typescript
disputeRate: 0, // dispute_rate = 0 hasta WAS-194/tabla agent_disputes
```
Aceptable como placeholder, está comentado. No es un bug.

### OBS-4: `erc8004_score` duplica `reputation_score`
```typescript
erc8004_score: agent.reputation_score ?? null,  // = reputation_score
```
Ambos campos exponen el mismo valor. Puede generar confusión en consumers del API. Documentar que es intencional hasta WAS-199.

---

## Resumen de Bugs

| ID | Severidad | AC | Descripción |
|----|-----------|----|----|
| BUG-01 | HIGH | AC1 | Error rate implementado como 35% pero AC1 dice 40% (contradicción interna en SDD) |
| BUG-02 | MEDIUM | AC2 | `paidRatio` no usa pesos ×3/×2/×1 — trata x402 y key igual en numerador |

---

## Acciones Requeridas

1. **BUG-01**: Resolver contradicción entre AC1 (40%) y sección 4.2 (35%). Opciones:
   - Si el SDD se actualiza para cambiar AC1 a 35% → código está bien, solo actualizar spec
   - Si AC1 es contractual y debe ser 40% → revertir a `* 40` y ajustar otro componente para que sume 100%

2. **BUG-02**: Corregir `paidRatio` para usar pesos diferenciados:
   ```typescript
   const weightedPaid  = paidCount * 3 + keyCount * 2
   const weightedTotal = weightedPaid + (callsBreakdown?.filter(c => c.is_trial || (!c.payment_type)).length ?? 0)
   const paidRatio     = weightedTotal > 0 ? weightedPaid / weightedTotal : 0
   ```
