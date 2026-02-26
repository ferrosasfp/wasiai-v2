# Story File: HU-7.3 — AgentKit Example (Coinbase)

**Estado:** READY FOR DEV  
**Sprint:** S1  
**Fecha:** 2026-02-26  
**Autor:** SM Agent (BMAD v6)  
**Proyecto:** WasiAI — Avalanche Build Games Hackathon  

> ⚠️ Este archivo es 100% autocontenido. El Dev implementa desde aquí. No necesita leer ningún otro documento.

---

## Historia de Usuario

> **Como** desarrollador externo que evalúa WasiAI para construir agentes autónomos,  
> **quiero** un ejemplo funcional end-to-end de un agente que descubre, invoca y paga agentes del marketplace vía protocolo x402 en Avalanche Fuji testnet,  
> **para** poder entender el patrón de integración completo, replicarlo en mi propio proyecto y validar que WasiAI soporta agent-to-agent payments sin intervención humana.

---

## Contexto para el Dev

WasiAI promete pagos autónomos agent-to-agent via x402. Este ejemplo es la prueba tangible de esa promesa para los jueces del hackathon Avalanche Build Games.

**Decisiones fijas (no debatir, solo implementar):**
- Wallet: private key desde `.env` — NO CDP Wallet de Coinbase
- Agente a invocar: `summarizer` (ya existe en Fuji)
- Red: Fuji testnet (chain ID 43113)
- Lib on-chain: **viem v2** — **PROHIBIDO ethers.js**
- Pagos: x402 + ERC-3009 (`transferWithAuthorization`)
- USDC Fuji: `0x5425890298aed601595a70AB815c96711a31Bc65` (leído desde env var)
- Endpoint catálogo: `GET /api/v1/agents` (ya existe en `https://wasiai-v2.vercel.app`)

---

## Acceptance Criteria

### AC-1: Estructura del proyecto
- [ ] El directorio `/examples/agentkit-demo` existe en el repo con su propio `package.json`, `tsconfig.json`, `.env.example` y `README.md`
- [ ] El ejemplo es ejecutable standalone: `npm install && npm run start` sin depender del codebase principal
- [ ] `README.md` en inglés: prereqs, variables de entorno, pasos de ejecución, flujo esperado

### AC-2: Stack y dependencias
- [ ] **viem v2** para todas las interacciones on-chain — `grep -r "ethers" examples/agentkit-demo/` debe retornar vacío
- [ ] Todas las addresses de contratos leídas desde env vars — `grep -r "0x5425\|0x71Cc" examples/agentkit-demo/src/` debe retornar vacío
- [ ] `package.json` con versiones exactas (sin `^` ni `latest`)

### AC-3: Flujo core del agente
- [ ] El agente inicializa wallet desde `AGENT_PRIVATE_KEY` via viem
- [ ] Consulta `GET /api/v1/agents?slug=summarizer` y extrae `price_usdc` e `invoke_url`
- [ ] Construye y firma ERC-3009 (`transferWithAuthorization`) con viem `signTypedData`
- [ ] Envía POST a `invoke_url` con header `X-402-Payment` (Base64 del payload JSON)
- [ ] Recibe y loguea la respuesta del agente invocado
- [ ] Flujo 100% autónomo: cero intervención humana después del `npm run start`

### AC-4: Protocolo x402
- [ ] Header `X-402-Payment` es Base64 del JSON con campos ERC-3009: `{ from, to, value, validAfter, validBefore, nonce, v, r, s }`
- [ ] USDC Fuji address leída desde `USDC_FUJI_ADDRESS` env var
- [ ] Monto del pago tomado del campo `price_usdc` del catálogo — no hardcodeado

### AC-5: Observabilidad
- [ ] Cada paso loguea con timestamp ISO: wallet address, agente seleccionado, monto USDC, nonce de firma, respuesta recibida
- [ ] Errores loguean contexto suficiente para diagnosticar (no crashes silenciosos)
- [ ] La private key NUNCA aparece en los logs

