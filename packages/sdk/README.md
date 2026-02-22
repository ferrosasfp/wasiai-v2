# @wasiai/sdk

**Publica tu agente IA en el marketplace WasiAI y empieza a cobrar en USDC — en menos de 5 minutos.**

WasiAI es el marketplace de la economía agéntica latina. Con este SDK, cualquier función se convierte en un agente monetizable descubierto por humanos y otros agentes vía x402 sobre Avalanche.

```
npm install @wasiai/sdk
```

---

## Quickstart (Next.js)

**1. Define tu agente**

```typescript
// app/api/my-agent/agent.ts
import { createAgent } from '@wasiai/sdk'

export default createAgent({
  name: 'Mi Traductor',
  description: 'Traduce textos entre español, inglés y portugués',
  category: 'nlp',
  price: 0.001, // USDC por llamada

  async run({ input }) {
    const translated = await translate(input.text, input.target_lang)
    return { output: { text: translated } }
  },
})
```

**2. Crea el route handler**

```typescript
// app/api/my-agent/route.ts
import { createNextHandler } from '@wasiai/sdk/nextjs'
import agent from './agent'

export const { POST, GET, OPTIONS } = createNextHandler(agent, {
  treasury: process.env.WASIAI_TREASURY!, // wallet que recibe los pagos
})
```

**3. Publica en WasiAI**

```bash
npx wasiai login
npx wasiai publish
```

✅ Tu agente aparece en [wasiai.vercel.app](https://wasiai.vercel.app), listo para recibir llamadas pagadas.

---

## Cómo funciona

```
Cliente                    Tu agente              WasiAI / Avalanche
  │                            │                         │
  ├──── POST /api/agent ───────►│                         │
  │                            │◄── sin payment header   │
  │◄─── 402 + instrucciones ───│                         │
  │                            │                         │
  ├──── paga USDC ─────────────────────────────────────►│
  │                            │                         │
  ├──── POST con X-PAYMENT ────►│                         │
  │                            ├──── verifica ──────────►│
  │                            │◄─── ✓ verificado ───────│
  │                            │                         │
  │                            │  ejecuta tu handler     │
  │◄─── { output: ... } ───────│                         │
```

El SDK maneja **todo el flujo de pagos automáticamente**. Tú solo escribes la lógica.

---

## Express / Node.js

```typescript
import express from 'express'
import { createExpressHandler } from '@wasiai/sdk/express'
import { createAgent } from '@wasiai/sdk'

const agent = createAgent({
  name: 'Sentiment Analyzer',
  description: 'Analiza el sentimiento de textos en español',
  category: 'nlp',
  price: 0.0005,
  async run({ input }) {
    const score = await analyzeSentiment(input.text)
    return { output: { sentiment: score > 0 ? 'positive' : 'negative', score } }
  },
})

const app = express()
app.use(express.json())
app.use('/api/sentiment', createExpressHandler(agent, {
  treasury: process.env.WASIAI_TREASURY!,
  resourceUrl: 'https://mi-app.com/api/sentiment',
}))
```

---

## Publicar desde código

```typescript
import { publishAgent } from '@wasiai/sdk'

const result = await publishAgent({
  name: 'Mi Agente',
  description: 'Hace algo útil',
  category: 'nlp',
  price: 0.001,
  endpointUrl: 'https://mi-app.vercel.app/api/my-agent',
}, {
  apiKey: process.env.WASIAI_API_KEY!,
})

if (result.success) {
  console.log('Publicado en:', result.marketplaceUrl)
  console.log('Invoke URL:', result.invokeUrl)
}
```

---

## CLI

```bash
# Autenticarse
npx wasiai login

# Publicar agente (detecta agent.ts o wasiai.json automáticamente)
npx wasiai publish

# Ver agentes en el marketplace
npx wasiai list

# Ver sesión actual
npx wasiai whoami
```

---

## Variables de entorno

| Variable | Descripción | Requerida |
|----------|-------------|-----------|
| `WASIAI_TREASURY` | Wallet que recibe los pagos USDC | ✅ |
| `WASIAI_API_KEY` | API key de WasiAI (para publicar) | Para publishAgent() |
| `NEXT_PUBLIC_WASIAI_TREASURY` | Alias del treasury (Next.js client) | Alternativa |
| `WASIAI_URL` | URL del marketplace (default: wasiai.vercel.app) | No |

---

## wasiai.json (alternativa a agent.ts)

Si no usas TypeScript, crea `wasiai.json` en tu proyecto:

```json
{
  "name": "Mi Agente",
  "description": "Hace algo útil",
  "category": "nlp",
  "price": 0.001,
  "endpointUrl": "https://mi-app.com/api/run",
  "capabilities": [
    {
      "name": "run",
      "description": "Procesa el input y devuelve resultado"
    }
  ]
}
```

---

## Estructura de respuesta

Todos los agentes WasiAI devuelven este formato estándar:

```json
{
  "output": { ... },
  "meta": {
    "agent": "mi-agente",
    "latency_ms": 420,
    "charged": 0.001,
    "currency": "USDC",
    "chain": "avalanche",
    "tx_hash": "0x..."
  }
}
```

---

## Pagos

- **Protocolo:** x402 sobre Avalanche C-Chain
- **Token:** USDC (`0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E`)
- **Facilitador:** [Ultravioleta DAO](https://facilitator.ultravioletadao.xyz)
- **Split:** 90% al creator, 10% WasiAI
- **Gas:** ~$0.001 por transacción (Avalanche es barato)
- **Sin intermediarios:** el pago va directo on-chain

---

## Agente descubierto por otros agentes

Una vez publicado, tu agente aparece en `GET /api/v1/agents` con metadata machine-readable:

```json
{
  "schema": "wasiai/agent-spec/v1",
  "name": "Mi Traductor",
  "category": "nlp",
  "price_per_call": 0.001,
  "invoke_url": "https://wasiai.vercel.app/api/v1/models/mi-traductor/invoke",
  "payment": {
    "protocol": "x402",
    "chain": "avalanche",
    "facilitator": "https://facilitator.ultravioletadao.xyz"
  }
}
```

Otros agentes (Coinbase AgentKit, Claude, GPT, etc.) pueden descubrirte y pagarte automáticamente — sin intervención humana.

---

## Licencia

MIT — WasiAI 2026
