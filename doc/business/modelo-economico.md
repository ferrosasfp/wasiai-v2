# Modelo Económico WasiAI v2
> Documento oficial · Última actualización: 2026-03-03
> Este documento es la fuente de verdad del modelo de negocio de WasiAI.
> Refleja decisiones de diseño tomadas en sesión con el PO.

---

## 1. Actores

| Actor | Rol |
|-------|-----|
| **Creator** | Publica agentes IA y recibe ingresos por cada invocación |
| **Consumer** | Llama agentes y paga por uso en USDC |
| **WasiAI (Treasury)** | Recibe el fee de plataforma por cada invocación |
| **Operador** | Wallet backend que ejecuta txs on-chain (settlements, registros) |

---

## 2. Fee de plataforma

Por cada invocación exitosa el contrato distribuye el pago automáticamente:

```
Creator recibe:  90% del precio del agente
Treasury recibe: 10% del precio del agente
```

**Ejemplo:** agente a $0.10/llamada
- Creator: $0.09 USDC → queda en `pendingEarnings` hasta que retire
- Treasury: $0.01 USDC → transferido inmediatamente al wallet treasury

**Parámetros del contrato:**
- Fee actual: `platformFeeBps = 1000` (10%)
- Fee máximo posible: 30% (hard cap inmutable en contrato)
- Cambio de fee: `proposeFee()` → timelock 48h → `executeFee()`
- Early creator program: fee = 0% para creators fundadores seleccionados por el owner

---

## 3. Flujos de pago

### Flujo A — Agent Key ✅ Recomendado

El consumer pre-deposita USDC en el contrato y obtiene un budget para llamar agentes.

```
1. Consumer deposita USDC on-chain → budget asignado a su key
2. Cada invocación descuenta del budget (verificación off-chain)
3. Operador ejecuta settleKeyBatch() 1 vez/día → earnings al creator
4. Creator retira con withdraw() cuando quiera
```

| Concepto | Detalle |
|----------|---------|
| Gas al depositar | ~$0.05 AVAX (una sola vez) — pagado por el consumer |
| Gas por invocación | $0.00 — el batch diario lo absorbe |
| Gas fee adicional | Ninguno |
| Mejor para | Uso frecuente, integraciones, agentes autónomos |

---

### Flujo B — x402 (pay-per-use)

El consumer firma un pago ERC-3009 que viaja en el header HTTP. Sin pre-depósito.

```
1. Consumer firma TransferWithAuthorization (EIP-712) con su wallet
2. El pago viaja en el header X-PAYMENT de la request HTTP
3. Operador verifica la firma y ejecuta transferWithAuthorization() on-chain
4. Pago liquidado — creator recibe 90%, treasury 10%
```

| Concepto | Detalle |
|----------|---------|
| Gas por invocación | Real — pagado por el operador, trasladado al consumer como gas fee |
| Gas fee | Calculado dinámicamente (ver sección 4) |
| Mejor para | Uso esporádico, prueba, sin compromiso de pre-depósito |

---

## 4. Gas fee dinámico (Flujo x402)

El gas fee **no es un valor fijo** — se calcula en tiempo real basado en el precio de AVAX en el momento de la invocación.

### Fórmula

```
gas_fee_usdc = gas_units × gas_price_avax × avax_usd_price

Donde:
  gas_units       = unidades de gas de transferWithAuthorization() (~45,000 gas)
  gas_price_avax  = precio del gas en la red Avalanche en ese instante (nAVAX)
  avax_usd_price  = precio AVAX/USD leído de Chainlink en tiempo real
```

### Fuente de precio

El precio de AVAX se lee del feed Chainlink `CHAINLINK_AVAX_USD_FEED` (ya integrado en `src/lib/defi-risk/chainlink.ts`). Se cachea por 60 segundos para evitar latencia en cada invocación.

### Ejemplos reales

| Precio AVAX | Gas fee aproximado | % sobre agente $0.10 |
|-------------|-------------------|----------------------|
| $15 | ~$0.01 | 10% |
| $30 | ~$0.02 | 20% |
| $60 | ~$0.04 | 40% |
| $120 | ~$0.08 | 80% |

> **Nota:** Cuando el precio de AVAX es alto y el precio del agente es bajo, el gas fee puede superar el precio del agente. En esos casos el sistema muestra una advertencia al consumer y sugiere usar Agent Key.

### Cuándo se aplica

- Solo en el flujo x402
- Solo cuando precio del agente < umbral configurable (ver `PLATFORM_X402_GAS_FEE_THRESHOLD_USDC` en env)
- Agentes de precio alto (> umbral) absorben el gas fee en el margen del 10%

---

## 5. Publicación de agentes (Freemium)

### Primer agente — Gratuito

```
Creator solo necesita cuenta (email/Supabase)
WasiAI paga el gas de registerAgent() on-chain (~$0.05 AVAX)
Sin wallet requerida
```

### Agentes adicionales — Listing fee

```
Creator necesita wallet conectada
Creator paga gas de registerAgent() (~$0.05 AVAX)
Creator paga listing fee en USDC → va al treasury
```

### Listing fee — Configurable sin redeploy

El monto de la listing fee **no está hardcodeado**. Vive en la tabla `platform_config` de Supabase:

```sql
SELECT value FROM platform_config WHERE key = 'listing_fee_usdc';
-- Ejemplo: "3.00"
```

Esto permite ajustar el precio sin redeploy de la aplicación. El owner puede actualizarlo directamente desde el dashboard de Supabase o desde un panel de admin futuro.

