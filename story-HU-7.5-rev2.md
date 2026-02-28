# Story File — HU-7.5 Rev.2: Agente x402 con Wallet Propia y ERC-3009 Directo

**Story ID:** HU-7.5-Rev.2  
**Épica:** E7 — Integraciones con Ecosistema AI  
**Estado:** READY FOR DEV  
**Generado por:** SM Agent — BMAD v6  
**Fecha:** 2026-02-28  
**Repo destino:** `wasiai-x402-example` (repo SEPARADO, NO es parte de wasiai-v2)  
**GitHub:** `github.com/ferrosasfp/wasiai-x402-example` (Fer lo crea)  
**SPEC aprobada:** SDD HU-7.5-rev2 APROBADA  
**HU aprobada:** HU-7.5 Rev.2 APROBADA  

> ⚠️ **El Dev implementa SOLO desde este archivo.** No necesita leer ningún otro documento.  
> ⚠️ **Todos los archivos se crean desde cero** — el repo no existe todavía.

---

## Historia de Usuario

> **Como** developer que quiere que su agente pague servicios de forma autónoma,  
> **quiero** un ejemplo funcional en Node.js donde el agente tiene su propia wallet, firma una autorización ERC-3009 (transferWithAuthorization) con viem v2, construye el header `X-PAYMENT` manualmente, y llama directamente al contrato WasiAI en Fuji sin ningún intermediario ni API Key de pago,  
> **para** entender el patrón real de pagos agent-to-agent que diferencia a WasiAI de cualquier API con API Key — y replicarlo en mis propios agentes autónomos.

---

## El flujo explicado (para el README y para el Dev)

**El escenario:** un developer quiere que su agente use WasiAI para resumir textos, traducir, o cualquier servicio del marketplace — de forma completamente autónoma.

**1. El developer configura su wallet (una sola vez)**
Crea una wallet de testing, la fondea con USDC Fuji (gratis del faucet), pone la private key en su `.env`. Eso es todo lo que hace manualmente.

**2. El agente corre solo (`npm run invoke`)**
```
Paso 1 → Carga su wallet desde .env
Paso 2 → Pregunta a WasiAI: "¿qué agentes hay y cuánto cobran?"
Paso 3 → Verifica que tiene USDC suficiente
Paso 4 → Firma la autorización de pago (ERC-3009) con viem
          — esto es matemática pura, no hay clic, no hay MetaMask
Paso 5 → Manda el trabajo + la firma como header HTTP a WasiAI
```

**3. WasiAI recibe la llamada**
```
Verifica que la firma es válida
→ Ejecuta el transferWithAuthorization en el contrato USDC
→ USDC va del agente → al contrato WasiAI
→ Contrato divide: 90% al creator, 10% a WasiAI
→ Corre el agente solicitado
→ Devuelve el resultado + tx_hash verificable
```

**4. El developer ve en consola**
```
✓ Resultado del agente: "Resumen: ..."
✓ Pagado: 0.001 USDC
✓ TX Hash: 0x9f1a... (verificable en Snowtrace)
```

**¿Por qué esto es diferente a cualquier API con API Key?**
- El developer nunca le entrega su dinero a nadie — él firma, el contrato ejecuta
- El creator recibe USDC automáticamente, sin que nadie se lo mande manualmente
- Funciona igual si el "developer" es un agente de IA autónomo — nadie humano en el loop
- Custodia cero: WasiAI nunca toca la private key, solo verifica la firma on-chain

---

## Contexto Técnico Crítico (leer antes de implementar)

### ¿Cómo valida el servidor WasiAI el pago?

```
POST /api/v1/models/{slug}/invoke
Header: X-PAYMENT: <Base64(JSON)>
```

El servidor WasiAI:
1. Llama `extractPaymentFromHeaders(headers)` — decodifica header `x-payment` (lowercase) como Base64 JSON
2. Extrae `paymentHeader.payload` como `X402EVMPayload`
3. Verifica que `payload.authorization` y `payload.signature` existan
4. Llama `settlePaymentDirectly(evmPayload, atomicRequired)` que:
   - Verifica timing (`validAfter <= now < validBefore`)
   - Verifica monto (`value >= required`)
   - Verifica firma EIP-712 con `viem.verifyTypedData`
   - Ejecuta `transferWithAuthorization` on-chain via operador WasiAI

### Estructura exacta del header X-PAYMENT

```
Header name:  X-PAYMENT
Header value: Base64(JSON.stringify(payload))
```

Estructura JSON que se encoda en Base64:
```json
{
  "payload": {
    "signature": "0x<firma_compact_132chars>",
    "authorization": {
      "from":        "0x<wallet_del_agente>",
      "to":          "0x<CONTRACT_ADDRESS>",
      "value":       "1000",
      "validAfter":  "0",
      "validBefore": "9999999999",
      "nonce":       "0x<bytes32_random>"
    }
  }
}
```

> **CRÍTICO:** `value` es STRING (no bigint) porque JSON no serializa bigint.  
> **CRÍTICO:** `signature` es la firma compacta de 132 chars que devuelve viem `signTypedData`.

### EIP-712 Domain y Types (verificados en wasiai-v2/usdcSettler.ts)

```typescript
const domain = {
  name:              'USD Coin',
  version:           '2',
  chainId:           43113,   // Fuji
  verifyingContract: '0x5425890298aed601595a70AB815c96711a31Bc65',  // USDC Fuji
}

const types = {
  TransferWithAuthorization: [
    { name: 'from',        type: 'address' },
    { name: 'to',          type: 'address' },
    { name: 'value',       type: 'uint256' },
    { name: 'validAfter',  type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce',       type: 'bytes32' },
  ],
}
```

### Ambigüedades ya resueltas (NO reinvestigar)

| Pregunta | Respuesta verificada |
|----------|---------------------|
| ¿Header name `X-PAYMENT` o `X-402-Payment`? | `X-PAYMENT` (uvd-x402-sdk usa lowercase `x-payment` para buscar) |
| ¿Endpoint `/agents/{slug}/invoke` o `/models/{slug}/invoke`? | `/models/{slug}/invoke` — el settler real está en models |
| ¿JSON del header plano o wrapeado en `payload`? | `{ payload: { signature, authorization } }` |
| ¿`value` como bigint o string? | STRING — el settler hace `BigInt(auth.value)` al leerlo |

