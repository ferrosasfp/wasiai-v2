# SDD #S6-03: Formalizar WAS-132 — Supabase como Fuente de Verdad

> SPEC_APPROVED: no
> Fecha: 2026-03-15
> Tipo: improvement
> SDD_MODE: mini
> Branch: feat/s6-03-was132-formalize

---

## 1. Resumen

WAS-132 desactivó `recordInvocationOnChain()` pero la decisión no está formalizada: no hay índice único en `nonce` (columna que no existe aún), el contrato on-chain muestra `totalInvocations=0`, y no hay documentación. Este SDD añade la columna `nonce` a `agent_calls`, crea un índice único, y documenta la decisión en README.

## 2. Work Item

| Campo | Valor |
|-------|-------|
| **#** | S6-03 |
| **Tipo** | improvement |
| **SDD_MODE** | mini |
| **Objetivo** | Añadir `nonce` a `agent_calls` con índice único para idempotency off-chain. Documentar WAS-132. |
| **Scope IN** | Migración 060, columna `nonce` en `agent_calls`, README sección arquitectura de pagos |
| **Scope OUT** | Leer nonce del X-PAYMENT header (eso es S6-02 o futuro), UI, contratos |

## 3. Context Map

### Exemplars

| Para modificar | Seguir patrón de |
|---------------|------------------|
| `060_nonce_agent_calls.sql` | `058_performance_score.sql` |
| `logCall()` en invoke/route.ts | campo `settlement_tx_hash` — mismo patrón de opcional |

## 4. Archivos afectados

| Archivo | Acción | Qué cambia | Exemplar |
|---------|--------|-----------|----------|
| `supabase/migrations/060_nonce_agent_calls.sql` | Crear | `ALTER TABLE agent_calls ADD COLUMN nonce TEXT` + `CREATE UNIQUE INDEX` WHERE NOT NULL | `058_performance_score.sql` |
| `README.md` o `docs/architecture/payments.md` | Crear/Modificar | Sección "Source of Truth" explicando WAS-132 | N/A |

## 5. Modelo de datos

```sql
-- Migración 060: añadir nonce para idempotency off-chain (WAS-132)
-- Supabase es la fuente de verdad para accounting de pagos x402.
-- El nonce EIP-3009 del X-PAYMENT header se guarda aquí para detectar
-- intentos de replay antes de que lleguen a usdcSettler.ts.

ALTER TABLE agent_calls
  ADD COLUMN IF NOT EXISTS nonce TEXT;

-- Índice único parcial: solo cuando nonce es conocido (payment_type='x402')
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_calls_nonce_unique
  ON agent_calls (nonce)
  WHERE nonce IS NOT NULL;
```

**Nota:** `logCall()` en invoke/route.ts aún no pasa el nonce — eso es trabajo futuro cuando se extraiga del X-PAYMENT header. La columna queda nullable para no romper el insert existente.

## 6. Acceptance Criteria (EARS)

1. WHEN migration 060 is applied, THE `agent_calls` table SHALL have a `nonce TEXT` column.
2. WHEN two rows with the same non-null `nonce` are inserted, THE database SHALL reject the second with a unique constraint violation.
3. WHEN `logCall()` is called without nonce, THE insert SHALL succeed (nonce IS NULL, not constrained).

## 7. Constraint Directives

### PROHIBIDO
- NO modificar `logCall()` para pasar nonce en esta HU — columna queda nullable
- NO leer el nonce del X-PAYMENT header aquí — solo la columna + índice
- NO tocar el contrato on-chain

---

*SDD generado por NexusAgil — MINI | Sprint 6*
