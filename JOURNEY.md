# WasiAI — User Journey v2

> Diseñado para fricción cero. Cada actor llega a su primer valor útil en el menor número de pasos posible.

---

## Principios de diseño

- **Zero-to-value < 60s** para humanos, **< 3 llamadas HTTP** para agentes
- **Progressive disclosure**: nunca mostrar complejidad hasta que sea necesaria
- **Fail fast, explain clear**: errores que te dicen exactamente qué hacer
- **Blockchain invisible**: el pago ocurre; el usuario no necesita entender cómo

---

## 🤖 Journey A — Agente IA (A2A) — El journey más importante

> Un agente que quiere usar WasiAI necesita exactamente 3 cosas:
> una URL base, una API key y saber qué modelo invocar.

### Fase 1: Setup único (se hace una sola vez)

```
[Humano o agente orquestador]

→ Entrar a wasiai.io/agent-keys
→ Crear API key: nombre + budget USDC máximo (ej: $5/día)
→ Guardar: wai_xxxxxxxxxxxxxx

✓ Listo. El agente ya puede operar de forma autónoma.
```

### Fase 2: Descubrir modelos (discovery)

```
GET /api/v1/models
  ?q=image-generation          ← búsqueda semántica (opcional)
  &category=vision             ← filtro por tipo (opcional)
  &max_price=0.05              ← filtro por precio máximo (opcional)
  &limit=10

← Responde con lista:
[
  {
    "slug": "flux-pro",
    "name": "Flux Pro",
    "category": "vision",
    "price_per_call": 0.02,
    "currency": "USDC",
    "chain": "avalanche",
    "description": "...",
    "invoke_url": "https://wasiai.io/api/v1/models/flux-pro/invoke"
  },
  ...
]

↓ El agente elige el modelo que necesita.
  No necesita saber nada más para seguir.
```

### Fase 3: Invocar el modelo (x402 automático)

```
[Intento 1 — sin pago]

POST /api/v1/models/flux-pro/invoke
Headers:
  x-agent-key: wai_xxxxxxxxxxxxxx
  Content-Type: application/json
Body:
  { "input": "a neon cat in space" }

← 402 Payment Required
  {
    "price": 0.02,
    "currency": "USDC",
    "chain": "avalanche",
    "accepts": ["x402/usdc-avalanche"]
  }

↓ El agente lee el 402.
  Paga automáticamente on-chain (Avalanche).
  No necesita aprobación humana — el budget ya fue autorizado.

─────────────────────────────────────────────

[Intento 2 — con proof of payment]

POST /api/v1/models/flux-pro/invoke
Headers:
  x-agent-key: wai_xxxxxxxxxxxxxx
  x-payment: <tx_hash_on_chain>
  Content-Type: application/json
Body:
  { "input": "a neon cat in space" }

← 200 OK
  {
    "result": { "image_url": "https://..." },
    "meta": {
      "model": "flux-pro",
      "latency_ms": 1240,
      "charged": 0.02,
      "currency": "USDC"
    }
  }

✓ El agente tiene su resultado. Puede seguir con el siguiente paso.
```

### Fase 4: Composabilidad (encadenar modelos)

```
Agente orquestador puede llamar múltiples modelos en secuencia:

INPUT
  ↓
[text-cleaner]          — limpia y estructura el prompt
  ↓
[flux-pro]              — genera imagen
  ↓
[image-captioner]       — describe la imagen generada
  ↓
OUTPUT enriquecido

Cada llamada es independiente.
Cada una tiene su propio pago x402.
El agente gestiona el flujo — WasiAI gestiona el acceso y el pago.
```

### Guardrails del agente

```
- Budget diario configurado en /agent-keys → nunca gasta de más
- Si el budget se agota → responde 402 con mensaje "budget_exceeded"
- Cada llamada queda logueada → auditable por el humano dueño de la key
- El agente puede consultar su balance restante:
  GET /api/v1/agent-keys/me → { budget: 5.00, spent: 1.20, remaining: 3.80 }
```

---

## 🔌 Journey B — LLM vía MCP (Claude / GPT / cualquier LLM)

> El camino más fácil. El LLM descubre y usa modelos de WasiAI como si fueran herramientas nativas.

```
[Setup único — 30 segundos]

1. Agregar WasiAI como servidor MCP:
   Endpoint: https://wasiai.io/api/v1/mcp
   Header:   x-agent-key: wai_xxxxxxxxxxxxxx

↓

[En cada conversación]

2. El LLM recibe automáticamente la lista de tools disponibles:
   - flux_pro(prompt: string) → image
   - gpt4o_mini(messages: array) → text
   - whisper_stt(audio_url: string) → transcript
   - ... (todos los modelos activos en WasiAI)

3. El LLM decide usar un tool:
   → WasiAI ejecuta el pago x402 automáticamente
   → Devuelve tool_result al LLM
   → El LLM integra el resultado en su respuesta

4. El usuario final recibe la respuesta enriquecida.
   No ve pagos, no ve blockchain, no ve APIs.
   Solo ve el resultado.

✓ Zero code del lado del developer.
✓ El LLM elige cuándo y qué usar.
✓ Cada uso queda pagado y registrado.
```