### Constantes Fuji (verificadas)

| Nombre | Valor |
|--------|-------|
| `CONTRACT_ADDRESS` | `0x71CddCdF8a40951a1d8C22C8774448FbcA089b53` |
| `USDC_ADDRESS` | `0x5425890298aed601595a70AB815c96711a31Bc65` |
| `CHAIN_ID` | `43113` |
| `WASIAI_BASE_URL` | `https://wasiai-v2.vercel.app` |
| EIP-712 domain name | `'USD Coin'` |
| EIP-712 domain version | `'2'` |

---

## Acceptance Criteria

**AC-1 — Setup en ≤10 minutos desde cero**  
Un developer sin contexto previo puede: clonar el repo, copiar `.env.example` a `.env`, completar `PRIVATE_KEY` y opcionalmente `AGENT_SLUG`, correr `npm install && npm run invoke`, y ver en consola el resultado del agente WasiAI. El README tiene instrucciones para conseguir USDC Fuji (faucet link incluido) y cómo generar una wallet de testing con viem.

**AC-2 — Flujo ERC-3009 completo y verificable**  
`npm run invoke` ejecuta en orden: (1) carga wallet desde `PRIVATE_KEY`, (2) consulta catálogo vía `GET /api/v1/agents` para obtener precio y slug del agente, (3) construye firma EIP-712 de `transferWithAuthorization` con viem v2, (4) codifica el header `X-PAYMENT` como Base64 JSON, (5) hace `POST /api/v1/models/{slug}/invoke` con el header, (6) imprime en consola: respuesta del agente + precio pagado. Cada paso es visible en los logs.

**AC-3 — Sin intermediario, sin API Key de pago**  
El script NO usa API Key de WasiAI para el pago. El pago sucede via firma ERC-3009 que el contrato valida on-chain. El developer solo pone su `PRIVATE_KEY` de wallet. WasiAI nunca tiene custodia de los fondos — la transferencia la autoriza el agente del developer, nadie más.

**AC-4 — Variables de entorno, cero hardcoding**  
Ninguna address de contrato, private key, ni URL está hardcodeada en el código de los `.ts` files (los defaults en variables `const` del código son aceptables). Todo configurable vía `.env`. `.env` está en `.gitignore`. `.env.example` documenta cada variable.

**AC-5 — Manejo de errores accionables**  
Si USDC insuficiente → mensaje: "Saldo insuficiente. Necesitas X USDC en Fuji." + link a faucet. Si firma inválida o rechazada por contrato (HTTP 402) → mensaje del revert + posibles causas + pasos de debug. Si agente no disponible → mensaje claro. Exit code `!= 0` en cualquier error.

**AC-6 — Código legible como documentación**  
El archivo principal (`invoke.ts`) y `pay.ts` tienen comentarios inline que explican cada decisión técnica: por qué ERC-3009 vs ERC-20 approve, qué es el nonce aleatorio, qué contiene el header X-PAYMENT. El código es la documentación — un developer debe entender el protocolo leyendo el script.

**AC-7 — Compatible Node.js 18+ sin ethers.js**  
`package.json` declara `engines: { node: ">=18" }`. Solo `viem` y `dotenv` como `dependencies`. Sin ethers.js, sin LangChain, sin AgentKit, sin frameworks. `npm install` resuelve en < 30 segundos.

**AC-8 — README con sección "Cómo funciona x402"**  
El README incluye un diagrama ASCII explicando el flujo de pago: wallet → firma ERC-3009 → header X-PAYMENT → servidor WasiAI → validación on-chain → respuesta del agente. Incluye sección "¿Por qué esto es imposible sin blockchain?" en ≤3 líneas.

---

## Estructura de Archivos

```
wasiai-x402-example/          ← raíz del repo (crearlo desde cero)
├── src/
│   ├── invoke.ts             ← Entry point — orquesta el flujo completo
│   ├── wallet.ts             ← Carga wallet desde PRIVATE_KEY, helper de balance
│   ├── pay.ts                ← Firma ERC-3009 + construye header X-PAYMENT
│   ├── catalog.ts            ← Descubre agentes disponibles en WasiAI
│   └── logger.ts             ← Logger con colores para consola
├── .env.example              ← Variables requeridas con descripción
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

**Total: 9 archivos.** Todos se crean desde cero.

---

## Orden de Implementación

1. `package.json` — declara dependencias y scripts antes de cualquier código
2. `tsconfig.json` — configuración TypeScript
3. `.gitignore` — antes de cualquier commit accidental
4. `src/logger.ts` — sin dependencias propias, necesario para debug inmediato
5. `src/wallet.ts` — carga wallet y WasiError (otros módulos lo importan)
6. `src/catalog.ts` — discovery del catálogo
7. `src/pay.ts` — la parte core: firma ERC-3009 + header X-PAYMENT
8. `src/invoke.ts` — orquesta los 4 módulos anteriores
9. `.env.example` + `README.md` — documentación final

---

## Código Completo (copiar exacto)

### `src/logger.ts`

```typescript
/**
 * logger.ts — Logger mínimo con colores para consola.
 * No usa librerías externas. Compatible con Node.js 18+.
 */

const RESET  = '\x1b[0m'
const BOLD   = '\x1b[1m'
const DIM    = '\x1b[2m'
const GREEN  = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED    = '\x1b[31m'
const CYAN   = '\x1b[36m'
const GRAY   = '\x1b[90m'

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

export const log = {
  step(msg: string, detail?: string): void {
    console.log(`${BOLD}${CYAN}▶${RESET} ${BOLD}${msg}${RESET}${detail ? `${GRAY}  ${detail}${RESET}` : ''}`)
  },
  ok(msg: string, detail?: string): void {
    console.log(`${GREEN}✓${RESET} ${msg}${detail ? `${GRAY}  ${detail}${RESET}` : ''}`)
  },
  warn(msg: string, detail?: string): void {
    console.warn(`${YELLOW}⚠${RESET} ${msg}${detail ? `${GRAY}  ${detail}${RESET}` : ''}`)
  },
  error(msg: string, detail?: string): void {
    console.error(`${RED}✗ ${BOLD}${msg}${RESET}${detail ? `\n  ${DIM}${detail}${RESET}` : ''}`)
  },
  info(msg: string, detail?: string): void {
    console.log(`${DIM}${timestamp()}${RESET} ${msg}${detail ? `${GRAY}  ${detail}${RESET}` : ''}`)
  },
  result(label: string, value: unknown): void {
    const str = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
    console.log(`\n${BOLD}${label}${RESET}\n${str}`)
  },
}
```

---

### `src/wallet.ts`

```typescript
/**
 * wallet.ts — Carga la wallet del agente desde PRIVATE_KEY.
 *
 * La private key NUNCA sale de esta máquina.
 * WasiAI solo recibe la firma ERC-3009, nunca la key.
 *
 * Dependencias: viem v2
 */

