# Story File #012 — Documentación WasiAI (rewrite completo)
> Architect · SPEC_APPROVED · 2026-03-01
> Dev SOLO lee este archivo. No consultar SDD ni Work Item.

---

## Goal
Reescribir la documentación completa de WasiAI para nivel dApp pro. Corregir URLs, usar agentes reales, agregar 5 secciones nuevas (x402, Compose, Agent Keys, Creator Guide, AgentKit) y actualizar sidebar + i18n.

---

## Acceptance Criteria

| # | AC |
|---|---|
| AC1 | WHEN un developer abre `/en/docs`, THE sidebar SHALL mostrar todas las secciones (incluye x402, Compose, Agent Keys, Creator Guide, AgentKit) |
| AC2 | WHEN lee Quickstart, THE ejemplos SHALL usar `wasi-defi-sentiment` y URL `wasiai-v2.vercel.app` |
| AC3 | WHEN lee API Reference, THE docs SHALL incluir invoke, compose, agent-keys, balance endpoints reales |
| AC4 | WHEN lee x402 Payments, THE docs SHALL explicar ERC-3009 + flujo completo con código real |
| AC5 | WHEN lee Creator Guide, THE docs SHALL cubrir publicar agente, fees 90/10, wallet, analytics, withdraw |
| AC6 | WHEN lee Compose, THE docs SHALL mostrar pipeline real con parallel + pass_output |
| AC7 | WHEN lee AgentKit, THE docs SHALL mostrar código real del ejemplo con link al repo wasiai-agents |
| AC8 | WHILE navega, THE sidebar SHALL tener scroll-spy activo para todas las secciones |

---

## Archivos — Wave 0: i18n + sidebar (hacer PRIMERO)

### messages/en.json — agregar al objeto "docs"
```json
"x402": "x402 Payments",
"compose": "Compose API",
"agentKeys": "Agent Keys",
"creatorGuide": "Creator Guide",
"agentkit": "AgentKit"
```

### messages/es.json — agregar al objeto "docs"
```json
"x402": "Pagos x402",
"compose": "Compose API",
"agentKeys": "Agent Keys",
"creatorGuide": "Guía del Creator",
"agentkit": "AgentKit"
```

### DocsSidebar.tsx — agregar al array SECTION_KEYS (al final, antes del cierre)
```typescript
{ id: 'x402',          key: 'x402'         },
{ id: 'compose',       key: 'compose'      },
{ id: 'agent-keys',    key: 'agentKeys'    },
{ id: 'creator-guide', key: 'creatorGuide' },
{ id: 'agentkit',      key: 'agentkit'     },
```
⚠️ El `id` debe coincidir EXACTAMENTE con el `id` del `<section>` en cada componente.

### app/[locale]/docs/page.tsx — agregar imports y renders
Agregar al final de las imports existentes:
```typescript
import { X402Section }        from '@/features/docs/content/x402'
import { ComposeSection }     from '@/features/docs/content/compose'
import { AgentKeysSection }   from '@/features/docs/content/agent-keys'
import { CreatorGuideSection } from '@/features/docs/content/creator-guide'
import { AgentKitSection }    from '@/features/docs/content/agentkit'
```
Agregar al final del JSX (después de ErrorsSection), mismo patrón:
```tsx
<div className="border-t border-gray-100 pt-8">
  <X402Section />
</div>
<div className="border-t border-gray-100 pt-8">
  <ComposeSection />
</div>
<div className="border-t border-gray-100 pt-8">
  <AgentKeysSection />
</div>
<div className="border-t border-gray-100 pt-8">
  <CreatorGuideSection />
</div>
<div className="border-t border-gray-100 pt-8">
  <AgentKitSection />
</div>
```

---

## Archivos — Wave 1: modificar existentes

### quickstart.tsx — cambios
1. URL curl: `https://wasiai-v2.vercel.app/api/v1/agents/wasi-defi-sentiment/invoke`
2. Header auth: `X-API-Key: wai_your_key_here` (no `X-API-Key` genérico)
3. Ejemplo Node.js: invocar `wasi-defi-sentiment` con `{ input: '{"token_name":"AVAX","token_symbol":"AVAX"}' }`
4. Ejemplo Python: mismo agente
5. Tip box: mencionar que los agentes DeFi Risk son los disponibles en el marketplace

