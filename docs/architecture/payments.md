# Arquitectura de Pagos — WAS-132

## Fuente de Verdad: Supabase

**Supabase es la fuente de verdad para el accounting de pagos x402.**

Cada invocación pagada se registra en la tabla `agent_calls` con:
- `payment_type` — tipo de pago (`x402`, `free`, etc.)
- `amount_usdc` — monto cobrado en USDC
- `settlement_tx_hash` — hash de la tx de liquidación (cuando aplica)
- `nonce` — nonce EIP-3009 del header `X-PAYMENT` (para idempotency off-chain)

El flujo de pago:

```
Cliente → X-PAYMENT header (EIP-3009) → /invoke/:id
  → usdcSettler.ts verifica y liquida
  → logCall() registra en agent_calls (Supabase)
  → Respuesta al cliente
```

---

## Por qué recordInvocationOnChain() está desactivado

La función `recordInvocationOnChain()` fue **desactivada intencionalmente** como parte de WAS-132.

**Razón:** El costo de gas por transacción (~$0.002–$0.05 en L2) no justifica el valor para el volumen actual de invocaciones. Registrar cada invocación on-chain añadiría latencia y costos que degradarían la UX sin beneficio proporcional en la etapa actual del producto.

La liquidación USDC ya provee un registro on-chain del pago. El registro de "quién invocó qué agente cuándo" es información de producto/analytics, no de settlement.

---

## Cuándo se reevaluará

`recordInvocationOnChain()` se reehabilitará cuando se cumpla **alguna** de estas condiciones:

1. **Volumen:** > 500 invocaciones/día sostenidas durante 7 días
2. **Posicionamiento:** wasiai se posiciona como **protocolo abierto** que requiere verificabilidad on-chain para terceros (marketplaces de agentes, DAOs, integraciones externas)

Hasta entonces, Supabase es suficiente y más eficiente.

---

## Idempotency con nonce EIP-3009

El campo `agent_calls.nonce` almacena el nonce del token `X-PAYMENT` (EIP-3009 `transferWithAuthorization`).

**Propósito:** Detectar intentos de replay **antes** de intentar el settlement on-chain.

```sql
-- Índice único parcial garantiza idempotency off-chain
CREATE UNIQUE INDEX idx_agent_calls_nonce_unique
  ON agent_calls (nonce)
  WHERE nonce IS NOT NULL;
```

**Estado actual:** La columna existe pero `logCall()` aún no la popula — eso ocurrirá cuando se extraiga el nonce del header `X-PAYMENT` (trabajo futuro). El índice está listo para cuando se implemente.

---

*Documento creado: 2026-03-14 | WAS-132 | Sprint 6*