import {
  createPublicClient,
  http,
  formatUnits,
  type Address,
} from 'viem'
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { avalancheFuji } from 'viem/chains'
import { log } from './logger.js'

// ABI mínimo para leer balance de USDC (ERC-20)
const ERC20_BALANCE_ABI = [
  {
    name:    'balanceOf',
    type:    'function',
    inputs:  [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

export interface WalletContext {
  account:    PrivateKeyAccount
  address:    Address
  publicClient: ReturnType<typeof createPublicClient>
}

/**
 * Carga la wallet desde la variable de entorno PRIVATE_KEY.
 *
 * @throws {WasiError} Si PRIVATE_KEY no está definida o es inválida.
 */
export function loadWallet(): WalletContext {
  const pkRaw = process.env.PRIVATE_KEY
  if (!pkRaw) {
    throw new WasiError(
      'PRIVATE_KEY no definida en .env',
      'Copia .env.example a .env y completa PRIVATE_KEY con la clave privada de tu wallet de testing.',
      'config_missing',
    )
  }

  // Normalizar: remover espacios y prefijo 0x si ya tiene
  const pkHex = pkRaw.trim().replace(/^0x/i, '')
  if (!/^[0-9a-fA-F]{64}$/.test(pkHex)) {
    throw new WasiError(
      'PRIVATE_KEY inválida — debe ser 64 caracteres hexadecimales',
      'Genera una wallet de testing con: node -e "import(\'viem/accounts\').then(m => console.log(m.generatePrivateKey()))"',
      'config_invalid',
    )
  }

  const account = privateKeyToAccount(`0x${pkHex}` as `0x${string}`)
  const rpcUrl  = process.env.RPC_URL ?? 'https://avalanche-fuji-c-chain-rpc.publicnode.com'

  const publicClient = createPublicClient({
    chain:     avalancheFuji,
    transport: http(rpcUrl),
  })

  return { account, address: account.address, publicClient }
}

/**
 * Verifica el balance de USDC Fuji de la wallet.
 * Retorna el balance en unidades USDC (6 decimales).
 *
 * @throws {WasiError} Si el balance es insuficiente para cubrir el precio.
 */
export async function checkUsdcBalance(
  wallet: WalletContext,
  requiredUsdc: number,
): Promise<{ balanceUsdc: number; balanceRaw: bigint }> {
  const usdcAddress = (process.env.USDC_ADDRESS ?? '0x5425890298aed601595a70AB815c96711a31Bc65') as Address

  const balanceRaw = await wallet.publicClient.readContract({
    address:      usdcAddress,
    abi:          ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args:         [wallet.address],
  }) as bigint

  // USDC tiene 6 decimales
  const balanceUsdc = Number(formatUnits(balanceRaw, 6))

  if (balanceUsdc < requiredUsdc) {
    throw new WasiError(
      `Saldo insuficiente. Tienes ${balanceUsdc.toFixed(6)} USDC, necesitas ${requiredUsdc} USDC.`,
      [
        'Obtén USDC de prueba en Fuji:',
        '  → https://faucet.circle.com (selecciona Avalanche Fuji)',
        '  → https://core.app/tools/testnet-faucet/?subnet=c&token=c (AVAX para gas)',
        `Tu dirección: ${wallet.address}`,
      ].join('\n'),
      'insufficient_balance',
    )
  }

  return { balanceUsdc, balanceRaw }
}

/**
 * Error tipado para el agente x402.
 * Incluye mensaje usuario-friendly y código de error para manejo programático.
 */
export class WasiError extends Error {
  constructor(
    message:          string,
    public readonly hint:  string,
    public readonly code:  string,
  ) {
    super(message)
    this.name = 'WasiError'
  }
}
```

---

### `src/catalog.ts`

```typescript
/**
 * catalog.ts — Descubre agentes disponibles en WasiAI.
 *
 * Usa fetch nativo (Node.js 18+). Sin SDK.
 * El catálogo devuelve el slug y precio de cada agente activo.
 */

import { log } from './logger.js'
import { WasiError } from './wallet.js'

const WASIAI_BASE_URL = (
  process.env.WASIAI_BASE_URL ?? 'https://wasiai-v2.vercel.app'
).replace(/\/$/, '')

export interface AgentInfo {
  slug:           string
  name:           string
  price_per_call: number   // en USDC, ej: 0.001
  status:         string
  category?:      string
  description?:   string
}

/**
 * Obtiene la lista de agentes activos desde /api/v1/agents.
 * Retorna el primer agente activo o el especificado por AGENT_SLUG.
 */
export async function resolveAgent(): Promise<AgentInfo> {
  const slugOverride = process.env.AGENT_SLUG

  const url = `${WASIAI_BASE_URL}/api/v1/agents`
  log.step('Consultando catálogo WasiAI', url)

  let response: Response
  try {
    response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal:  AbortSignal.timeout(10_000),
    })
  } catch (err) {
    throw new WasiError(
      'No se pudo conectar con WasiAI',
      `URL: ${url}\nVerifica WASIAI_BASE_URL en .env\nDetalle: ${String(err)}`,
      'network_error',
    )
  }

  if (!response.ok) {
    throw new WasiError(
      `Error al obtener catálogo: HTTP ${response.status}`,
      `URL: ${url}\nRespuesta: ${await response.text().catch(() => '(sin body)')}`,
      'catalog_error',
    )
  }

  const data = await response.json() as AgentInfo[] | { agents?: AgentInfo[] }

  // La API puede devolver array directo o { agents: [...] }
  const agents: AgentInfo[] = Array.isArray(data)
    ? data
    : (data.agents ?? [])

  const activeAgents = agents.filter(a => a.status === 'active')

  if (activeAgents.length === 0) {
    throw new WasiError(
      'No hay agentes activos en el catálogo',
      'Verifica que WASIAI_BASE_URL apunte al entorno correcto y que haya agentes publicados.',
      'no_agents',
    )
  }

  // Usar AGENT_SLUG si está definido, sino el primero activo
  if (slugOverride) {
    const match = activeAgents.find(a => a.slug === slugOverride)
    if (!match) {
      throw new WasiError(
        `Agente "${slugOverride}" no encontrado o inactivo`,
        `Agentes disponibles: ${activeAgents.map(a => a.slug).join(', ')}`,
        'agent_not_found',
      )
    }
    return match
  }

  return activeAgents[0]
}
```

---

### `src/pay.ts`

```typescript
/**
 * pay.ts — Firma ERC-3009 y construye el header X-PAYMENT para x402.
 *
 * ¿Por qué ERC-3009 y no ERC-20 approve?
 * - ERC-20 approve requiere 2 txs (approve + transferFrom) y gas del usuario
 * - ERC-3009 (transferWithAuthorization) usa una firma off-chain + 1 tx ejecutada
 *   por el operador de WasiAI. El usuario paga cero gas. La transferencia es
 *   atómica con la validación del pago.
 *
 * Flujo:
 *   1. Construir mensaje EIP-712 con los parámetros de la transferencia
 *   2. Firmar con la wallet del agente (signTypedData)
 *   3. Empaquetar { payload: { signature, authorization } } como Base64 JSON
 *   4. El servidor llama transferWithAuthorization en USDC contract con estos datos
 *
 * Dependencias: viem v2
 */

import {
  createWalletClient,
  http,
  type Address,
} from 'viem'
import { avalancheFuji } from 'viem/chains'
import { type PrivateKeyAccount } from 'viem/accounts'
import { log } from './logger.js'
import { WasiError } from './wallet.js'

// ─── Constantes (todas sobreescribibles vía .env) ─────────────────────────────

// USDC en Fuji — el token que firma el agente
const USDC_ADDRESS = (
  process.env.USDC_ADDRESS ?? '0x5425890298aed601595a70AB815c96711a31Bc65'
) as Address

// Contrato WasiAI — destinatario del pago (divide 90/10 creator/marketplace internamente)
const CONTRACT_ADDRESS = (
  process.env.CONTRACT_ADDRESS ?? '0x71CddCdF8a40951a1d8C22C8774448FbcA089b53'
) as Address

const CHAIN_ID = Number(process.env.CHAIN_ID ?? 43113)

// ─── EIP-712 Domain para USDC v2 (Circle) ────────────────────────────────────
// Verificado contra usdcSettler.ts de wasiai-v2
const USDC_DOMAIN = {
  name:              'USD Coin',
  version:           '2',
  chainId:           CHAIN_ID,
  verifyingContract: USDC_ADDRESS,
} as const

// ─── EIP-712 Types para ERC-3009 TransferWithAuthorization ───────────────────
const TRANSFER_TYPES = {
  TransferWithAuthorization: [
    { name: 'from',        type: 'address' },
    { name: 'to',          type: 'address' },
    { name: 'value',       type: 'uint256' },
    { name: 'validAfter',  type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce',       type: 'bytes32' },
  ],
} as const

export interface PaymentHeader {
  headerName:  string   // 'X-PAYMENT'
  headerValue: string   // Base64(JSON)
  amountUsdc:  number
  amountRaw:   bigint
  nonce:       string
}

/**
 * Firma una autorización ERC-3009 y construye el header X-PAYMENT.
 *
 * @param account      Wallet del agente (cargada por loadWallet)
 * @param pricePerCall Precio en USDC del agente (ej: 0.001)
 * @returns PaymentHeader listo para incluir en la request HTTP
 */
export async function buildPaymentHeader(
  account:      PrivateKeyAccount,
  pricePerCall: number,
): Promise<PaymentHeader> {
  const rpcUrl = process.env.RPC_URL ?? 'https://avalanche-fuji-c-chain-rpc.publicnode.com'

  // walletClient solo para firmar — no ejecuta ninguna tx on-chain aquí
  const walletClient = createWalletClient({
    account,
    chain:     avalancheFuji,
    transport: http(rpcUrl),
  })

  // Convertir precio USDC a atomic units (6 decimales)
  // Ej: 0.001 USDC → 1000 (en atomic units)
  const amountRaw = BigInt(Math.round(pricePerCall * 1_000_000))

  if (amountRaw <= 0n) {
    throw new WasiError(
      `Precio inválido: ${pricePerCall} USDC`,
      'El precio del agente debe ser mayor a 0.',
      'invalid_price',
    )
  }

  // Nonce aleatorio de 32 bytes — ERC-3009 requiere que sea único por autorización.
  // Se usa random (no secuencial) porque el contrato solo verifica que no se haya
  // usado antes — no que sea consecutivo. Previene replay attacks.
  const nonceBytes = crypto.getRandomValues(new Uint8Array(32))
  const nonce = ('0x' + Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`

  // Timestamps para la ventana de validez de la autorización.
  // validAfter = 0 (válida desde siempre)
  // validBefore = now + 5 min (expira pronto para reducir riesgo de replay)
  const validAfter  = 0n
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 300) // +5 minutos

  log.step('Firmando autorización ERC-3009', `${pricePerCall} USDC → ${CONTRACT_ADDRESS}`)
  log.info('Nonce', nonce)
  log.info('ValidBefore', new Date(Number(validBefore) * 1000).toISOString())

  // Firma EIP-712 con viem v2 signTypedData
  // Esto NO crea ninguna transacción — es solo una firma criptográfica off-chain.
  // WasiAI usará esta firma para ejecutar transferWithAuthorization on-chain.
  let signature: `0x${string}`
  try {
    signature = await walletClient.signTypedData({
      domain:      USDC_DOMAIN,
      types:       TRANSFER_TYPES,
      primaryType: 'TransferWithAuthorization',
      message: {
        from:        account.address,
        to:          CONTRACT_ADDRESS,
        value:       amountRaw,
        validAfter,
        validBefore,
        nonce,
      },
    })
  } catch (err) {
    throw new WasiError(
      'Error al firmar la autorización ERC-3009',
      `Verifica que PRIVATE_KEY sea válida y que CHAIN_ID sea correcto (${CHAIN_ID}).\nDetalle: ${String(err)}`,
      'sign_error',
    )
  }

  log.ok('Firma generada', `${signature.slice(0, 20)}...`)

  // Estructura del payload que espera el servidor WasiAI (verificada en usdcSettler.ts)
  // El campo "payload" wrappea authorization + signature
  const payloadJson = {
    payload: {
      signature,
      authorization: {
        from:        account.address,
        to:          CONTRACT_ADDRESS,
        value:       amountRaw.toString(),      // string, no bigint (no serializable en JSON)
        validAfter:  validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      },
    },
  }

  // El header se encoda como Base64(JSON) — estándar de uvd-x402-sdk
  const headerValue = Buffer.from(JSON.stringify(payloadJson)).toString('base64')

  return {
    headerName:  'X-PAYMENT',
    headerValue,
    amountUsdc:  pricePerCall,
    amountRaw,
    nonce,
  }
}
```

---

### `src/invoke.ts`

```typescript
/**
 * invoke.ts — Flujo completo: wallet → ERC-3009 → X-PAYMENT → agente WasiAI
 *
 * Cómo funciona x402:
 *
 *   ┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
 *   │  Tu Agente  │────▶│  WasiAI API      │────▶│  USDC Contract  │
 *   │  (wallet)   │     │  /models/{slug}  │     │  (Fuji)         │
 *   └─────────────┘     └──────────────────┘     └─────────────────┘
 *        │                      │                        │
 *        │ 1. Firma ERC-3009    │                        │
 *        │    off-chain         │                        │
 *        │──────────────────────▶                        │
 *        │ 2. Header X-PAYMENT  │ 3. transferWith        │
 *        │    = Base64(firma)   │    Authorization()     │
 *        │                      │───────────────────────▶│
 *        │                      │ 4. Confirma on-chain   │
 *        │                      │◀───────────────────────│
 *        │ 5. Respuesta agente  │                        │
 *        │◀─────────────────────│                        │
 *
 * Tu agente firma la autorización. Nadie más toca tu key.
 * El operador WasiAI ejecuta la tx y paga el gas — tú pagas solo USDC.
 *
 * Entry point: npm run invoke
 */

import 'dotenv/config'
import { loadWallet, checkUsdcBalance, WasiError } from './wallet.js'
import { resolveAgent } from './catalog.js'
import { buildPaymentHeader } from './pay.js'
import { log } from './logger.js'

const WASIAI_BASE_URL = (
  process.env.WASIAI_BASE_URL ?? 'https://wasiai-v2.vercel.app'
).replace(/\/$/, '')

async function main(): Promise<void> {
  console.log('\n═══════════════════════════════════════════')
  console.log('  WasiAI x402 Demo — Pago ERC-3009 Directo')
  console.log('═══════════════════════════════════════════\n')

  // ── Paso 1: Cargar wallet ──────────────────────────────────────────────────
  log.step('1/5  Cargando wallet')
  const wallet = loadWallet()
  log.ok('Wallet cargada', wallet.address)

  // ── Paso 2: Resolver agente del catálogo ───────────────────────────────────
  log.step('2/5  Resolviendo agente')
  const agent = await resolveAgent()
  log.ok(`Agente: ${agent.name}`, `slug=${agent.slug} precio=${agent.price_per_call} USDC`)

  // ── Paso 3: Verificar balance USDC ─────────────────────────────────────────
  log.step('3/5  Verificando balance USDC')
  const { balanceUsdc } = await checkUsdcBalance(wallet, agent.price_per_call)
  log.ok(`Balance USDC`, `${balanceUsdc.toFixed(6)} USDC disponibles`)

  // ── Paso 4: Firmar ERC-3009 y construir header X-PAYMENT ──────────────────
  log.step('4/5  Firmando autorización ERC-3009')
  const payment = await buildPaymentHeader(wallet.account, agent.price_per_call)
  log.ok('Header X-PAYMENT construido', `${payment.amountRaw} atomic units`)

  // ── Paso 5: Invocar el agente con el pago ──────────────────────────────────
  const prompt = process.env.AGENT_PROMPT ?? 'Hola, ¿qué puedes hacer?'
  const invokeUrl = `${WASIAI_BASE_URL}/api/v1/models/${encodeURIComponent(agent.slug)}/invoke`

  log.step('5/5  Invocando agente', invokeUrl)
  log.info('Prompt', prompt)

  let response: Response
  try {
    response = await fetch(invokeUrl, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        [payment.headerName]: payment.headerValue,
      },
      body:   JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (err) {
    throw new WasiError(
      'No se pudo conectar con WasiAI',
      `URL: ${invokeUrl}\nDetalle: ${String(err)}`,
      'network_error',
    )
  }

  const responseText = await response.text()

  // Manejo de errores HTTP tipados
  if (!response.ok) {
    let detail = responseText
    try {
      const parsed = JSON.parse(responseText) as { error?: string; message?: string; reason?: string }
      detail = parsed.error ?? parsed.message ?? parsed.reason ?? responseText
    } catch { /* usar text raw */ }

    if (response.status === 402) {
      throw new WasiError(
        `Pago rechazado por WasiAI (HTTP 402)`,
        [
          `Razón: ${detail}`,
          '',
          'Posibles causas:',
          '  • La firma ERC-3009 es inválida (verifica CHAIN_ID y USDC_ADDRESS)',
          '  • El nonce ya fue usado (vuelve a correr el script)',
          '  • validBefore expiró (sincroniza el reloj del sistema)',
          '  • CONTRACT_ADDRESS incorrecto (verifica .env)',
        ].join('\n'),
        'payment_rejected',
      )
    }

    if (response.status === 404) {
      throw new WasiError(
        `Agente "${agent.slug}" no encontrado en WasiAI`,
        `Verifica que el agente esté activo. URL: ${invokeUrl}`,
        'agent_not_found',
      )
    }

    if (response.status === 503) {
      throw new WasiError(
        `Agente "${agent.slug}" no disponible temporalmente`,
        `HTTP 503. El agente puede estar pausado. Intenta con otro agente (AGENT_SLUG en .env).`,
        'agent_unavailable',
      )
    }

    throw new WasiError(
      `Error inesperado del servidor: HTTP ${response.status}`,
      `URL: ${invokeUrl}\nRespuesta: ${detail}`,
      'server_error',
    )
  }

  // ── Resultado ──────────────────────────────────────────────────────────────
  let parsed: { result?: unknown; meta?: Record<string, unknown> }
  try {
    parsed = JSON.parse(responseText)
  } catch {
    parsed = { result: responseText }
  }

  console.log('\n──────────────────────────────────────────')
  console.log('  RESULTADO DEL AGENTE')
  console.log('──────────────────────────────────────────')
  log.result('Respuesta:', parsed.result ?? parsed)

  if (parsed.meta) {
    console.log('\n──────────────────────────────────────────')
    console.log('  METADATA DEL PAGO')
    console.log('──────────────────────────────────────────')
    const meta = parsed.meta
    log.ok('Pagado',  `${meta.charged} ${meta.currency ?? 'USDC'}`)
    log.ok('Chain',   String(meta.chain ?? 'avalanche-testnet'))
    log.ok('Latencia', `${meta.latency_ms} ms`)
    if (meta.tx_hash) {
      log.ok('TX Hash', String(meta.tx_hash))
      log.info(
        'Ver en explorer',
        `https://testnet.snowtrace.io/tx/${meta.tx_hash}`,
      )
    }
  }

  console.log('\n✅ Invocación exitosa. Tu agente pagó directamente on-chain.\n')
}