### sdk-node.tsx — cambios
Reemplazar todos los ejemplos de `translator-es` por `wasi-defi-sentiment`:
```javascript
// Invoke
const result = await client.agents.invoke('wasi-defi-sentiment', {
  input: JSON.stringify({
    token_name: 'SafeMoonElonGem',
    token_symbol: 'SMEG',
    description: '100x guaranteed returns!'
  })
})
console.log(result.output) // { sentiment_score: 92, flags: [...], analysis: "..." }

// List
const agents = await client.agents.list({ category: 'defi-risk', limit: 10 })

// Get
const agent = await client.agents.get('wasi-defi-sentiment')
console.log(agent.name)          // "DeFi Sentiment Analyzer"
console.log(agent.pricePerCall)  // 0.05
```

### sdk-python.tsx — cambios
Mismo patrón — reemplazar `translator-es` por `wasi-defi-sentiment` con input real.

### api-reference.tsx — cambios completos
Base URL: `https://wasiai-v2.vercel.app/api/v1`
Auth: `X-API-Key: wai_...` header

Endpoints a documentar (usar EndpointCard para cada uno):

**1. POST /models/:slug/invoke** (ya existe — corregir path y response)
```json
// Response
{
  "output": { "sentiment_score": 87, "flags": ["FOMO naming"], "analysis": "..." },
  "latency_ms": 1240,
  "agent_slug": "wasi-defi-sentiment",
  "tx_hash": "0xabc...",
  "receipt_signature": "0xdef..."
}
```

**2. GET /agents** — listar agentes (ya existe — corregir response con campos reales)
```json
// Response item
{
  "id": "uuid",
  "slug": "wasi-defi-sentiment",
  "name": "DeFi Sentiment Analyzer",
  "category": "defi-risk",
  "price_per_call": 0.05,
  "currency": "USDC",
  "status": "active",
  "creator": { "username": "wasiai" }
}
```

**3. POST /v1/compose** — pipeline de agentes (NUEVO)
```
Body: { steps: ComposeStep[], api_key: string }
ComposeStep: { agent_slug, input?, pass_output?, parallel? }
Max 5 steps
```
Response:
```json
{
  "pipeline_id": "uuid",
  "steps_executed": 3,
  "groups_executed": 2,
  "total_cost_usdc": "0.15",
  "result": { ... },
  "receipts": [{ "step": 0, "agent_slug": "...", "cost_usdc": "0.05", "receipt_signature": "0x..." }]
}
```

**4. GET /v1/agent-keys/me** — balance de la key actual
```
Auth: X-API-Key: wai_...
Response: { key_id, name, budget_usdc, spent_usdc, remaining_usdc, created_at }
```

### mcp.tsx — cambios
1. URL: `https://wasiai-v2.vercel.app/api/v1/mcp?key=wai_YOUR_KEY`
2. Tool name ejemplo: `wasiai_wasi_defi_sentiment` (no `wasiai_gpt_translator_pro`)
3. Ejemplo prompt: análisis DeFi de token real

### errors.tsx — agregar fila x402
```
status: 402, code: 'PAYMENT_REQUIRED',
description: 'x402 payment required — the request needs a valid X-402-Payment header with ERC-3009 signature.',
solution: 'Sign the ERC-3009 authorization and include it as X-402-Payment header. See x402 Payments docs.'
```

---

## Archivos — Wave 2: secciones nuevas

### x402.tsx — CREAR
```typescript
export function X402Section() {
  return (
    <section id="x402" className="scroll-mt-20 space-y-8">
      ...
    </section>
  )
}
```

Contenido:
1. **¿Qué es x402?** — protocolo de micropagos HTTP nativo. HTTP 402 Payment Required. WasiAI lo usa sobre Avalanche C-Chain con USDC.
2. **Cuándo se usa** — cuando invocas un agente SIN Agent Key. Para agentes autónomos que pagan on-demand.
3. **Flujo completo** (diagrama textual en CodeBlock):
```
1. POST /api/v1/models/wasi-defi-sentiment/invoke (sin header de pago)
   → 402 Payment Required + payment requirements (amount, recipient, chain)

2. Firmar ERC-3009 transferWithAuthorization con viem:
   - from: tu wallet
   - to: 0x9d8Eb04Df6Bd271491Bcdbb96b81Ab3103C0CD8E (contrato WasiAI Fuji)
   - value: price_per_call en USDC atomics (0.05 USDC = 50000)
   - validBefore: now + 3600s

3. Construir X-402-Payment header:
   Base64(JSON({ from, to, value, validAfter, validBefore, nonce, v, r, s }))

4. POST /api/v1/models/wasi-defi-sentiment/invoke con header
   → 200 OK + resultado + receipt_signature
```
4. **Código real** — mostrar `pay.ts` del ejemplo AgentKit (signERC3009Payment function)
5. **Verificar el receipt** — ECDSA signature del operador WasiAI, verificable on-chain
6. **Contratos Fuji**:
   - Marketplace: `0x9d8Eb04Df6Bd271491Bcdbb96b81Ab3103C0CD8E`
   - USDC: `0x5425890298aed601595a70AB815c96711a31Bc65`

