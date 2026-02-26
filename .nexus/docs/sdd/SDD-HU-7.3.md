# SDD-HU-7.3 — AgentKit Example (Script Standalone)

**Estado:** S1 — Software Design Document  
**HU origen:** HU-7.3 — AgentKit Example  
**Fecha:** 2026-02-26  
**Autor:** PM Agent (BMAD v6)  
**Proyecto:** WasiAI — Avalanche Build Games Hackathon  

---

## Decisiones del PO (no negociables)

| Decisión | Valor |
|----------|-------|
| Wallet | Private key desde `.env` — NO CDP Wallet |
| Agente invocado | `summarizer` (ya existe en Fuji) |
| Red | Fuji testnet (chain ID 43113) |
| Tipo | Script Node.js standalone — NO UI |
| Lib on-chain | viem v2 — PROHIBIDO ethers.js |
| Pagos | x402 + ERC-3009 |
| USDC Fuji | `0x5425890298aed601595a70AB815c96711a31Bc65` |
| Endpoint catálogo | `GET /api/v1/agents` (ya existe) |

---

## 1. Estructura de Archivos

```
/examples/agentkit-demo/
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
├── src/
│   ├── index.ts              ← entry point — orquesta el flujo completo
│   ├── agent.ts              ← lógica del agente IA (AI reasoning loop)
│   ├── wallet.ts             ← inicialización de wallet via viem + private key
│   ├── catalog.ts            ← consulta GET /api/v1/agents
│   ├── payment.ts            ← firma ERC-3009 + header x402
│   ├── invoke.ts             ← HTTP call con X-402-Payment header
│   └── logger.ts             ← logger con timestamps
└── test/
    └── smoke.test.ts         ← smoke test end-to-end en Fuji
```

**Regla:** el directorio es 100% standalone. `npm install && npm run start` sin tocar el codebase principal.

---

## 2. Variables de Entorno (`.env.example`)

```env
# ─── Wallet ───────────────────────────────────────────────────────────────────
# Private key del agente autónomo (hex sin 0x prefix o con, ambos soportados)
AGENT_PRIVATE_KEY=0x...

# ─── Red ──────────────────────────────────────────────────────────────────────
CHAIN_ID=43113
RPC_URL=https://api.avax-test.network/ext/bc/C/rpc

# ─── WasiAI API ───────────────────────────────────────────────────────────────
WASIAI_API_BASE_URL=https://wasiai-v2.vercel.app
# Slug del agente a invocar (debe existir en Fuji)
TARGET_AGENT_SLUG=summarizer

# ─── Contratos ────────────────────────────────────────────────────────────────
WASIAI_CONTRACT_ADDRESS=0x71CddCdF8a40951a1d8C22C8774448FbcA089b53
USDC_FUJI_ADDRESS=0x5425890298aed601595a70AB815c96711a31Bc65

# ─── Demo ─────────────────────────────────────────────────────────────────────
# Texto a resumir (input para el agente summarizer)
DEMO_INPUT_TEXT="Avalanche is a layer-1 blockchain platform designed for high-performance DeFi and enterprise applications. WasiAI is an on-chain AI agent marketplace built on Avalanche."
```

**Regla:** todas las vars se leen con `.trim()` al arrancar. Si falta alguna crítica, el script aborta con mensaje claro antes de hacer ninguna llamada.

---

## 3. Flujo Paso a Paso

### 3.1 Diagrama de secuencia

```
index.ts
   │
   ├─[1]─ validateEnv()              ← aborta si falta var crítica
   ├─[2]─ wallet.init()              ← crea walletClient + publicClient viem
   ├─[3]─ catalog.getAgent(slug)     ← GET /api/v1/agents?slug=summarizer
   │         └─ extrae: price_usdc, invoke_url, agent_id
   ├─[4]─ payment.signERC3009()      ← firma transferWithAuthorization
   │         └─ devuelve: { v, r, s, validAfter, validBefore, nonce }
   ├─[5]─ invoke.call()              ← POST invoke_url con X-402-Payment header
   │         ├─ si 402: lee payment_requirements → vuelve al paso 4 si necesario
   │         └─ si 200: imprime respuesta del agente
   └─[6]─ logger.summary()          ← imprime resumen: tx hash, respuesta, timing
```

### 3.2 Pseudocódigo detallado