// Ejecutar y manejar errores al nivel raíz
main().catch((err: unknown) => {
  if (err instanceof WasiError) {
    log.error(err.message)
    if (err.hint) {
      console.error('\n' + err.hint + '\n')
    }
  } else {
    log.error('Error inesperado', String(err))
    if (err instanceof Error && err.stack) {
      console.error(err.stack)
    }
  }
  process.exit(1)
})
```

---

## Archivos de Configuración

### `package.json`

> ⚠️ **CORRECCIÓN:** `viem` va sin caret (`^`). Versión exacta `2.21.0` para evitar breaking changes.

```json
{
  "name": "wasiai-x402-example",
  "version": "1.0.0",
  "description": "Demo: agente autónomo que paga servicios AI on-chain con ERC-3009 (x402 protocol)",
  "type": "module",
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "invoke":  "tsx src/invoke.ts",
    "build":   "tsc",
    "start":   "node dist/invoke.js"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "viem":   "2.21.0"
  },
  "devDependencies": {
    "@types/node": "^20",
    "tsx":         "^4.7.0",
    "typescript":  "^5.4.0"
  },
  "keywords": [
    "x402", "erc-3009", "wasiai", "blockchain", "ai-payments",
    "avalanche", "fuji", "viem", "autonomous-agents"
  ]
}
```

---

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target":        "ES2022",
    "module":        "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir":        "./dist",
    "rootDir":       "./src",
    "strict":        true,
    "esModuleInterop": true,
    "skipLibCheck":  true,
    "declaration":   true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

### `.gitignore`

```
node_modules/
dist/
.env
*.env.local
.DS_Store
```

---

### `.env.example`

```bash
# ─── REQUERIDO: Wallet del agente ───────────────────────────────────────────
#
# Clave privada de la wallet de TESTING de tu agente.
# ⚠️  NUNCA uses tu wallet principal. Crea una wallet dedicada solo para demos.
# ⚠️  NUNCA commitees este archivo con PRIVATE_KEY completa.
#
# Generar wallet nueva:
#   node -e "import('viem/accounts').then(m => console.log('Address:', m.generatePrivateKey()))"
#   (o usa MetaMask en modo "Crear cuenta nueva")
#
PRIVATE_KEY=0x<tu_clave_privada_de_64_hex_chars>