**Valor inicial sugerido:** $3.00 USDC — a definir y activar por el PO antes del Sprint 20.

---

## 6. Ciclo de vida de una Agent Key

```
Crear key (nombre)
    ↓
Depositar USDC on-chain → budget asignado
    ↓
Llamar agentes → budget se descuenta (off-chain)
    ↓
settleKeyBatch() diario → earnings al creator
    ↓
Revocar key:
  Con saldo > $0 → operador ejecuta refundKeyToEarnings()
                   saldo aparece en pendingEarnings del consumer
  Con saldo = $0 → soft revoke, sin tx, sin gas
    ↓
Consumer retira earnings con withdraw()
```

**Escape de emergencia:** Si WasiAI no tiene actividad por 30 días, `emergencyWithdrawKey()` permite recuperar fondos directamente del contrato sin intervención del operador.

---

## 7. Ciclo de vida de earnings del creator

```
Invocación ocurre
    ↓
90% → pendingEarnings[creator] (on-chain, acumulado)
10% → treasury (transferido inmediatamente)
    ↓
Creator hace withdraw() desde dashboard
    ↓
Recibe USDC en su wallet
Creator paga su propio gas (~$0.05 AVAX)
```

---

## 8. Costos de operación de WasiAI

| Operación | Quién paga | Frecuencia | Gas est. | Estado |
|-----------|-----------|------------|----------|--------|
| `settleKeyBatch()` | WasiAI | 1x/día | ~$0.10 | ✅ Costo fijo |
| `registerAgent()` primer agente | WasiAI | 1x/agente | ~$0.05 | ✅ Solo agente #1 |
| `refundKeyToEarnings()` | WasiAI | Por key cerrada con saldo | ~$0.03 | ✅ Bajo |
| `transferWithAuthorization()` x402 | WasiAI → trasladado al consumer | Por invocación x402 | Dinámico | ✅ Neutral |
| `registerAgent()` agentes adicionales | **Creator** | 1x/agente | ~$0.05 | ✅ |
| `withdraw()` creator | **Creator** | Por retiro | ~$0.05 | ✅ |
| `depositForKey()` | **Consumer** | Por depósito | ~$0.05 | ✅ |
| ~~`recordInvocation()`~~ | ~~WasiAI~~ | ~~Por invocación~~ | ~~$0.03~~ | 🔴 Eliminar — WAS-132 |

---

## 9. Proyección de rentabilidad

### Escenario base: 1,000 invocaciones/día a $0.20 promedio

```
Revenue bruto:          $200.00/día
Fee 10% treasury:        $20.00/día

Costos de gas (optimizado, sin recordInvocation):
  settleKeyBatch():       $0.10/día
  refundKeyToEarnings():  $0.05/día (estimado)
  registerAgent() #1:     $0.05/día (estimado 1 agente nuevo/día)
  ─────────────────────────────────
  Total gas:              $0.20/día

Margen neto:            $19.80/día = 99%
```

### Sensibilidad al precio de AVAX

| Precio AVAX | Gas total/día | Margen |
|-------------|--------------|--------|
| $15 | ~$0.05 | 99.75% |
| $30 | ~$0.10 | 99.50% |
| $60 | ~$0.20 | 99.00% |
| $120 | ~$0.40 | 98.00% |
| $300 | ~$1.00 | 95.00% |

> El margen se mantiene alto incluso con AVAX a $300 porque el batch diario fija el gas independientemente del volumen de invocaciones.

---

## 10. Protecciones del contrato

| Riesgo | Mecanismo de protección |
|--------|------------------------|
| Cambio de fee malicioso | Timelock 48h — cualquier cambio espera 2 días antes de ejecutarse |
| Owner comprometido | Safe multisig 2-de-3 (condición entrada Mainnet — WAS-130) |
| Operador comprometido | Solo puede hacer settlements — sin privilegios admin desde NA-003 |
| WasiAI desaparece | `emergencyWithdrawKey()` trustless tras 30 días sin actividad del operador |
| Bug en contrato | `emergencyExit()` disponible para usuarios en cualquier momento |
| Fee excesiva propuesta | Hard cap de 30% inmutable en contrato |

---

## 11. Variables de configuración mantenibles

Valores que pueden cambiar sin redeploy. Viven en Supabase `platform_config` o env vars:

| Parámetro | Dónde vive | Valor actual | Quién puede cambiar |
|-----------|-----------|-------------|---------------------|
| `listing_fee_usdc` | Supabase `platform_config` | Por definir | Owner via Supabase |
| `PLATFORM_X402_GAS_FEE_THRESHOLD_USDC` | Env var Vercel | Por definir | Owner via Vercel |
| `platformFeeBps` | Contrato on-chain | 1000 (10%) | Owner via Safe multisig + 48h timelock |
| Early creator fee (0%) | Contrato on-chain | Por creator | Owner via Safe multisig |

---

## 12. Hoja de ruta económica

| HU | Descripción | Sprint |
|----|-------------|--------|
| WAS-132 | Eliminar `recordInvocation()` — mayor ahorro de gas | 20 |
| WAS-133 | Gas fee dinámico x402 + banner Agent Key | 20 |
| WAS-131 | Freemium publish — listing fee en agentes adicionales | 20 |
| WAS-134 | Facilitador x402 propio en mainnet | 20 |
| WAS-135 | Docs transparencia para usuarios | 20 |
| WAS-130 | Safe multisig — condición entrada Mainnet | 20 |

---

*Documento generado por San (SM/Analyst) · Revisado y aprobado por Fer (PO) · 2026-03-03*