```typescript
// ── index.ts ──────────────────────────────────────────────────────────────────

async function main() {
  // [1] Validar entorno
  const env = validateEnv([
    'AGENT_PRIVATE_KEY', 'CHAIN_ID', 'RPC_URL',
    'WASIAI_API_BASE_URL', 'TARGET_AGENT_SLUG',
    'WASIAI_CONTRACT_ADDRESS', 'USDC_FUJI_ADDRESS'
  ])

  // [2] Inicializar wallet
  const { walletClient, publicClient, agentAddress } = initWallet(env)
  log.info(`Agent wallet: ${agentAddress}`)

  // [3] Descubrir agente en catálogo
  const agent = await getCatalogAgent(env.WASIAI_API_BASE_URL, env.TARGET_AGENT_SLUG)
  log.info(`Target agent: ${agent.name} | Price: ${agent.price_usdc} USDC | URL: ${agent.invoke_url}`)

  // [4] Firmar pago ERC-3009
  const payment = await signERC3009Payment({
    walletClient,
    publicClient,
    from: agentAddress,
    to: env.WASIAI_CONTRACT_ADDRESS,   // spender = contrato WasiAI
    value: parseUnits(agent.price_usdc.toString(), 6),
    usdcAddress: env.USDC_FUJI_ADDRESS,
    chainId: Number(env.CHAIN_ID),
  })
  log.info(`Payment signed | nonce: ${payment.nonce}`)

  // [5] Invocar agente con header x402
  const result = await invokeAgent({
    invokeUrl: agent.invoke_url,
    payment,
    input: env.DEMO_INPUT_TEXT,
  })
  log.info(`Agent response received`)

  // [6] Resumen final
  log.summary({
    agentAddress,
    targetAgent: agent.name,
    priceUsdc: agent.price_usdc,
    txHash: result.txHash,
    response: result.output,
    totalTimeMs: result.elapsed,
  })
}

main().catch((err) => {
  log.error('Fatal error', err)
  process.exit(1)
})
```

### 3.3 Firma ERC-3009 con viem (detalle)

```typescript
// ── payment.ts ────────────────────────────────────────────────────────────────
import { createWalletClient, http, parseUnits, type WalletClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { avalancheFuji } from 'viem/chains'

// ABI mínimo de transferWithAuthorization (ERC-3009)
const ERC3009_ABI = [
  {
    name: 'transferWithAuthorization',
    type: 'function',
    inputs: [
      { name: 'from',        type: 'address' },
      { name: 'to',          type: 'address' },
      { name: 'value',       type: 'uint256' },
      { name: 'validAfter',  type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce',       type: 'bytes32' },
      { name: 'v',           type: 'uint8'   },
      { name: 'r',           type: 'bytes32' },
      { name: 's',           type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

// Tipos EIP-712 de ERC-3009
const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from',        type: 'address' },
    { name: 'to',          type: 'address' },
    { name: 'value',       type: 'uint256' },
    { name: 'validAfter',  type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce',       type: 'bytes32' },
  ],
}

export async function signERC3009Payment(params: {
  walletClient: WalletClient
  from: `0x${string}`
  to: `0x${string}`
  value: bigint
  usdcAddress: `0x${string}`
  chainId: number
}) {
  const { walletClient, from, to, value, usdcAddress, chainId } = params

  const validAfter = 0n
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600) // 1 hora de validez
  // nonce aleatorio de 32 bytes
  const nonce = `0x${crypto.randomUUID().replace(/-/g, '').padEnd(64, '0')}` as `0x${string}`

  // Firma EIP-712 via viem
  const signature = await walletClient.signTypedData({
    account: from,
    domain: {
      name: 'USD Coin',
      version: '2',
      chainId,
      verifyingContract: usdcAddress,
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: { from, to, value, validAfter, validBefore, nonce },
  })

  // Descomponer firma en v, r, s
  const r = `0x${signature.slice(2, 66)}`   as `0x${string}`
  const s = `0x${signature.slice(66, 130)}` as `0x${string}`
  const v = parseInt(signature.slice(130, 132), 16)

  return { from, to, value, validAfter, validBefore, nonce, v, r, s }
}
```

### 3.4 Header x402