# ─── OPCIONAL: Agente a invocar ──────────────────────────────────────────────
#
# Slug del agente WasiAI a invocar. Si no se define, se usa el primero activo.
# Ejemplo: AGENT_SLUG=wasiai-assistant
#
AGENT_SLUG=

# ─── OPCIONAL: Prompt al agente ──────────────────────────────────────────────
#
# Mensaje a enviar al agente. Default: "Hola, ¿qué puedes hacer?"
#
AGENT_PROMPT=Hola, ¿qué puedes hacer?

# ─── OPCIONAL: Entorno WasiAI ────────────────────────────────────────────────
#
# URL base de la API WasiAI. Default: producción en Vercel.
# Cambiar a http://localhost:3000 para desarrollo local.
#
WASIAI_BASE_URL=https://wasiai-v2.vercel.app

# ─── OPCIONAL: Contratos (Fuji por defecto) ──────────────────────────────────
#
# Dirección del contrato WasiAI v3 en Fuji.
# Default: 0x71CddCdF8a40951a1d8C22C8774448FbcA089b53
#
CONTRACT_ADDRESS=0x71CddCdF8a40951a1d8C22C8774448FbcA089b53

# Dirección del token USDC en Fuji (Circle test token).
# Default: 0x5425890298aed601595a70AB815c96711a31Bc65
#
USDC_ADDRESS=0x5425890298aed601595a70AB815c96711a31Bc65

