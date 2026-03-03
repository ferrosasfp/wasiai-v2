# WasiAI — Modelo Económico
> Documento de referencia interno y base para la documentación pública de la Dapp.
> Decisiones tomadas el 2026-03-03.

---

## Filosofía

WasiAI opera con transparencia total de fees. El usuario sabe exactamente qué paga, por qué, y a dónde va cada centavo. No hay letra pequeña.

---

## Fee del Marketplace

| Quién | Cuánto | Cuándo |
|-------|--------|--------|
| **Creator** | 90% de cada invocación | Al hacer withdraw() |
| **WasiAI (treasury)** | 10% de cada invocación | Automático on-chain |

El 10% cubre: infraestructura, operación del operador, gas del settlement batch, y desarrollo de la plataforma.

**El % no cambia según el flujo de pago.** Creator siempre recibe 90%.

---

## Flujos de Pago

### Agent Key — Para uso frecuente

El usuario deposita USDC on-chain en su Agent Key. Cada invocación descuenta del saldo.

```
Usuario deposita $10 USDC → puede hacer ~100 invocaciones a $0.10
Costo por invocación: exactamente el precio del agente
Gas: $0 por invocación (el operador hace 1 settle batch diario)
```

**Recomendado para:** integraciones, agentes autónomos, uso frecuente.

### x402 — Para uso esporádico

El usuario paga por cada invocación individualmente, sin depósito previo.

```
Cada invocación → tx on-chain → el operador paga gas de esa tx
Costo por invocación: precio del agente + gas fee ($0.03)
```

El gas fee existe porque cada pago x402 es una transacción blockchain real. El operador ejecuta esa transacción y el costo se traslada al usuario de forma transparente.

**Recomendado para:** pruebas, uso esporádico, sin compromiso de depósito.

### Comparativa

| | Agent Key | x402 |
|--|-----------|------|
| Agente a $0.10 | **$0.10** | $0.13 (+$0.03 gas) |
| Agente a $0.50 | **$0.50** | $0.53 (+$0.03 gas) |
| Agente a $2.00 | **$2.00** | $2.03 (+$0.03 gas) |
| Setup inicial | Depósito USDC | Ninguno |
| Mejor para | Uso frecuente | Uso esporádico |

---

## Publicación de Agentes (Modelo Freemium)

| | Primer agente | Agentes adicionales |
|--|--------------|---------------------|
| **Gas de registro** | WasiAI lo paga | Creator lo paga |
| **Listing fee** | Gratis | $X USDC (TBD) |
| **Wallet requerida** | No | Sí |

El primer agente es gratis para que cualquier developer pueda publicar sin fricción. Los agentes adicionales requieren wallet y una pequeña listing fee que cubre el costo operativo de registro y filtra spam.

---

## ¿Por qué existe el gas fee?

WasiAI está construido sobre Avalanche — una blockchain pública. Cada transacción financiera (pago, settlement, registro) requiere gas pagado en AVAX.

A diferencia de plataformas centralizadas que absorben estos costos en su infraestructura, WasiAI los hace explícitos porque:

1. **Transparencia** — sabes exactamente qué pagas y por qué
2. **Descentralización** — no hay intermediario que "magicamente" absorba costos
3. **Sostenibilidad** — el modelo es rentable sin subsidios ocultos

El gas es mínimo (~$0.03 por transacción x402 en Avalanche) y tiende a ser más barato que los fees bancarios tradicionales.

---

## Retiro de Earnings (Creators)

Los creators acumulan earnings en el contrato. El retiro es self-custody:

```
Creator llama withdraw() → USDC va directo a su wallet
Gas: lo paga el creator (~$0.05 AVAX)
Sin intermediario, sin aprobación de WasiAI
```

---

## Agent Keys — Cierre y Reembolso

Al cerrar una Agent Key con saldo:

```
Saldo > $0 → operador ejecuta refundKeyToEarnings()
             → saldo aparece en earnings del usuario
             → usuario retira con withdraw() cuando quiera
Saldo = $0 → cierre instantáneo, sin tx
```

El operador paga el gas del reembolso. El usuario no necesita AVAX para recuperar sus fondos.

---

## Resumen de quién paga gas

| Operación | Quién paga gas |
|-----------|---------------|
| Registrar agente #1 | WasiAI (operador) |
| Registrar agente #2+ | Creator |
| Pago x402 | Usuario (gas fee incluido en precio) |
| Depósito Agent Key | Usuario |
| Settlement batch diario | WasiAI (operador) — costo fijo |
| Retiro de earnings | Creator |
| Reembolso de Agent Key | WasiAI (operador) |

---

## Sostenibilidad del modelo

Con Agent Keys como flujo principal:
- Gas de WasiAI = ~$0.10/día fijo (1 batch diario)
- Revenue escala con el volumen sin escalar el gas
- Margen > 95% en escenarios de volumen medio-alto

Con x402:
- Gas variable pero trasladado al usuario vía gas fee
- Funciona como incentivo para migrar a Agent Keys

---

*Última actualización: 2026-03-03 — decisiones tomadas en sesión de diseño económico*