```typescript
// ── invoke.ts ─────────────────────────────────────────────────────────────────
// Formato del header X-402-Payment (spec WasiAI):
// Base64(JSON({ from, to, value, validAfter, validBefore, nonce, v, r, s }))

export function buildX402Header(payment: ERC3009Payment): string {
  const payload = JSON.stringify({
    from:        payment.from,
    to:          payment.to,
    value:       payment.value.toString(),
    validAfter:  payment.validAfter.toString(),
    validBefore: payment.validBefore.toString(),
    nonce:       payment.nonce,
    v:           payment.v,
    r:           payment.r,
    s:           payment.s,
  })
  return Buffer.from(payload).toString('base64')
}

export async function invokeAgent(params: {
  invokeUrl: string
  payment: ERC3009Payment
  input: string
}): Promise<{ txHash: string; output: string; elapsed: number }> {
  const t0 = Date.now()
  const x402Header = buildX402Header(params.payment)

  const response = await fetch(params.invokeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-402-Payment': x402Header,
    },
    body: JSON.stringify({ input: params.input }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Invoke failed [${response.status}]: ${body}`)
  }

  const data = await response.json()
  return {
    txHash: data.tx_hash ?? 'n/a',
    output: data.output ?? data.result ?? JSON.stringify(data),
    elapsed: Date.now() - t0,
  }
}
```

### 3.5 Consulta al catálogo

```typescript
// ── catalog.ts ────────────────────────────────────────────────────────────────
// GET /api/v1/agents — filtra por slug
// Response shape esperado:
// { id, name, slug, description, price_usdc, invoke_url, status }