# Chain ID de Avalanche Fuji. No cambiar a menos que tengas un motivo.
# Default: 43113
#
CHAIN_ID=43113

# ─── OPCIONAL: RPC ───────────────────────────────────────────────────────────
#
# URL del RPC de Fuji. Default: publicnode (gratuito, sin API key).
# Para producción, usa un RPC privado (Alchemy, Infura, etc).
#
RPC_URL=https://avalanche-fuji-c-chain-rpc.publicnode.com
```

---

### `README.md`

````markdown
# wasiai-x402-example

> **Demo**: Agente autónomo que paga servicios AI directamente on-chain.  
> Sin API Keys de pago. Sin intermediarios. El agente firma ERC-3009 con su propia wallet.

---

## ¿Qué es esto?

Imagina que tienes una **tienda de robots trabajadores**. Cada robot sabe hacer una cosa: uno resume textos, otro traduce, otro escribe código. Para pedirle trabajo a un robot, tienes que pagarle antes — como una máquina expendedora: metes la moneda, te da lo que pediste.

Este ejemplo muestra exactamente eso: **tu agente, con su propia wallet, paga a otro agente on-chain de forma completamente autónoma.** Sin que un humano apriete ningún botón.

**¿Por qué esto es imposible sin blockchain?**  
Con una API Key tradicional, alguien debe recargar créditos, alguien custodia el saldo, alguien puede bloquear tu cuenta. Con x402 + ERC-3009, el agente firma la autorización de pago y el contrato la ejecuta — nadie más tiene control.

---

## Cómo funciona — el flujo completo

**1. El developer configura su wallet (una sola vez)**  
Crea una wallet de testing, la fondea con USDC Fuji (gratis del faucet), pone la private key en su `.env`. Eso es todo lo que hace manualmente.

**2. El agente corre solo (`npm run invoke`)**
```
Paso 1 → Carga su wallet desde .env
Paso 2 → Pregunta a WasiAI: "¿qué agentes hay y cuánto cobran?"
Paso 3 → Verifica que tiene USDC suficiente
Paso 4 → Firma la autorización de pago (ERC-3009) con viem
          — matemática pura, sin clic, sin MetaMask
