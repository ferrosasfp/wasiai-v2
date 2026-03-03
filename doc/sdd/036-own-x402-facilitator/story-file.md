# Story File #036 — WAS-134: Facilitador x402 propio en mainnet
> Dev lee SOLO este archivo. No consultar SDD ni Work Item.

## Goal
Eliminar la dependencia de `uvd-x402-sdk` (UltravioletaDAO) de `invoke/route.ts`.
`settlePaymentDirectly()` en `usdcSettler.ts` ya soporta Fuji Y mainnet.
Solo hay que unificar el routing y reemplazar dos utilidades del SDK con código local.

## Acceptance Criteria
- AC1: chainId 43114 → usa `settlePaymentDirectly()` (no FacilitatorClient)
- AC2: chainId 43113 → comportamiento idéntico al actual
- AC3: build y typecheck pasan sin errores después de eliminar import uvd-x402-sdk
- AC4: `.env.example` marca `X402_FACILITATOR_URL` como deprecated

## Archivos a modificar

| Archivo | Acción |
|---------|--------|
| `src/app/api/v1/models/[slug]/invoke/route.ts` | Modificar — ver Waves |
| `src/lib/contracts/usdcSettler.ts` | Actualizar comentario JSDoc header únicamente |
| `.env.example` | Marcar X402_FACILITATOR_URL como deprecated |

**NO tocar:**
- `package.json` — uvd-x402-sdk puede quedar como dependencia transitiva
- `usdcSettler.ts` lógica de firma/verificación
- Flujo Agent Key

## Waves

### W1 — Leer invoke/route.ts completo (obligatorio, anti-alucinación)
1. Leer el archivo completo antes de tocar nada
2. Identificar exactamente las líneas del import `uvd-x402-sdk/backend`
3. Identificar todas las referencias a: `FacilitatorClient`, `extractPaymentFromHeaders`, `X402_CORS_HEADERS`, `import('uvd-x402-sdk')`
4. Confirmar que `buildRequirements()` es local (no viene del SDK)

### W2 — Inlinar utilidades del SDK
Reemplazar el import:
```ts
import {
  FacilitatorClient,
  extractPaymentFromHeaders,
  X402_CORS_HEADERS,
} from 'uvd-x402-sdk/backend'
```

Con constante y función locales (pegar exactamente):
```ts
// WAS-134: x402 utilities inlineadas — eliminada dependencia de uvd-x402-sdk
const X402_CORS_HEADERS = {
  'Access-Control-Allow-Headers': 'Content-Type, X-PAYMENT, PAYMENT-SIGNATURE, Authorization',
  'Access-Control-Expose-Headers': 'X-PAYMENT-RESPONSE, PAYMENT-RESPONSE, PAYMENT-REQUIRED',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
} as const

function extractPaymentFromHeaders(headers: Headers | Record<string, string | string[] | undefined>): Record<string, string> | null {
  const normalized: Record<string, string> = {}
  const entries = headers instanceof Headers
    ? Array.from(headers.entries())
    : Object.entries(headers)
  for (const [key, value] of entries) {
    if (typeof value === 'string') normalized[key.toLowerCase()] = value
    else if (Array.isArray(value) && value.length > 0) normalized[key.toLowerCase()] = value[0]
  }
  const payment = normalized['x-payment'] ?? normalized['payment-signature'] ?? null
  if (!payment) return null
  try { return JSON.parse(Buffer.from(payment, 'base64').toString('utf-8')) }
  catch { return null }
}
```

### W3 — Simplificar settleX402()
Reemplazar el bloque `else` con FacilitatorClient:

**ANTES:**
```ts
async function settleX402(...): Promise<SettlementResult | NextResponse> {
  if (CHAIN_ID_NUM === 43113) {
    const evmPayload = paymentHeader?.payload as X402EVMPayload | undefined
    if (!evmPayload?.authorization || !evmPayload?.signature) {
      return NextResponse.json({ error: 'Invalid payment header', code: 'payment_invalid' }, { status: 402 })
    }
    const atomicRequired = Math.round(parseFloat(priceStr) * 1_000_000).toString()
    return settlePaymentDirectly(evmPayload, atomicRequired)
  } else {
    const requirements = buildRequirements({ ... })
    const facilitatorUrl = (process.env.X402_FACILITATOR_URL ?? 'https://facilitator.ultravioletadao.xyz').trim()
    const facilitator = new FacilitatorClient({ baseUrl: facilitatorUrl })
    return facilitator.verifyAndSettle(paymentHeader as import('uvd-x402-sdk').X402Header, requirements)
  }
}
```

**DESPUÉS:**
```ts
// WAS-134: settlePaymentDirectly() cubre Fuji (43113) y mainnet (43114) — sin facilitador externo
async function settleX402(...): Promise<SettlementResult | NextResponse> {
  const evmPayload = paymentHeader?.payload as X402EVMPayload | undefined
  if (!evmPayload?.authorization || !evmPayload?.signature) {
    return NextResponse.json({ error: 'Invalid payment header', code: 'payment_invalid' }, { status: 402 })
  }
  const atomicRequired = Math.round(parseFloat(priceStr) * 1_000_000).toString()
  return settlePaymentDirectly(evmPayload, atomicRequired)
}
```

### W4 — Typecheck + limpieza
1. `npx tsc --noEmit` — sin errores
2. Si quedan referencias a `import('uvd-x402-sdk')` inline → eliminarlas
3. Actualizar comentario JSDoc en `usdcSettler.ts` header (solo el texto, no la lógica)
4. Marcar `X402_FACILITATOR_URL` como deprecated en `.env.example`

### W5 — Tests
1. `npx vitest run` — confirmar que los fallos son solo los 10 preexistentes
2. No deben aparecer nuevos fallos

## Constraint Directives

### OBLIGATORIO
- Leer invoke/route.ts completo antes de W2 — anti-alucinación
- Verificar que `buildRequirements()` es local antes de tocar imports
- Typecheck después de cada wave
- `extractPaymentFromHeaders` inlineada debe manejar tanto `Headers` como `Record<string, string>`

### PROHIBIDO
- NO eliminar `buildRequirements()` local — no viene del SDK
- NO tocar `usdcSettler.ts` lógica de firma ni verificación EIP-712
- NO modificar flujo Agent Key
- NO tocar `package.json`
- NO inventar nada que no esté en este Story File

## Escalation Rule
Si algo no está en este Story File → PARAR y preguntar al Architect.