export async function getCatalogAgent(baseUrl: string, slug: string) {
  const url = `${baseUrl.trim()}/api/v1/agents?slug=${encodeURIComponent(slug)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Catalog fetch failed [${res.status}]`)
  const agents: AgentCatalogItem[] = await res.json()
  const agent = agents.find(a => a.slug === slug)
  if (!agent) throw new Error(`Agent '${slug}' not found in catalog`)
  if (!agent.invoke_url) throw new Error(`Agent '${slug}' has no invoke_url`)
  return agent
}
```

---

## 4. Dependencias Exactas (`package.json`)

```json
{
  "name": "@wasiai/agentkit-demo",
  "version": "0.1.0",
  "description": "WasiAI AgentKit demo — autonomous agent paying for AI on Avalanche",
  "main": "dist/index.js",
  "scripts": {
    "start":   "tsx src/index.ts",
    "build":   "tsc",
    "test":    "tsx test/smoke.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "viem": "2.21.58",
    "dotenv": "16.4.5"
  },
  "devDependencies": {
    "tsx":        "4.19.2",
    "typescript": "5.7.3",
    "@types/node": "22.13.10"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

**Notas:**
- `viem` lockea a versión exacta — no `^`, no `latest`
- No se instala `ethers` — PROHIBIDO per Golden Path
- `tsx` para ejecutar TypeScript directo sin compilar en dev
- No se usa `@coinbase/agentkit` SDK: el PO decidió private key + viem directo (no CDP Wallet)

---

## 5. `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src", "test"]
}
```

---

## 6. Estructura del README

El `README.md` debe tener las siguientes secciones (en inglés, audiencia: developers externos y jueces):

```markdown
# WasiAI AgentKit Demo

> Autonomous AI agent that discovers, pays, and invokes AI agents on WasiAI marketplace using x402 protocol on Avalanche Fuji testnet.

## What this does
[1-paragraph description del flujo completo]

## Prerequisites
- Node.js >= 20
- AVAX Fuji testnet wallet with some USDC Fuji
- USDC Fuji faucet: [link]

## Setup
1. `cp .env.example .env` and fill in values
2. `npm install`
3. `npm run start`

## Environment Variables
[Tabla de vars con descripción y ejemplo]

## Expected Output
[Output de consola esperado paso a paso]

## Flow Diagram
[ASCII o imagen del flujo]

## How it works
[Sección técnica: x402, ERC-3009, viem signing]

## Running the smoke test
`npm test`

## Troubleshooting
[Errores comunes + solución]
```

---

## 7. Smoke Test (`test/smoke.test.ts`)

```typescript
// Smoke test — valida el flujo end-to-end en Fuji
// Ejecutar con: npm test

import { config } from 'dotenv'
config()

import { getCatalogAgent } from '../src/catalog'
import { initWallet }       from '../src/wallet'
import { signERC3009Payment } from '../src/payment'

async function smokeTest() {
  console.log('=== WasiAI AgentKit Smoke Test ===\n')

  // 1. Catálogo
  const slug = process.env.TARGET_AGENT_SLUG!.trim()
  const base = process.env.WASIAI_API_BASE_URL!.trim()
  console.log(`[1] Fetching agent '${slug}' from catalog...`)
  const agent = await getCatalogAgent(base, slug)
  console.log(`    ✅ Found: ${agent.name} | price: ${agent.price_usdc} USDC`)

  // 2. Wallet
  console.log('[2] Initializing wallet...')
  const { agentAddress } = initWallet({
    privateKey: process.env.AGENT_PRIVATE_KEY!.trim() as `0x${string}`,
    rpcUrl:     process.env.RPC_URL!.trim(),
    chainId:    Number(process.env.CHAIN_ID),
  })
  console.log(`    ✅ Agent address: ${agentAddress}`)

  // 3. ERC-3009 signing
  console.log('[3] Signing ERC-3009 payment...')
  // (solo firma, no transmite — smoke test no gasta gas)
  const payment = await signERC3009Payment({
    walletClient: initWallet({ ... }).walletClient,
    from:        agentAddress,
    to:          process.env.WASIAI_CONTRACT_ADDRESS!.trim() as `0x${string}`,
    value:       BigInt(Math.round(agent.price_usdc * 1e6)),
    usdcAddress: process.env.USDC_FUJI_ADDRESS!.trim() as `0x${string}`,
    chainId:     Number(process.env.CHAIN_ID),
  })
  console.log(`    ✅ Signature generated | nonce: ${payment.nonce}`)

  console.log('\n=== SMOKE TEST PASSED ===')
}

smokeTest().catch((err) => {
  console.error('\n=== SMOKE TEST FAILED ===')
  console.error(err.message)
  process.exit(1)
})
```

---

## 8. Logger (`src/logger.ts`)

```typescript
// Todos los logs con timestamp ISO para trazabilidad en demo

const ts = () => new Date().toISOString()

export const log = {
  info:    (msg: string)                 => console.log(`[${ts()}] ℹ️  ${msg}`),
  error:   (msg: string, err?: unknown)  => console.error(`[${ts()}] ❌ ${msg}`, err ?? ''),
  success: (msg: string)                 => console.log(`[${ts()}] ✅ ${msg}`),
  summary: (data: Record<string, unknown>) => {
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`[${ts()}] 🎉 DEMO COMPLETE`)
    Object.entries(data).forEach(([k, v]) => console.log(`  ${k}: ${v}`))
    console.log('─'.repeat(60))
  },
}
```

---

## 9. Validación de entorno (`src/index.ts` — helper)

```typescript
function validateEnv(required: string[]): Record<string, string> {
  const missing: string[] = []
  const result: Record<string, string> = {}
  for (const key of required) {
    const val = process.env[key]?.trim()
    if (!val) missing.push(key)
    else result[key] = val
  }
  if (missing.length > 0) {
    console.error(`❌ Missing required env vars:\n  ${missing.join('\n  ')}`)
    console.error('Copy .env.example to .env and fill in all values.')
    process.exit(1)
  }
  return result
}
```

---

## 10. Definition of Done (verificable)

| # | Criterio | Cómo verificar |
|---|----------|---------------|
| DoD-1 | `/examples/agentkit-demo/` existe con estructura completa | `ls examples/agentkit-demo/src/` |
| DoD-2 | `npm install && npm run start` ejecuta sin errores desde cero | Clonar repo en máquina limpia, ejecutar |
| DoD-3 | Cero uso de ethers.js | `grep -r "ethers" examples/agentkit-demo/` → vacío |
| DoD-4 | Cero hardcodes de addresses | `grep -r "0x5425\|0x71Cc" examples/agentkit-demo/src/` → vacío |
| DoD-5 | Flujo completo loguea: wallet, agente, monto, tx_hash, respuesta | Ejecutar y revisar output de consola |
| DoD-6 | `npm test` pasa con output claro PASS/FAIL | Ejecutar smoke test |
| DoD-7 | `.env.example` documenta todas las vars requeridas | Review manual |
| DoD-8 | README en inglés con prereqs, setup y flujo esperado | Review manual |
| DoD-9 | El agente `summarizer` recibe input y devuelve output legible | Output visible en consola durante demo |
| DoD-10 | TypeScript sin errores de tipo | `npm run typecheck` → 0 errors |

---

## 11. Consideraciones de Seguridad

- La private key NUNCA se loguea, ni en error handlers
- El script no hace commit de `.env` (`.gitignore` debe incluirlo — verificar)
- El smoke test firma pero no transmite — no gasta USDC del agente
- `AGENT_PRIVATE_KEY` debe ser una wallet de testnet dedicada, no una wallet con fondos reales

---

## 12. Prerequisito externo: USDC Fuji

El agente necesita USDC en Fuji para pagar. Faucets:

1. **Avalanche Fuji Faucet (USDC):** https://faucet.avax.network/ — seleccionar Fuji + ERC-20 USDC
2. **Circle Faucet:** https://faucet.circle.com/ — mint USDC testnet en Fuji

Incluir en README para que cualquier dev pueda ejecutar el demo sin bloquearse.

---

*Generado por PM Agent — BMAD Method v6 — WasiAI / Avalanche Build Games*  
*Estado: S1 pendiente de SPEC_APPROVED explícito de Fer antes de pasar a implementación*