### compose.tsx — CREAR
```typescript
export function ComposeSection() {
  return (
    <section id="compose" className="scroll-mt-20 space-y-8">
      ...
    </section>
  )
}
```

Contenido:
1. **Qué es** — encadenar hasta 5 agentes en un pipeline. Un solo request, múltiples agentes.
2. **Modos**: serial (default) y paralelo (`parallel: true`)
3. **pass_output** — pasar output del step anterior como input del siguiente
4. **Ejemplo serial** (3 agentes DeFi en cadena):
```json
POST /api/v1/compose
{
  "steps": [
    { "agent_slug": "wasi-chainlink-price", "input": "{\"feed_address\":\"0x...\",\"token_symbol\":\"AVAX\"}" },
    { "agent_slug": "wasi-defi-sentiment",  "input": "{\"token_name\":\"AVAX\",\"token_symbol\":\"AVAX\"}", "pass_output": false },
    { "agent_slug": "wasi-risk-report",     "pass_output": true }
  ],
  "api_key": "wai_your_key_here"
}
```
5. **Ejemplo paralelo** (2 agentes en paralelo):
```json
{
  "steps": [
    { "agent_slug": "wasi-chainlink-price", "input": "...", "parallel": true },
    { "agent_slug": "wasi-defi-sentiment",  "input": "...", "parallel": true },
    { "agent_slug": "wasi-risk-report", "pass_output": true }
  ]
}
```
6. **Límites**: MAX_STEPS=5, timeout 8s por step, rate limit 10/min
7. **Response** con receipts por step

### agent-keys.tsx — CREAR
```typescript
export function AgentKeysSection() {
  return (
    <section id="agent-keys" className="scroll-mt-20 space-y-8">
      ...
    </section>
  )
}
```

Contenido:
1. **Qué es una Agent Key** — prepago en USDC. Creas la key con un budget, cada llamada deduce `price_per_call`.
2. **Crear una key**:
```bash
# Via dashboard: wasiai-v2.vercel.app/en/agent-keys
# O via API:
curl -X POST https://wasiai-v2.vercel.app/api/agent-keys \
  -H "Content-Type: application/json" \
  -H "Cookie: <session>" \
  -d '{"name": "mi-agente", "budget_usdc": 10}'
# → { "key": "wai_xxxx", "budget_usdc": 10 }
# ⚠️ La key solo se muestra una vez
```
3. **Usar la key** — header `X-API-Key: wai_...`
4. **Ver balance** — `GET /api/v1/agent-keys/me`
5. **Fondear on-chain** — depositar USDC via ERC-3009 (el dashboard lo hace automáticamente)
6. **Límites**: 1–1000 USDC por key
7. **Lifecycle**: activa → low balance warning → agotada → refund disponible

### creator-guide.tsx — CREAR
```typescript
export function CreatorGuideSection() {
  return (
    <section id="creator-guide" className="scroll-mt-20 space-y-8">
      ...
    </section>
  )
}
```

Contenido:
1. **Qué es un creator** — cualquier developer puede publicar un agente y cobrar en USDC automáticamente
2. **Requisitos**:
   - Endpoint HTTP que acepta POST con `{ input: string }`
   - Cuenta en WasiAI con wallet EVM conectada
3. **Publicar un agente** — formulario en `/en/publish`:
```json
{
  "name": "Mi Agente",
  "slug": "mi-agente",
  "description": "Hace X con Y.",
  "category": "nlp",
  "price_per_call": 0.05,
  "endpoint_url": "https://mi-servidor.com/api/invoke",
  "capabilities": ["text", "json"]
}
```
4. **Modelo de fees**: 90% creator / 10% WasiAI platform — automático, on-chain
5. **Recibir pagos**: conectar wallet EVM → los earnings se acumulan on-chain → `withdraw()` cuando quieras
6. **Analytics**: calls totales, revenue USDC, latencia promedio, error rate — en `/en/dashboard`
7. **Rate limits configurables**: max RPM y RPD por consumer desde el dashboard
8. **Security**: WasiAI valida tu endpoint con SSRF protection — no acepta IPs privadas