### AC-6: Testing
- [ ] `npm test` ejecuta `test/smoke.test.ts` y produce output claro PASS/FAIL
- [ ] El smoke test valida: catálogo, init de wallet y firma ERC-3009 (no transmite — no gasta USDC)

### AC-7: TypeScript limpio
- [ ] `npm run typecheck` → 0 errores

---

## Estructura Exacta de Archivos

```
/examples/agentkit-demo/
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── README.md
├── src/
│   ├── index.ts          ← entry point — orquesta el flujo completo
│   ├── wallet.ts         ← inicialización de wallet via viem + private key
│   ├── catalog.ts        ← GET /api/v1/agents?slug=...
│   ├── pay.ts            ← firma ERC-3009 + construcción header x402
│   ├── invoke.ts         ← HTTP POST con X-402-Payment header
│   └── logger.ts         ← logger con timestamps ISO
└── test/
    └── smoke.test.ts     ← smoke test end-to-end (firma, no transmite)
```

---

## Código Completo

### `package.json`

```json
{
  "name": "@wasiai/agentkit-demo",
  "version": "0.1.0",
  "description": "WasiAI AgentKit demo — autonomous agent paying for AI on Avalanche Fuji",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "start":     "tsx src/index.ts",
    "build":     "tsc",
    "test":      "tsx test/smoke.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "viem":   "2.21.58",
    "dotenv": "16.4.5"
  },
  "devDependencies": {
    "tsx":         "4.19.2",
    "typescript":  "5.7.3",
    "@types/node": "22.13.10"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

> **Regla de oro:** cero ethers.js. Si aparece en `node_modules` como dependencia transitiva de algún paquete que se agregue, eso es una bandera roja. No agregues paquetes que dependan de ethers.

---

### `tsconfig.json`

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

### `.env.example`

```env
# ─── Wallet ───────────────────────────────────────────────────────────────────
# Private key del agente autónomo (hex con 0x prefix)
# ⚠️  Usar wallet de TESTNET dedicada — nunca una wallet con fondos reales
AGENT_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000001

# ─── Red ──────────────────────────────────────────────────────────────────────
CHAIN_ID=43113
RPC_URL=https://api.avax-test.network/ext/bc/C/rpc

# ─── WasiAI API ───────────────────────────────────────────────────────────────
WASIAI_API_BASE_URL=https://wasiai-v2.vercel.app
# Slug del agente a invocar (debe existir en Fuji)
TARGET_AGENT_SLUG=summarizer

# ─── Contratos ────────────────────────────────────────────────────────────────
# Contrato WasiAI en Fuji — receptor del pago ERC-3009
WASIAI_CONTRACT_ADDRESS=0x71CddCdF8a40951a1d8C22C8774448FbcA089b53
# USDC en Fuji testnet
USDC_FUJI_ADDRESS=0x5425890298aed601595a70AB815c96711a31Bc65

# ─── Demo ─────────────────────────────────────────────────────────────────────
# Texto a resumir (input para el agente summarizer)
DEMO_INPUT_TEXT="Avalanche is a layer-1 blockchain platform designed for high-performance DeFi and enterprise applications. WasiAI is an on-chain AI agent marketplace built on Avalanche that enables autonomous agent-to-agent payments via the x402 protocol."
```

---

### `.gitignore`

```
node_modules/
dist/
.env
*.js.map
```

---

### `src/logger.ts`

```typescript
const ts = () => new Date().toISOString()

