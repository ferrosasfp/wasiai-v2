# SDD #S7-03: Nonce x402 en agent_calls

> SPEC_APPROVED: no
> Fecha: 2026-03-15
> Tipo: improvement
> SDD_MODE: mini
> Branch: feat/s7-03-nonce-x402

## 1. Resumen
La columna `nonce TEXT` ya existe en `agent_calls` (migración 060). Lo que falta: extraer el nonce EIP-3009 del `X-PAYMENT` header y persistirlo en `logCall()` Route B. Esto completa WAS-132 — idempotency off-chain real vía índice único `idx_agent_calls_nonce_unique`.

## 2. Work Item
| Campo | Valor |
|-------|-------|
| **#** | S7-03 |
| **Tipo** | improvement |
| **Scope IN** | `src/app/api/v1/models/[slug]/invoke/route.ts` — extraer nonce + pasar a logCall |
| **Scope OUT** | Cambios a `logCall()` firma pública, contratos, migración |

## 3. Context Map
| Archivo | Hallazgo |
|---------|----------|
| `invoke/route.ts` línea ~108-114 | `X402PaymentHeader` tiene `payload.authorization.nonce?: string` |
| `invoke/route.ts` línea ~446 | `logCall(supabase, model, 'human', null, settlement.transactionHash, result, null, slug)` — no pasa nonce |
| `invoke/route.ts` línea ~577 | `logCall()` firma actual — no tiene parámetro nonce |

## 4. Archivos afectados
| Archivo | Acción | Qué cambia |
|---------|--------|-----------|
| `src/app/api/v1/models/[slug]/invoke/route.ts` | Modificar | Extraer nonce de paymentHeader + añadir a logCall + añadir nonce al insert |

## 5. Diseño técnico

**Extraer nonce:**
```typescript
// Justo antes de logCall en Route B
const x402Nonce = (paymentHeader?.payload as X402EVMPayload | undefined)
  ?.authorization?.nonce ?? null
```

**Añadir nonce al insert en logCall:**
Añadir parámetro opcional `nonce?: string | null` a `logCall()` y pasarlo al `.insert({...})`:
```typescript
nonce: nonce ?? null,
```

**Idempotency check** (opcional, si Supabase retorna error de unique constraint):
Si el insert falla con `23505` (unique violation en nonce), significa replay — retornar 402 con `{ error: 'payment_already_used' }` en lugar de procesar.

## 6. Acceptance Criteria
1. WHEN a valid x402 payment is processed, THE `agent_calls` row SHALL have `nonce` populated with the EIP-3009 nonce from the authorization.
2. WHEN `logCall` is called from Route A (agent key), THE `nonce` SHALL be null (no regression).
3. WHEN two requests arrive with the same nonce, THE second insert SHALL fail with unique constraint → system SHALL return 402 `payment_already_used`.

## 7. Constraint Directives
### PROHIBIDO
- NO cambiar la firma pública de logCall de forma que rompa Route A
- NO añadir el nonce check antes de settlear — check va post-settle
- `nonce` es opcional en logCall (nullable) para no romper otros callers

---
*SDD — MINI | Sprint 7*