---

## 🧑‍🎨 Journey C — Creator (publica un modelo)

> De idea a modelo live en menos de 5 minutos.

```
[Paso 1 — Registro]
→ wasiai.io/signup
→ Email + password (sin wallet obligatoria todavía)
→ Supabase crea la cuenta
→ Trigger auto-crea creator_profile
✓ Ya tienes cuenta. Ves el dashboard vacío.

─────────────────────────────────────────────

[Paso 2 — Publicar modelo → /publish]
→ Llenas el formulario:

  Nombre:        "Flux Pro"
  Slug:          flux-pro  ← auto-generado, editable
  Categoría:     Vision / LLM / Audio / Code / Data / Other
  Descripción:   Para qué sirve, qué acepta, qué devuelve
  Endpoint URL:  https://tu-api.com/generate  ← donde vive tu modelo real
  Precio:        0.02 USDC por llamada

→ Submit → POST /api/models → guardado en Supabase
✓ Modelo aparece en el marketplace en segundos.

─────────────────────────────────────────────

[Paso 3 — Conectar wallet para recibir pagos]
→ Dashboard → Conectar wallet (MetaMask o Smart Account)
→ A partir de aquí cada llamada a tu modelo
  deposita el 80% directo a tu wallet on-chain.
  WasiAI retiene el 20%.

─────────────────────────────────────────────

[Paso 4 — Ver ingresos → /creator/dashboard]
→ Stats en tiempo real:
  - Total llamadas hoy / este mes
  - USDC ganado
  - Latencia promedio de tu modelo
  - Últimas llamadas (quién, cuándo, resultado)
→ Puedes pausar o eliminar tu modelo en cualquier momento.
```

---

## 👤 Journey D — Consumer humano

> Usar un modelo sin tener cuenta. Sin fricción hasta que toca pagar.

```
[Paso 1 — Descubrir → wasiai.io]
→ Grid de modelos disponibles
→ Filtros: categoría, precio, popularidad
→ No necesita cuenta para browsear.

─────────────────────────────────────────────

[Paso 2 — Probar → /models/[slug]]
→ Ve la descripción, precio, ejemplos
→ Escribe su input en el textarea
→ Hace clic en "Pay & Call"

─────────────────────────────────────────────

[Paso 3 — Pago con wallet]
→ Si no tiene wallet conectada → "Connect Wallet" (MetaMask)
→ Aprueba el gasto de USDC
→ Transacción on-chain en Avalanche (~2 segundos)

─────────────────────────────────────────────

[Paso 4 — Resultado instantáneo]
← Respuesta del modelo en pantalla
→ Puede copiar, descargar o volver a llamar.

─────────────────────────────────────────────

[Opcional — Crear cuenta]
→ Para guardar historial de llamadas y no reconectar wallet cada vez
→ No es obligatorio para usar el marketplace.
```

---

## 📐 Mapa de fricción (qué tan fácil es cada paso)

```
ACTOR          PRIMER VALOR            PASOS    TIEMPO ESTIMADO
─────────────────────────────────────────────────────────────────
Agente IA      Primera llamada exitosa    3       < 30 segundos
LLM vía MCP   Primer tool disponible     2       < 60 segundos
Creator        Modelo publicado           2       < 5 minutos
Consumer       Primera respuesta          3       < 2 minutos
```

---

## ⚡ Quick Reference para agentes

```
# Descubrir modelos
GET  https://wasiai.io/api/v1/models

# Ver schema de un modelo
GET  https://wasiai.io/api/v1/models/{slug}/invoke

# Llamar modelo (con x402 automático)
POST https://wasiai.io/api/v1/models/{slug}/invoke
  x-agent-key: wai_xxx
  x-payment:   <tx_hash>  ← solo en el segundo intento
  body: { "input": "..." }

# Ver mi budget restante
GET  https://wasiai.io/api/v1/agent-keys/me
  x-agent-key: wai_xxx

# MCP endpoint
POST https://wasiai.io/api/v1/mcp
  x-agent-key: wai_xxx
```

---

## 🔑 Errores comunes y qué hacen los agentes con ellos

```
402  → Pagar y reintentar (siempre)
404  → El modelo no existe, buscar alternativa en /api/v1/models
503  → El endpoint del creator está caído, reintentar en 30s
429  → Rate limit, esperar el tiempo indicado en Retry-After header
402 + budget_exceeded → Notificar al humano, detener ejecución
```