Paso 5 → Manda el trabajo + la firma como header HTTP a WasiAI
```

**3. WasiAI recibe la llamada**
```
Verifica que la firma es válida
→ Ejecuta transferWithAuthorization en el contrato USDC
→ USDC va: agente → contrato WasiAI
→ Contrato divide: 90% al creator, 10% a WasiAI
→ Corre el agente solicitado
→ Devuelve el resultado + tx_hash verificable
```

**4. El developer ve en consola**
```
✓ Resultado del agente: "Resumen: ..."
✓ Pagado: 0.001 USDC
✓ TX Hash: 0x9f1a... (verificable en Snowtrace)
```

**¿Por qué WasiAI es diferente?**
- Tu agente nunca le entrega su dinero a nadie — él firma, el contrato ejecuta
- El creator recibe USDC automáticamente, sin que nadie se lo mande
- Funciona igual si el "developer" es un agente de IA autónomo — nadie humano en el loop
- Custodia cero: WasiAI nunca toca tu private key, solo verifica la firma on-chain

**El agente paga USDC. WasiAI paga AVAX (gas). Tú pagas cero.**

---

## Prerequisitos

- Node.js 18+
- Una wallet de testing con USDC Fuji
- Aproximadamente 0.01–0.1 USDC Fuji (según el agente)

### Obtener USDC Fuji (gratis)

1. **Faucet Circle** → https://faucet.circle.com  
   Selecciona "Avalanche Fuji" y pega tu address.

2. **Faucet Snowtrace** → https://core.app/tools/testnet-faucet/?subnet=c&token=c  
   Para AVAX (si necesitas enviar tokens manualmente — el script no requiere AVAX).

### Generar wallet de testing

```bash
node -e "import('viem/accounts').then(m => { const pk = m.generatePrivateKey(); const acc = m.privateKeyToAccount(pk); console.log('Address:', acc.address); console.log('PK:', pk) })"
```

⚠️ **Usa una wallet dedicada solo para este demo. NUNCA tu wallet principal.**

---

## Setup rápido (≤ 10 minutos)

```bash
# 1. Clonar
git clone https://github.com/ferrosasfp/wasiai-x402-example
cd wasiai-x402-example

# 2. Instalar
npm install

# 3. Configurar
cp .env.example .env
# → Edita .env y completa PRIVATE_KEY

# 4. Ejecutar
npm run invoke
```

---

## Variables de entorno

| Variable          | Requerida | Default                          | Descripción                          |
|-------------------|-----------|----------------------------------|--------------------------------------|
| `PRIVATE_KEY`     | ✅ Sí     | —                                | PK de la wallet del agente (testing) |
| `AGENT_SLUG`      | No        | Primer agente activo             | Slug del agente a invocar            |
| `AGENT_PROMPT`    | No        | "Hola, ¿qué puedes hacer?"      | Mensaje al agente                    |
| `WASIAI_BASE_URL` | No        | https://wasiai-v2.vercel.app    | URL base de la API WasiAI            |
| `CONTRACT_ADDRESS`| No        | 0x71CddCdF8a40951...            | Contrato WasiAI Fuji v3              |
| `USDC_ADDRESS`    | No        | 0x5425890298aed601...           | USDC Fuji (Circle test token)        |
| `CHAIN_ID`        | No        | 43113                            | Chain ID de Avalanche Fuji           |
| `RPC_URL`         | No        | publicnode.com                   | RPC de Fuji                          |

---

## Output esperado

```
═══════════════════════════════════════════
  WasiAI x402 Demo — Pago ERC-3009 Directo
═══════════════════════════════════════════

▶ 1/5  Cargando wallet
✓ Wallet cargada  0xAbCd...1234
▶ 2/5  Resolviendo agente  https://wasiai-v2.vercel.app/api/v1/agents
✓ Agente: WasiAI Assistant  slug=wasiai-assistant precio=0.001 USDC
▶ 3/5  Verificando balance USDC
✓ Balance USDC  0.010000 USDC disponibles
▶ 4/5  Firmando autorización ERC-3009
▶ Firmando autorización ERC-3009  0.001 USDC → 0x71Cdd...b53
✓ Firma generada  0x3a8f2b1c...
▶ 5/5  Invocando agente  https://wasiai-v2.vercel.app/api/v1/models/wasiai-assistant/invoke

──────────────────────────────────────────
  RESULTADO DEL AGENTE
──────────────────────────────────────────
Respuesta:
"Hola! Soy un agente de WasiAI. Puedo ayudarte con..."

──────────────────────────────────────────
  METADATA DEL PAGO
──────────────────────────────────────────
✓ Pagado  0.001 USDC
✓ Chain   avalanche-testnet
✓ Latencia 1234 ms
✓ TX Hash  0x9f1a...
  Ver en explorer  https://testnet.snowtrace.io/tx/0x9f1a...