export const log = {
  info:    (msg: string)                          => console.log(`[${ts()}] ℹ️  ${msg}`),
  error:   (msg: string, err?: unknown)           => console.error(`[${ts()}] ❌ ${msg}`, err ?? ''),
  success: (msg: string)                          => console.log(`[${ts()}] ✅ ${msg}`),
  warn:    (msg: string)                          => console.warn(`[${ts()}] ⚠️  ${msg}`),
  summary: (data: Record<string, unknown>)        => {
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`[${ts()}] 🎉 DEMO COMPLETE`)
    for (const [k, v] of Object.entries(data)) {
      console.log(`  ${k}: ${v}`)
    }
    console.log('─'.repeat(60))
  },
}
```

---

### `src/wallet.ts`

```typescript
import { createWalletClient, createPublicClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { avalancheFuji } from 'viem/chains'

export interface WalletConfig {
  privateKey: `0x${string}`
  rpcUrl: string
  chainId: number
}

export function initWallet(cfg: WalletConfig) {
  // Normaliza el private key — acepta con o sin 0x prefix
  const pk = cfg.privateKey.startsWith('0x')
    ? cfg.privateKey
    : (`0x${cfg.privateKey}` as `0x${string}`)

  const account = privateKeyToAccount(pk)

  const walletClient = createWalletClient({
    account,
    chain: avalancheFuji,
    transport: http(cfg.rpcUrl),
  })

  const publicClient = createPublicClient({
    chain: avalancheFuji,
    transport: http(cfg.rpcUrl),
  })

  return {
    walletClient,
    publicClient,
    account,
    agentAddress: account.address,
  }
}
```

---

### `src/catalog.ts`

```typescript
// Consulta el catálogo de agentes de WasiAI.
// GET /api/v1/agents?slug=<slug>
// Response shape esperado (array):
// [{ id, name, slug, description, price_usdc, invoke_url, status }, ...]

export interface AgentCatalogItem {
  id:         string
  name:       string
  slug:       string
  description: string
  price_usdc: number
  invoke_url: string
  status:     string
}

export async function getCatalogAgent(
  baseUrl: string,
  slug: string
): Promise<AgentCatalogItem> {
  const url = `${baseUrl.trim()}/api/v1/agents?slug=${encodeURIComponent(slug)}`

  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    throw new Error(`Network error fetching catalog: ${String(err)}`)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Catalog fetch failed [${res.status}]: ${body}`)
  }

  const agents: AgentCatalogItem[] = await res.json()

  if (!Array.isArray(agents) || agents.length === 0) {
    throw new Error(`Catalog returned empty or invalid response for slug '${slug}'`)
  }

  const agent = agents.find((a) => a.slug === slug)
  if (!agent) {
    throw new Error(
      `Agent '${slug}' not found in catalog. Available: ${agents.map((a) => a.slug).join(', ')}`
    )
  }

  if (!agent.invoke_url) {
    throw new Error(`Agent '${slug}' has no invoke_url — cannot invoke`)
  }

  if (agent.status !== 'active') {
    throw new Error(`Agent '${slug}' is not active (status: ${agent.status})`)
  }

  return agent
}
```

---

### `src/pay.ts`

```typescript
// Firma ERC-3009 (transferWithAuthorization) con viem v2.
// Construye el payload para el header X-402-Payment.
// CERO ethers.js — solo viem.

import { parseUnits, type WalletClient } from 'viem'

// Tipos EIP-712 de ERC-3009 (estándar Circle/USDC)
const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from',        type: 'address' },
    { name: 'to',          type: 'address' },
    { name: 'value',       type: 'uint256' },
    { name: 'validAfter',  type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce',       type: 'bytes32' },
  ],
} as const

export interface ERC3009Payment {
  from:        `0x${string}`
  to:          `0x${string}`
  value:       bigint
  validAfter:  bigint
  validBefore: bigint
  nonce:       `0x${string}`
  v:           number
  r:           `0x${string}`
  s:           `0x${string}`
}

export interface SignPaymentParams {
  walletClient:  WalletClient
  from:          `0x${string}`
  to:            `0x${string}`
  priceUsdc:     number          // número decimal, ej: 0.01
  usdcAddress:   `0x${string}`
  chainId:       number
}

export async function signERC3009Payment(
  params: SignPaymentParams
): Promise<ERC3009Payment> {
  const { walletClient, from, to, priceUsdc, usdcAddress, chainId } = params

  // Convierte precio decimal a microunidades (USDC tiene 6 decimales)
  const value = parseUnits(priceUsdc.toFixed(6), 6)

  const validAfter  = 0n
  // Validez: 1 hora desde ahora
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600)
  // Nonce aleatorio de 32 bytes (bytes32)
  const nonce = ('0x' +
    Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')) as `0x${string}`

  // Firma EIP-712 via viem
  const signature = await walletClient.signTypedData({
    account: from,
    domain: {
      name:              'USD Coin',
      version:           '2',
      chainId,
      verifyingContract: usdcAddress,
    },
    types:       TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message:     { from, to, value, validAfter, validBefore, nonce },
  })

  // Descomponer firma hex en v, r, s
  // signature es 65 bytes: r(32) + s(32) + v(1)
  const r = `0x${signature.slice(2, 66)}`   as `0x${string}`
  const s = `0x${signature.slice(66, 130)}` as `0x${string}`
  const v = parseInt(signature.slice(130, 132), 16)

  return { from, to, value, validAfter, validBefore, nonce, v, r, s }
}

/**
 * Construye el valor del header X-402-Payment.
 * Formato: Base64(JSON({ from, to, value, validAfter, validBefore, nonce, v, r, s }))
 * Los bigints se serializan como strings decimales.
 */
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
  return Buffer.from(payload, 'utf-8').toString('base64')
}
```

---

### `src/invoke.ts`

```typescript
// Invoca un agente WasiAI via HTTP POST con el header X-402-Payment.
// Implementa el flujo x402: si el server devuelve 402, es un error de pago
// (la firma ya viene construida antes de llamar — no hay retry automático en v1).

import { buildX402Header, type ERC3009Payment } from './pay.js'

export interface InvokeParams {
  invokeUrl: string
  payment:   ERC3009Payment
  input:     string
}

export interface InvokeResult {
  txHash:    string
  output:    string
  elapsed:   number
  rawStatus: number
}

export async function invokeAgent(params: InvokeParams): Promise<InvokeResult> {
  const { invokeUrl, payment, input } = params
  const t0 = Date.now()

  const x402Header = buildX402Header(payment)

  let res: Response
  try {
    res = await fetch(invokeUrl, {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'X-402-Payment':   x402Header,
      },
      body: JSON.stringify({ input }),
    })
  } catch (err) {
    throw new Error(`Network error invoking agent at '${invokeUrl}': ${String(err)}`)
  }

  const rawStatus = res.status

  if (res.status === 402) {
    // x402 challenge — loguear los detalles del payment requirement para diagnóstico
    const body = await res.text().catch(() => '')
    throw new Error(
      `x402 Payment Required [402] — el pago fue rechazado o inválido.\n` +
      `Server response: ${body}\n` +
      `Verifica que la wallet tenga USDC Fuji suficiente y que la firma sea válida.`
    )
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Invoke failed [${res.status}]: ${body}`)
  }

  const data = await res.json()

  return {
    txHash:    data.tx_hash  ?? data.txHash  ?? 'n/a',
    output:    data.output   ?? data.result  ?? data.summary ?? JSON.stringify(data),
    elapsed:   Date.now() - t0,
    rawStatus,
  }
}
```

---

### `src/index.ts`

```typescript
// Entry point — orquesta el flujo completo del demo.
// Ejecutar: npm run start

