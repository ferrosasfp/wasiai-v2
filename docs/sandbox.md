# Sandbox Gratuito — WAS-75

El Sandbox de WasiAI te permite probar agentes sin costo, con créditos iniciales y sin necesidad de configurar pagos. Ideal para integrar WasiAI en tu proyecto antes de pasar a producción.

---

## Cómo acceder

Ve a [wasiai-v2.vercel.app/sandbox](https://wasiai-v2.vercel.app/sandbox).

Necesitás una cuenta en WasiAI. Al registrarte, tu cuenta recibe automáticamente **$0.50 USDC en créditos sandbox** para comenzar.

---

## Créditos iniciales

| Concepto | Valor |
|----------|-------|
| Créditos al registrarse | $0.50 USDC |
| Válidos para | Todos los agentes del marketplace |
| Recarga manual | No disponible (Sprint 16) |

Los créditos se descuentan por invocación al precio del agente. Podés ver tu saldo restante en el panel del sandbox.

---

## Rate limit

El sandbox tiene un límite de **10 calls por hora** por cuenta.

Si superás el límite, recibís un `429 Too Many Requests` con el header `Retry-After` indicando cuándo podés volver a llamar.

---

## Diferencia con producción

| Característica | Sandbox | Producción |
|----------------|---------|------------|
| Costo | Créditos gratuitos ($0.50) | USDC real |
| Rate limit | 10 calls/hora | Sin límite (según plan) |
| Pagos on-chain | ❌ Simulados | ✅ Reales en Avalanche |
| Webhooks | ✅ Disponibles | ✅ Disponibles |
| Jobs asíncronos | ✅ Disponibles | ✅ Disponibles |
| SLA | Best effort | Garantizado |

> **Importante:** Los resultados de los agentes en sandbox son idénticos a producción. Solo difiere el modelo de pago.

---

## Ejemplo de uso

```bash
# El endpoint de sandbox es el mismo que producción
# La diferencia está en la agent key (sandbox key vs production key)

curl -X POST https://wasiai-v2.vercel.app/api/v1/agents/summarizer-pro/invoke \
  -H "Authorization: Bearer wasi_sandbox_tu_key" \
  -H "Content-Type: application/json" \
  -d '{ "input": { "text": "Texto a resumir..." } }'
```

Las sandbox keys se generan en `/sandbox` y tienen el prefijo `wasi_sandbox_`.

---

## Próximo: upgrade a producción

Cuando estés listo para producción:
1. Configurá tu wallet en el dashboard
2. Generá una production key en `/creator/dashboard`
3. Reemplazá `wasi_sandbox_` por `wasi_` en tus requests

Los pagos pasarán a ser reales en Avalanche desde ese momento.
