# Consolidación de arquitectura — v2 consume a2a + facilitator

**Fecha:** 2026-06-25
**Repos:** wasiai-v2 (marketplace) · wasiai-a2a (gateway) · wasiai-facilitator (settler x402 relayer)

## Resumen ejecutivo

La meta (v2 consume a2a + facilitator en vez de reimplementar) está **más cerca de lo que parece**:

- **YA HECHO:** compose / orchestrate / capabilities de v2 **delegan 100% a a2a** en prod (realignment WKH-66, motor interno borrado −1182 LOC). No quedó código muerto relevante.
- **Duplicación real restante (~30%)** concentrada en 4 áreas; la #1 es además un **agujero de seguridad**.

## Duplicación consolidable (priorizada)

| P | Área | Estado | Consolidación | Esfuerzo / Riesgo |
|---|---|---|---|---|
| **P0** | **Settler x402** | v2 tiene settler interno `settlePaymentDirectly` que es un **subconjunto INSEGURO** del facilitator (no valida payTo = bug V1). El facilitator cubre TODAS las cadenas del interno (superset) y SÍ valida payTo. | **Settlear siempre vía facilitator; borrar el settler interno.** Cierra el V1 de raíz. | Bajo-Medio / **Bajo** |
| P1 | Chain config / USDC addrs | Mismas direcciones USDC hardcodeadas en los 3 repos (address-drift risk) | Paquete `@wasiai/chains` | Medio / Medio |
| P2 | x402 client SDK (EIP-3009) | Envelope TransferWithAuthorization duplicado v2↔a2a (a2a 3×) | Paquete `@wasiai/x402-client` (depende de P1) | Medio-Alto / Medio |
| P3 | SSRF guard | v2 (`validateEndpointUrl`) vs a2a (`url-validator`+`ssrf-dispatcher`, superior con connect-time pin) | Centralizar en la impl de a2a | Medio / Bajo-Medio |

## El caso del settler (P0 — quick win que cierra V1)

`v2/src/lib/contracts/usdcSettler.ts:120` `settlePaymentDirectly(payload, required)` — **`payTo` no es ni parámetro**, así que estructuralmente no puede validar `auth.to`. Toma `auth.to` del payload y lo transmite on-chain (`:238-253`). El facilitator SÍ valida (`fac/src/methods/eip3009/verify.ts:111`: `if (!isAddressEqual(authorization.to, accepted.payTo)) → INVALID_RECEIVER`).

El settler interno solo hace Avalanche; el facilitator hace Avax+Base+Kite (superset estricto) → apagar el interno **no pierde cobertura**. v2 hoy solo origina settlements de Avalanche.

**Pasos:**
1. `WASIAI_FACILITATOR_AS_PRIMARY=true` en v2 (toggle, `x402-facilitator-config.ts:94`).
2. `FACILITATOR_API_KEY` en v2 = bearer del facilitator (`x402-facilitator-client.ts:170`). ← gap conocido (memoria `wasiai-facilitator-base.md`).
3. Confirmar Avalanche habilitada en el deploy del facilitator.
4. Eliminar el fallback `tryInternal` (`facilitator-router.ts:160`) + `settlePaymentDirectly`.
5. Validar e2e un settle de Avalanche vía facilitator antes del cutover.

## NO consolidar (duplicación legítima por capa)
- **Gas overhead (el cobro):** v2 cobra al invoke caller directo; a2a cobra al orchestration caller por step. Cada capa frontea su propio gas distinto — un run orquestado paga ambos legítimamente. (Solo la fórmula pura ~40 LOC es candidata opcional a compartir.)
- **Circuit breakers:** 3 runtimes (v2 Redis distribuido / a2a in-memory / fac cockatiel).
- **Auth, rate limiting v2, Chainlink oracle:** atados a framework/feature, separación correcta.
- **Discovery a2a (multi-registry) vs catálogo v2 (tabla agents):** v2 es UNA registry de a2a; el loop-break TD-002 es el contrato de delegación funcionando, no duplicación.