### agentkit.tsx — CREAR
```typescript
export function AgentKitSection() {
  return (
    <section id="agentkit" className="scroll-mt-20 space-y-8">
      ...
    </section>
  )
}
```

Contenido:
1. **Qué es** — agente autónomo que descubre, paga e invoca otros agentes. "Agent paying agent."
2. **Stack**: Coinbase AgentKit + viem + x402 protocol
3. **Flujo** (textual):
```
CDP Wallet (AgentKit) → descubrir precio en catálogo WasiAI → 
firmar ERC-3009 → invocar agente con X-402-Payment → recibir resultado
```
4. **Código real** — mostrar los fragmentos clave de wallet.ts e index.ts del repo:
```typescript
// wallet.ts — CDP wallet adapter
import { CdpWalletProvider } from '@coinbase/agentkit'
const provider = await CdpWalletProvider.configureWithWallet({
  apiKeyName:       process.env.CDP_API_KEY_ID,
  apiKeyPrivateKey: process.env.CDP_API_KEY_SECRET,
})
const agentAddress = provider.getAddress()
```
```typescript
// index.ts — flujo completo
const agent = await getCatalogAgent(baseUrl, 'wasi-defi-sentiment')
const payment = await signERC3009Payment({ walletClient, from, to: CONTRACT, priceUsdc: agent.price_usdc })
const result = await invokeAgent({ invokeUrl: agent.invoke_url, payment, input })
```
5. **Link al repo**:
   - `wasiai-agents/agents/agentkit-example/` — ejemplo completo con README
   - GitHub: `github.com/ferrosasfp/wasiai-agents`
6. **Prerequisitos**: CDP API Key (portal.cdp.coinbase.com) + USDC Fuji en la wallet

---

## Constraint Directives

### OBLIGATORIO
- Cada `<section>` debe tener `id=` exactamente igual al `id` en SECTION_KEYS del sidebar
- Usar `<CodeBlock tabs={[{label, language, code}]}>` para TODOS los bloques
- Usar `<EndpointCard>` para TODOS los endpoints en api-reference.tsx
- URL base siempre: `https://wasiai-v2.vercel.app/api/v1`
- Contrato Fuji: `0x9d8Eb04Df6Bd271491Bcdbb96b81Ab3103C0CD8E`
- Agentes reales: `wasi-defi-sentiment`, `wasi-chainlink-price`, `wasi-onchain-analyzer`, `wasi-risk-report`
- i18n keys en EN y ES antes de usar en sidebar

### PROHIBIDO
- NO modificar `EndpointCard.tsx`, `CodeBlock.tsx`, `TryIt.tsx`
- NO usar URL `wasiai.com` o `wasiai.vercel.app` (sin -v2)
- NO inventar agentes ficticios (`translator-es`, `summarizer`, etc.)
- NO modificar `app/[locale]/docs/layout.tsx`
- NO agregar dependencias npm
- NO cambiar el diseño visual de los componentes existentes

---

## Waves

### W0 — i18n + sidebar + page.tsx (serial, hacer PRIMERO)
1. Agregar keys a `messages/en.json` (objeto docs)
2. Agregar keys a `messages/es.json` (objeto docs, en español)
3. Actualizar `DocsSidebar.tsx` — agregar 5 entradas a SECTION_KEYS
4. Actualizar `app/[locale]/docs/page.tsx` — imports + renders
5. Verificar: `npx tsc --noEmit` pasa

### W1 — Modificar archivos existentes (paralelo)
- Actualizar `quickstart.tsx`
- Actualizar `sdk-node.tsx`
- Actualizar `sdk-python.tsx`
- Actualizar `api-reference.tsx`
- Actualizar `mcp.tsx`
- Actualizar `errors.tsx`
5. Verificar: `npx tsc --noEmit` pasa

### W2 — Crear secciones nuevas (paralelo)
- Crear `x402.tsx`
- Crear `compose.tsx`
- Crear `agent-keys.tsx`
- Crear `creator-guide.tsx`
- Crear `agentkit.tsx`
5. Verificar: `npx tsc --noEmit` pasa limpio

### W3 — Commit
```bash
git add -A
git commit -m "docs(WAS-docs): rewrite completo — x402, compose, agent-keys, creator-guide, agentkit"
git push origin master master:main
```

---

## Out of Scope
- Tests (es contenido, no lógica)
- Cambios de layout o diseño
- Nuevos componentes UI
- Modificar rutas

---

## Escalation Rule
Si algún componente (CodeBlock, EndpointCard) tiene una interfaz diferente a la documentada aquí — PARAR y preguntar a Architect. No improvisar props.
