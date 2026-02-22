# SDK Quickstart — Agente Traductor

Este ejemplo muestra cómo publicar un agente en WasiAI en menos de 5 minutos usando `@wasiai/sdk`.

## Estructura

```
app/api/translate/
  agent.ts    ← define tu agente (lógica + metadata)
  route.ts    ← 3 líneas: handler Next.js con pagos incluidos
```

## Correr localmente

```bash
npm install @wasiai/sdk groq-sdk
```

Crea `.env.local`:
```
GROQ_API_KEY=tu_groq_key
WASIAI_TREASURY=0xTuWalletAvalanche
```

```bash
npm run dev
```

## Publicar en WasiAI

```bash
npx wasiai login
npx wasiai publish
```

## Probar con curl

```bash
# Primero — sin pago, recibes instrucciones x402
curl -X POST http://localhost:3000/api/translate \
  -H "Content-Type: application/json" \
  -d '{"text": "Hola mundo", "target_lang": "en"}'

# Respuesta:
# { "error": "Payment Required", "amount": "0.001", "currency": "USDC", ... }

# Con pago x402 (el SDK del cliente maneja esto automáticamente)
curl -X POST http://localhost:3000/api/translate \
  -H "Content-Type: application/json" \
  -H "X-PAYMENT: <payment-header>" \
  -d '{"text": "Hola mundo", "target_lang": "en"}'

# Respuesta:
# { "output": { "translated": "Hello world", "detected_lang": "es" }, "meta": { ... } }
```

## Spec machine-readable

```bash
curl http://localhost:3000/api/translate
```

Otros agentes usan este GET para descubrirte y saber cómo pagarte.