✅ Invocación exitosa. Tu agente pagó directamente on-chain.
```

---

## Arquitectura del código

```
src/
├── invoke.ts   # Entry point — orquesta los 5 pasos
├── wallet.ts   # Carga wallet, verifica balance USDC
├── pay.ts      # Firma ERC-3009 + construye header X-PAYMENT
├── catalog.ts  # GET /api/v1/agents — descubre agentes
└── logger.ts   # Logger con colores
```

---

## Stack técnico

- **viem 2.21.0** — firma EIP-712, interacción con blockchain (versión exacta, sin `^`)
- **dotenv** — carga variables de entorno
- **Node.js 18+** — fetch nativo, crypto nativo
- **Sin** ethers.js, LangChain, AgentKit, ni ningún framework

---

## Licencia

MIT
````

---

## Definition of Done (DoD)

El Dev marca cada ítem al terminar. QA verifica cada uno contra la implementación real.

| # | Ítem | Verificación | Estado |
|---|------|-------------|--------|
| DoD-01 | `npm install` completa en < 30 segundos sin errores | Correr en máquina limpia | [ ] |
| DoD-02 | `npm run invoke` produce resultado de agente en consola con tx_hash | Correr con wallet fondeada | [ ] |
| DoD-03 | El tx_hash del pago es verificable en https://testnet.snowtrace.io | Abrir el link en browser | [ ] |
| DoD-04 | Sin ethers.js en `node_modules` | `grep -r "ethers" node_modules/.package-lock.json` → vacío | [ ] |
| DoD-05 | `PRIVATE_KEY` ausente → error con mensaje claro + instrucciones, exit code 1 | Correr sin `.env` | [ ] |
| DoD-06 | Balance insuficiente → mensaje con link a faucet + address, exit code 1 | Correr con wallet vacía | [ ] |
| DoD-07 | `.env` está en `.gitignore` y no aparece en `git status` | `git status` con `.env` creado | [ ] |
| DoD-08 | `viem` en `package.json` tiene versión exacta `2.21.0` (sin `^`) | Inspeccionar package.json | [ ] |
| DoD-09 | `package.json` declara `engines: { node: ">=18" }` | Inspeccionar package.json | [ ] |
| DoD-10 | README tiene sección "Cómo funciona x402" con diagrama ASCII | Leer README | [ ] |
| DoD-11 | README tiene link a faucet USDC Fuji operativo | Clic en el link | [ ] |
| DoD-12 | Fer hace walkthrough completo desde cero en máquina limpia | Test de aceptación manual | [ ] |

---

## Notas de Implementación

### 1. Versión exacta de viem — SIN caret

```json
"viem": "2.21.0"
```

**NO:** `"viem": "^2.21.0"` — el caret permite actualizaciones que pueden romper la firma EIP-712 para ERC-3009. Versión pineada es obligatoria para estabilidad del ejemplo.

### 2. Debug del header X-PAYMENT

Si el servidor rechaza el pago con HTTP 402, agregar temporalmente en `invoke.ts` antes del fetch:
```typescript
console.log('Header raw:', JSON.stringify(
  JSON.parse(Buffer.from(payment.headerValue, 'base64').toString()),
  null, 2
))
```
Verificar que `payload.authorization.to === CONTRACT_ADDRESS`.

### 3. `type: "module"` en package.json

El `package.json` usa `"type": "module"`. Por eso los imports en TypeScript llevan `.js` al final (ejemplo: `import { log } from './logger.js'`). Esto es correcto para Node.js ESM con NodeNext resolution.

### 4. USDC_DOMAIN usa `verifyingContract` del USDC, NO del contrato WasiAI

El dominio EIP-712 pertenece al contrato USDC (el que tiene el método `transferWithAuthorization`), no al contrato WasiAI. El `to` en la autorización sí es el contrato WasiAI.

### 5. `value` en authorization: siempre STRING

```typescript
value: amountRaw.toString(),   // ✅ CORRECTO
value: amountRaw,              // ❌ INCORRECTO — bigint no se serializa en JSON
```

El servidor hace `BigInt(auth.value)` al leerlo.

### 6. Timeout de AbortSignal

- Catálogo: 10 segundos (`AbortSignal.timeout(10_000)`)
- Invoke: 30 segundos (`AbortSignal.timeout(30_000)`) — los agentes AI pueden tener latencia alta

### 7. Repo público

El repo debe ser público para que sea linkeable desde docs de WasiAI. Fer crea el repo en GitHub antes de que el Dev haga el primer push.

---

## Tabla de Códigos de Error

| `code` | Cuándo ocurre | Mensaje al developer |
|--------|--------------|---------------------|
| `config_missing` | `PRIVATE_KEY` no definida | Instrucciones para configurar `.env` |
| `config_invalid` | `PRIVATE_KEY` con formato incorrecto | Instrucciones para generar wallet |
| `insufficient_balance` | USDC insuficiente para cubrir el precio | Link a faucet + address del developer |
| `sign_error` | Fallo en `signTypedData` de viem | Verificar CHAIN_ID y PRIVATE_KEY |
| `invalid_price` | Precio del agente es 0 o negativo | Verificar agente en catálogo |
| `network_error` | No se puede conectar con WasiAI o con RPC | Verificar WASIAI_BASE_URL y conexión |
| `catalog_error` | Error HTTP al listar agentes | Mostrar status code y body raw |
| `no_agents` | Catálogo vacío o sin activos | Verificar entorno |
| `agent_not_found` | `AGENT_SLUG` no existe en catálogo | Listar slugs disponibles |
| `payment_rejected` | HTTP 402 del servidor | Posibles causas + pasos de debug |
| `agent_unavailable` | HTTP 503 del servidor | Sugerir otro agente |
| `server_error` | HTTP 5xx inesperado | Mostrar status + body raw |

---

## Checklist Pre-Commit (Adversarial Review)

Antes del primer commit, el Dev debe activar Adversarial Review:

```
Actúa como Adversarial Reviewer.
Lee _bmad/core/tasks/review-adversarial-general.xml
y revisa el diff/código de: [archivos src/*.ts]
```

Puntos críticos a revisar:
- [ ] `PRIVATE_KEY` nunca aparece en logs ni en ningún output
- [ ] `.env` está en `.gitignore` — verificar con `git check-ignore .env`
- [ ] No hay addresses hardcodeadas en los `.ts` (solo como defaults en `const`, documentadas)
- [ ] El nonce es efectivamente aleatorio (no secuencial, no timestamp)
- [ ] `validBefore` es razonable (5 minutos — no años)

---

*Story file generado por SM Agent — BMAD v6. Listo para implementación.*  
*El Dev implementa SOLO desde este archivo. No requiere leer ningún otro documento.*