import 'dotenv/config'
import { initWallet }         from './wallet.js'
import { getCatalogAgent }    from './catalog.js'
import { signERC3009Payment } from './pay.js'
import { invokeAgent }        from './invoke.js'
import { log }                from './logger.js'

// ── Validación de entorno ──────────────────────────────────────────────────────

function validateEnv(required: string[]): Record<string, string> {
  const missing: string[] = []
  const result:  Record<string, string> = {}

  for (const key of required) {
    const val = process.env[key]?.trim()
    if (!val) {
      missing.push(key)
    } else {
      result[key] = val
    }
  }

  if (missing.length > 0) {
    console.error(`❌ Missing required environment variables:\n  ${missing.join('\n  ')}`)
    console.error('\nCopy .env.example to .env and fill in all values.')
    process.exit(1)
  }

  return result
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log.info('WasiAI AgentKit Demo — starting')

  // [1] Validar entorno
  const env = validateEnv([
    'AGENT_PRIVATE_KEY',
    'CHAIN_ID',
    'RPC_URL',
    'WASIAI_API_BASE_URL',
    'TARGET_AGENT_SLUG',
    'WASIAI_CONTRACT_ADDRESS',
    'USDC_FUJI_ADDRESS',
    'DEMO_INPUT_TEXT',
  ])

  // [2] Inicializar wallet
  log.info('Initializing agent wallet...')
  const { walletClient, agentAddress } = initWallet({
    privateKey: env.AGENT_PRIVATE_KEY as `0x${string}`,
    rpcUrl:     env.RPC_URL,
    chainId:    Number(env.CHAIN_ID),
  })
  log.success(`Agent wallet: ${agentAddress}`)

  // [3] Descubrir agente en catálogo
  log.info(`Fetching agent '${env.TARGET_AGENT_SLUG}' from WasiAI catalog...`)
  const agent = await getCatalogAgent(env.WASIAI_API_BASE_URL, env.TARGET_AGENT_SLUG)
  log.success(`Agent found: ${agent.name} | price: ${agent.price_usdc} USDC | url: ${agent.invoke_url}`)

  // [4] Firmar pago ERC-3009
  log.info(`Signing ERC-3009 payment: ${agent.price_usdc} USDC → ${env.WASIAI_CONTRACT_ADDRESS}`)
  const payment = await signERC3009Payment({
    walletClient,
    from:        agentAddress,
    to:          env.WASIAI_CONTRACT_ADDRESS as `0x${string}`,
    priceUsdc:   agent.price_usdc,
    usdcAddress: env.USDC_FUJI_ADDRESS as `0x${string}`,
    chainId:     Number(env.CHAIN_ID),
  })
  log.success(`Payment signed | nonce: ${payment.nonce} | validBefore: ${payment.validBefore}`)

  // [5] Invocar agente con header x402
  log.info(`Invoking agent with x402 payment header...`)
  log.info(`Input: "${env.DEMO_INPUT_TEXT.slice(0, 80)}..."`)
  const result = await invokeAgent({
    invokeUrl: agent.invoke_url,
    payment,
    input: env.DEMO_INPUT_TEXT,
  })
  log.success(`Response received in ${result.elapsed}ms | status: ${result.rawStatus}`)

  // [6] Resumen final
  log.summary({
    agentWallet:   agentAddress,
    targetAgent:   agent.name,
    priceUsdc:     `${agent.price_usdc} USDC`,
    paymentNonce:  payment.nonce,
    txHash:        result.txHash,
    elapsedMs:     result.elapsed,
    agentResponse: result.output.slice(0, 200) + (result.output.length > 200 ? '...' : ''),
  })
}

