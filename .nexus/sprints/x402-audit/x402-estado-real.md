# Auditoría x402 — Estado Real Verificado
**Fecha:** 2026-03-15  
**Verificado por:** San (OpenClaw) — queries directas a mainnet + código fuente  
**Contrato mainnet:** `0x24be31D0F538C5551c536b09C85907C43c24d062`

---

## TL;DR

El reporte anterior asumía ~95% de compliance x402. La realidad verificada es **~80%**.  
La diferencia: varias features existen en el contrato pero el backend deliberadamente dejó de usarlas.  
No es un bug — son decisiones de diseño. Pero hay que documentarlas correctamente.

---

## 1. Estado Real del Contrato Mainnet

### Verificado on-chain

| Campo | Valor real |
|-------|-----------|
| `platformFeeBps` | 1000 bps = 10% |
| `registrationFee` | $0.00 USDC |
| `totalInvocations` | **0** (nunca se llamó recordInvocation) |
| `totalEarnings` | $0.0000 USDC |
| `usdc` | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` ✅ mainnet |
| `operators(operator)` | `true` ✅ |
| `treasury` | `0xBF9554c33A8E743518aeD49d1A3c9e175a5f9967` ✅ |
| `pendingTreasury` | `0x0000...` (sin propuesta activa) |
| `withdraw()` | Revierte "nothing to withdraw" (esperado — earnings = 0) |
| Operator AVAX balance | ~1.0 AVAX ✅ |
| Marketplace USDC balance | $2.04 USDC (earnings pendientes de withdraw) |

### Bytecode verificado en Snowtrace
El contrato tiene 74 funciones incluyendo: `computePaymentId`, `usedPaymentIds`, `settleKeyBatch`,  
`depositForKey`, `checkSolvency`, `dailySettlementCap`, timelocks, Chainlink upkeep, etc.  
**El contrato es la versión actualizada completa.**

---

## 2. Gap Crítico: WAS-132 — recordInvocation Desactivado

```typescript
// WAS-132: recordOnChain() eliminado — Supabase agent_calls es la fuente de verdad.
// recordInvocationOnChain() on-chain era auditoría duplicada con costo de gas por invocación.
```

**Impacto:** `totalInvocations = 0` on-chain aunque existen invocaciones en Supabase.

Consecuencias directas:
- `usedPaymentIds` **nunca se popula** → idempotency on-chain no funciona en la práctica
- `computePaymentId` existe pero no se llama desde el backend
- El contrato es contabilidad que nadie alimenta
- La reconciliación on-chain no tiene datos de pagos que comparar

**Decisión de diseño (no un bug):** Supabase es la fuente de verdad. El costo de gas por `recordInvocation` se consideró injustificado para el volumen actual. Decisión válida para early stage.

---

## 3. Estado Real de Cada Feature del Reporte

| Feature | En contrato | En código | Activo en prod | Notas |
|---------|-------------|-----------|----------------|-------|
| `computePaymentId` + `usedPaymentIds` | ✅ | ✅ | ❌ | WAS-132 desactivó recordInvocation |
| `settleKeyBatch` | ✅ | ✅ | ⚠️ | Cron configurado, no verificado con datos reales |
| `depositForKey` | ✅ | ✅ | ⚠️ | `totalKeyBalances = 0` — nunca usado |
| `checkSolvency` | ✅ | ✅ | ❌ | No se llama porque keyBalances = 0 |
| `dailySettlementCap` | ✅ | ✅ | ❌ | No efectivo sin recordInvocation |
| Timelocks governance | ✅ | ✅ | ✅ | Activos (48h delay) |
| `emergencyWithdrawKey` | ✅ | ✅ | n/a | Safety valve disponible |
| Chainlink upkeep | ✅ | ✅ | ❓ | No verificado si está registrado en Chainlink |
| `submitReputationBatch` | ✅ | ✅ | ⚠️ | Cron configurado en vercel.json |
| `signReceipt.ts` | n/a | ✅ | ✅ | Se llama en invoke/route.ts (línea 348) |
| Self-hosted facilitador | n/a | ✅ | ✅ | usdcSettler.ts activo en mainnet (WAS-134) |
| Circuit breaker | n/a | ✅ | ✅ | WAS-73 activo |
| Input validation pre-cobro | n/a | ✅ | ✅ | WAS-200 activo |
| `reconcile-onchain` cron | n/a | ✅ | ✅ | Solo reconcilia registro de agentes (NO pagos) |

---

## 4. Gaps Reales (Post-Verificación)

### GAP-0: On-Chain Accounting Inactivo (MEDIA)
**Severidad real:** Media — no afecta la seguridad del protocolo pero sí la auditabilidad.

El contrato tiene toda la maquinaria de accounting (`recordInvocation`, `usedPaymentIds`, `totalVolume`, `dailySettlementCap`) pero nada la alimenta. Un auditor externo que mire el contrato verá `totalInvocations = 0` aunque el sistema haya procesado pagos reales.

**Opciones:**
- A) Reactivar `recordInvocation` en modo batch (agrupar N calls en 1 tx para amortizar gas)
- B) Mantener Supabase como fuente de verdad y documentarlo explícitamente
- C) Usar `settleKeyBatch` como mecanismo de registro para ambos paths

### GAP-1: Idempotency Solo Off-Chain (MEDIA)
El reporte afirmaba que `usedPaymentIds` protege contra doble-settlement. En la práctica, la protección descansa en:
1. Nonce EIP-3009 (USDC rechaza nonce usado on-chain) ✅ — esto SÍ funciona
2. Supabase — índice único en `nonce` si existe

La protección real existe vía USDC, pero no vía el mapping del contrato.

### GAP-2: Cobro Sin Servicio (MEDIA) — Sin cambios
Upstream falla post-settlement → usuario cobrado sin servicio. Sin refund automático.  
`status='error'` en DB pero sin compensación.

### GAP-3: Observabilidad x402 (MEDIA) — Sin cambios
No hay métricas estructuradas del pipeline de pagos.

### GAP-4: reconcile-onchain No Cubre Pagos (MEDIA)
El cron reconcilia si los agentes están registrados on-chain.  
**No compara `agent_calls` vs eventos `AgentInvoked` del contrato** porque `recordInvocation` no se llama.  
En la práctica: la reconciliación de pagos es imposible hasta que GAP-0 se resuelva.

### GAP-5: Receipt No Incluye paymentId del Contrato (BAJA)
`signReceipt.ts` firma el receipt pero no incluye el `computePaymentId()` del contrato.  
Bajo impacto mientras GAP-0 no se resuelva (si no hay datos on-chain, el paymentId no tiene qué verificar).

---

## 5. Compliance Real vs. Reportado

| Área | Reporte anterior | Realidad |
|------|-----------------|---------|
| Idempotency on-chain | ✅ CERRADO | ⚠️ PARCIAL (vía USDC nonce, no vía contrato) |
| Receipt | ✅ CERRADO | ⚠️ PARCIAL (firmado, no incluye paymentId del contrato) |
| Accounting on-chain | ESTABLE | ❌ INACTIVO (WAS-132) |
| Reconciliación | PARCIAL | ❌ Solo agentes, no pagos |
| Facilitador propio | ✅ | ✅ |
| Settlement real-time | ✅ | ✅ |
| Circuit breaker | ✅ | ✅ |
| Input validation | ✅ | ✅ |

**Compliance estimado real: ~78-82%**

---

## 6. Recomendación Actualizada

### Decisión clave a tomar antes de Sprint 6

**¿Qué es la fuente de verdad para pagos?**

**Opción A — Supabase (mantener WAS-132):**
- Documentar explícitamente que Supabase es la fuente de verdad
- El contrato es solo settlement + governance, no accounting
- Requiere: idempotency en DB (índice único en nonce), observabilidad, error recovery
- Ventaja: cero gas por invocación, simple, escala
- Riesgo: si Supabase falla, no hay registro alternativo

**Opción B — Batch On-Chain (reactivar accounting):**
- Agrupar N `recordInvocation` en 1 tx via cron (cada hora o cada 100 calls)
- `totalInvocations` y `usedPaymentIds` se populan con delay aceptable
- Ventaja: auditabilidad independiente, idempotency on-chain real
- Costo: gas (~$0.01 AVAX por batch de 100), complejidad de batch processor
- No es incompatible con WAS-132 — se puede hacer en el cron `settle-key-batches`

**Mi recomendación:** Opción A en el corto plazo (hackathon), Opción B cuando `totalInvocations > 500/día`.  
La diferencia entre ambas es auditabilidad, no seguridad.

---

## 7. Plan Sprint 6 Actualizado

### Prioridad 1 — Supabase como fuente de verdad (formalizar WAS-132)
- Índice único en `agent_calls.nonce` (si no existe) para idempotency off-chain
- Documentar en README/docs que accounting on-chain está desactivado intencionalmente
- Esfuerzo: 1 día

### Prioridad 2 — Error Recovery post-settlement (GAP-2)
- Tabla `settlement_failures(user_id, amount, agent_slug, settled_at, upstream_error)`
- Si upstream falla post-settle: insert en `settlement_failures`, alerta operacional
- Decisión de negocio: crédito automático vs. revisión manual
- Esfuerzo: 3-4 días

### Prioridad 3 — Observabilidad x402 (GAP-3)
- Métricas en invoke/route.ts: probe, settle_ok/fail, upstream_ok/fail
- Alerta si `settlement_failures.count > 0` (usuario cobrado sin servicio)
- Alerta si `operator AVAX < 0.2`
- Esfuerzo: 2-3 días

### Prioridad 4 — Build Games Stage 3 (paralelo)
- GTM & Vision deck
- Demo AgentKit en vivo
- Deadline: ~2 semanas

---

## 8. Supuestos Verificados

| Supuesto | Estado |
|----------|--------|
| WAS-134 activo en mainnet | ✅ VERIFICADO |
| `usedPaymentIds` activo en prod | ❌ FALSO — WAS-132 |
| `dailySettlementCap` efectivo | ❌ FALSO — no hay recordInvocation |
| Crons configurados en Vercel | ✅ VERIFICADO (settle, reconcile, reputation) |
| `signReceipt.ts` en invoke flow | ✅ VERIFICADO |
| Operator AVAX balance OK | ✅ ~1.0 AVAX |
| Contrato es versión actualizada | ✅ 74 funciones, verificado en Snowtrace |
| Chainlink upkeep registrado | ❓ NO VERIFICADO |
| `depositForKey` / `settleKeyBatch` usados | ❌ FALSO — `totalKeyBalances = 0` |

---

*Generado: 2026-03-15 | Verificado contra mainnet block ~80,401,435*