main().catch((err: unknown) => {
  log.error('Fatal error', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
```

---

### `test/smoke.test.ts`

```typescript
// Smoke test — valida el flujo sin gastar USDC (solo firma, no transmite).
// Ejecutar: npm test

import 'dotenv/config'
import { getCatalogAgent }    from '../src/catalog.js'
import { initWallet }         from '../src/wallet.js'
import { signERC3009Payment } from '../src/pay.js'

const REQUIRED_ENV = [
  'AGENT_PRIVATE_KEY',
  'CHAIN_ID',
  'RPC_URL',
  'WASIAI_API_BASE_URL',
  'TARGET_AGENT_SLUG',
  'WASIAI_CONTRACT_ADDRESS',
  'USDC_FUJI_ADDRESS',
]

async function smokeTest() {
  console.log('=== WasiAI AgentKit Smoke Test ===\n')

  // Verificar vars de entorno
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]?.trim())
  if (missing.length > 0) {
    console.error(`❌ Missing env vars: ${missing.join(', ')}`)
    process.exit(1)
  }

  let passed = 0
  let failed = 0

  async function check(name: string, fn: () => Promise<void>) {
    try {
      await fn()
      console.log(`  ✅ ${name}`)
      passed++
    } catch (err) {
      console.error(`  ❌ ${name}: ${err instanceof Error ? err.message : String(err)}`)
      failed++
    }
  }

  // [1] Catálogo — verifica que el agente existe y tiene invoke_url
  await check('Catalog: fetch agent from WasiAI API', async () => {
    const slug = process.env.TARGET_AGENT_SLUG!.trim()
    const base = process.env.WASIAI_API_BASE_URL!.trim()
    const agent = await getCatalogAgent(base, slug)
    if (!agent.invoke_url) throw new Error('invoke_url is missing')
    if (typeof agent.price_usdc !== 'number') throw new Error('price_usdc is not a number')
    console.log(`       Agent: ${agent.name} | price: ${agent.price_usdc} USDC`)
  })

  // [2] Wallet — verifica que la private key genera una address válida
  await check('Wallet: initialize from AGENT_PRIVATE_KEY', async () => {
    const { agentAddress } = initWallet({
      privateKey: process.env.AGENT_PRIVATE_KEY!.trim() as `0x${string}`,
      rpcUrl:     process.env.RPC_URL!.trim(),
      chainId:    Number(process.env.CHAIN_ID),
    })
    if (!agentAddress.startsWith('0x')) throw new Error(`Invalid address: ${agentAddress}`)
    console.log(`       Address: ${agentAddress}`)
  })

  // [3] ERC-3009 Signing — verifica que la firma genera v, r, s válidos
  await check('ERC-3009: sign transferWithAuthorization with viem', async () => {
    const { walletClient, agentAddress } = initWallet({
      privateKey: process.env.AGENT_PRIVATE_KEY!.trim() as `0x${string}`,
      rpcUrl:     process.env.RPC_URL!.trim(),
      chainId:    Number(process.env.CHAIN_ID),
    })

    const payment = await signERC3009Payment({
      walletClient,
      from:        agentAddress,
      to:          process.env.WASIAI_CONTRACT_ADDRESS!.trim() as `0x${string}`,
      priceUsdc:   0.01,
      usdcAddress: process.env.USDC_FUJI_ADDRESS!.trim() as `0x${string}`,
      chainId:     Number(process.env.CHAIN_ID),
    })

    if (!payment.nonce.startsWith('0x'))   throw new Error('nonce format invalid')
    if (!payment.r.startsWith('0x'))       throw new Error('r format invalid')
    if (!payment.s.startsWith('0x'))       throw new Error('s format invalid')
    if (payment.v !== 27 && payment.v !== 28) throw new Error(`v must be 27 or 28, got ${payment.v}`)
    console.log(`       Nonce: ${payment.nonce.slice(0, 18)}... | v: ${payment.v}`)
  })

  console.log(`\n${'─'.repeat(40)}`)
  console.log(`Results: ${passed} passed, ${failed} failed`)

  if (failed > 0) {
    console.log('\n=== SMOKE TEST FAILED ===')
    process.exit(1)
  } else {
    console.log('\n=== SMOKE TEST PASSED ===')
  }
}

smokeTest().catch((err) => {
  console.error('\n=== SMOKE TEST CRASHED ===')
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
```

---

## README.md (estructura completa para que el Dev rellene)

```markdown
# WasiAI AgentKit Demo

> Autonomous AI agent that discovers, pays, and invokes AI agents on WasiAI marketplace using the x402 protocol on Avalanche Fuji testnet.

## What this does

This demo shows an autonomous agent that:
1. Reads its wallet from an env var (private key → viem account)
2. Queries the WasiAI catalog to find the `summarizer` agent and its price
3. Signs an ERC-3009 (`transferWithAuthorization`) payment using viem v2
4. Calls the agent via HTTP POST with the `X-402-Payment` header
5. Logs the full flow with timestamps — no human intervention after `npm run start`

## Prerequisites

- Node.js >= 20
- A testnet wallet (private key) with USDC on Avalanche Fuji
- USDC Fuji faucet: https://faucet.avax.network/ (select Fuji + ERC-20 USDC token)
- AVAX Fuji for gas (if needed): https://faucet.avax.network/

## Setup

```bash
cd examples/agentkit-demo
cp .env.example .env
# Edit .env — fill in AGENT_PRIVATE_KEY and verify other values
npm install
npm run start
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AGENT_PRIVATE_KEY` | ✅ | Private key of the agent wallet (hex, with 0x prefix) |
| `CHAIN_ID` | ✅ | `43113` for Fuji testnet |
| `RPC_URL` | ✅ | Fuji RPC endpoint |
| `WASIAI_API_BASE_URL` | ✅ | WasiAI API base URL |
| `TARGET_AGENT_SLUG` | ✅ | Slug of agent to invoke (e.g. `summarizer`) |
| `WASIAI_CONTRACT_ADDRESS` | ✅ | WasiAI contract address (payment recipient) |
| `USDC_FUJI_ADDRESS` | ✅ | USDC token address on Fuji |
| `DEMO_INPUT_TEXT` | ✅ | Text to summarize |

## Expected Output

```
[2026-02-26T...] ℹ️  WasiAI AgentKit Demo — starting
[2026-02-26T...] ℹ️  Initializing agent wallet...
[2026-02-26T...] ✅ Agent wallet: 0x...
[2026-02-26T...] ℹ️  Fetching agent 'summarizer' from WasiAI catalog...
[2026-02-26T...] ✅ Agent found: Summarizer | price: 0.01 USDC | url: https://...
[2026-02-26T...] ℹ️  Signing ERC-3009 payment: 0.01 USDC → 0x71Cd...
[2026-02-26T...] ✅ Payment signed | nonce: 0x... | validBefore: ...
[2026-02-26T...] ℹ️  Invoking agent with x402 payment header...
[2026-02-26T...] ✅ Response received in 800ms | status: 200
────────────────────────────────────────────────────────────
[2026-02-26T...] 🎉 DEMO COMPLETE
  agentWallet: 0x...
  targetAgent: Summarizer
  priceUsdc: 0.01 USDC
  txHash: 0x...
  elapsedMs: 850
  agentResponse: Avalanche is a high-performance L1 blockchain...
────────────────────────────────────────────────────────────
```

## How it works

**x402 Protocol:** The agent attaches an `X-402-Payment` header to the HTTP request. This header contains a Base64-encoded JSON with an ERC-3009 authorization signature. The WasiAI server verifies the signature on-chain before processing the request.

**ERC-3009:** `transferWithAuthorization` is a gasless meta-transaction standard. The agent signs a typed message (EIP-712) authorizing the WasiAI contract to pull USDC from its wallet — no separate approval transaction needed.

**viem v2:** All signing uses `walletClient.signTypedData()` from viem. Zero ethers.js.

## Running the smoke test

```bash
npm test
```

The smoke test validates catalog fetch, wallet init, and ERC-3009 signing **without spending any USDC** (signs but does not broadcast).

## Troubleshooting

| Error | Solution |
|-------|----------|
| `Missing required environment variables` | Copy `.env.example` to `.env` and fill all values |
| `Agent 'summarizer' not found in catalog` | Verify `WASIAI_API_BASE_URL` is correct and the agent exists |
| `x402 Payment Required [402]` | Check wallet has USDC Fuji balance; verify `WASIAI_CONTRACT_ADDRESS` |
| `Network error fetching catalog` | Check `RPC_URL` and `WASIAI_API_BASE_URL` are reachable |
| `v must be 27 or 28` | ERC-3009 signature issue — check `CHAIN_ID` matches Fuji (43113) |
```

---

## Definition of Done (checklist para el Dev)

| # | Criterio | Cómo verificar | Estado |
|---|----------|----------------|--------|
| DoD-1 | `/examples/agentkit-demo/` existe con estructura completa | `ls examples/agentkit-demo/src/` muestra los 6 módulos | ☐ |
| DoD-2 | `npm install && npm run start` ejecuta sin errores desde cero | Clonar repo en máquina limpia y ejecutar | ☐ |
| DoD-3 | Cero uso de ethers.js | `grep -r "ethers" examples/agentkit-demo/` → vacío | ☐ |
| DoD-4 | Cero hardcodes de addresses | `grep -rE "0x5425|0x71Cd" examples/agentkit-demo/src/` → vacío | ☐ |
| DoD-5 | Flujo loguea: wallet, agente, monto, nonce, tx_hash, respuesta | Ejecutar y revisar output de consola | ☐ |
| DoD-6 | `npm test` pasa con output claro PASS/FAIL | `npm test` → "SMOKE TEST PASSED" | ☐ |
| DoD-7 | `.env.example` documenta todas las vars requeridas | Review del archivo | ☐ |
| DoD-8 | README en inglés con prereqs, setup y flujo esperado | Review del README | ☐ |
| DoD-9 | El agente `summarizer` devuelve output legible en consola | Output visible en la sección "agentResponse" del summary | ☐ |
| DoD-10 | TypeScript sin errores de tipo | `npm run typecheck` → 0 errors | ☐ |
| DoD-11 | La private key no aparece en ningún log | Revisar output de `npm run start` con grep | ☐ |
| DoD-12 | `.gitignore` incluye `.env` y `node_modules/` | `cat examples/agentkit-demo/.gitignore` | ☐ |

---

## Notas de Implementación para el Dev

### Golden Path (no negociable)
1. **viem v2** para toda interacción on-chain. Si necesitas hacer algo on-chain y no sabes cómo con viem, pregunta — no instales ethers.
2. **Todas las addresses desde env vars.** Ni una sola address `0x...` hardcodeada en el código fuente.
3. **x402 + ERC-3009** para el pago. El server de WasiAI espera el header `X-402-Payment` con el payload descrito en `pay.ts`.
4. **USDC Fuji address:** `0x5425890298aed601595a70AB815c96711a31Bc65` — va en `.env`, no en el código.

### Sobre el agente `summarizer`
- El agente ya existe en Fuji. Su `invoke_url` lo ves en el catálogo.
- Acepta `{ input: string }` en el POST body.
- Devuelve `{ output: string, tx_hash: string }` en el response.

### Sobre la firma ERC-3009
- El dominio EIP-712 de USDC Fuji es `{ name: 'USD Coin', version: '2', chainId: 43113, verifyingContract: <USDC_FUJI_ADDRESS> }`.
- `v` debe ser 27 o 28. viem a veces devuelve 0 o 1 — en ese caso sumar 27.
- El `nonce` es bytes32 (32 bytes random) — no confundir con el nonce de la transacción.
- `validBefore` = timestamp Unix en segundos + 3600 (1 hora). Es `uint256`, serializar como string decimal en el JSON del header.

### Sobre el header X-402-Payment
- Es Base64(JSON) donde todos los `bigint` van como strings decimales (no hex).
- Ejemplo de payload descodificado:
```json
{
  "from": "0xAgentAddress",
  "to": "0xWasiAIContractAddress",
  "value": "10000",
  "validAfter": "0",
  "validBefore": "1740614400",
  "nonce": "0xabc...32bytes",
  "v": 28,
  "r": "0x...",
  "s": "0x..."
}
```

### Sobre el USDC Fuji
- Necesitas USDC en la wallet del agente para ejecutar el demo completo.
- El smoke test NO requiere USDC (solo firma, no transmite).
- Faucets: https://faucet.avax.network/ (seleccionar ERC-20 USDC en Fuji)

---

*Story generado por SM Agent — BMAD Method v6 — WasiAI / Avalanche Build Games*  
*Basado en HU-7.3 (HU_APPROVED) + SDD-HU-7.3 (SPEC_APPROVED)*
