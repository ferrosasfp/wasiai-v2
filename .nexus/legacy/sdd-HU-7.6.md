# SDD — HU-7.6: DeFi Risk Intelligence Pipeline
> **Agente:** S1 (Architect) — San  
> **Fecha:** 2026-02-28  
> **Estado:** PENDIENTE SPEC_APPROVED  
> **HU:** HU-7.6 — DeFi Risk Intelligence Pipeline (5 Agentes WasiAI)  
> **Épica:** E7 — Integraciones con Ecosistema AI

---

## 0. Verificación de Kite AI API

**RESULTADO: NO DISPONIBLE**

| URL intentada | Resultado |
|---|---|
| `https://docs.kiteai.io` | `ENOTFOUND` — dominio no resuelve |
| `https://api.kiteai.io` | `ENOTFOUND` — dominio no resuelve |
| `https://kite.ai/docs` | Página crasheada ("Application Crashed") |

**Decisión de arquitectura:** Agent 3 usará **Groq + llama-3.3-70b-versatile** con prompt especializado de auditoría de contratos EVM como fallback permanente. Se documenta como deuda técnica para reactivar si Kite AI lanza API pública.

---

## 1. Arquitectura General

### Decisión: 5 endpoints separados + shared lib

**Justificación:**
- Cada agente es un producto independiente en el marketplace (callable individualmente con x402)
- Agent 5 reutiliza lógica de Agents 1-4 vía funciones compartidas en `/lib/defi-risk/` (no HTTP calls internas — evita latencia y errores de red intra-proceso)
- Patrón idéntico al de `demo/agents` pero en `agents-internal`

### Flujo de datos

```
Consumer → POST /api/v1/models/wasi-risk-report/invoke
                    ↓
           WasiAI Gateway (x402/key auth + billing)
                    ↓
           endpoint_url → /api/v1/agents-internal/wasi-risk-report
                    ↓
           Imports lib/defi-risk/* (in-process, no HTTP)
           ├── chainlink.ts → Chainlink on-chain (viem)
           ├── onchain.ts   → Avalanche RPC + Snowtrace API
           ├── auditor.ts   → Groq llama audit
           └── sentiment.ts → Groq llama DeFi sentiment
                    ↓
           riskScorer.ts → score 0-100 → SAFE/CAUTION/AVOID
```

### Rutas de endpoint

| Slug | Endpoint interno | Callable individualmente |
|---|---|---|
| `wasi-chainlink-price` | `/api/v1/agents-internal/wasi-chainlink-price` | ✅ |
| `wasi-onchain-analyzer` | `/api/v1/agents-internal/wasi-onchain-analyzer` | ✅ |
| `wasi-contract-auditor` | `/api/v1/agents-internal/wasi-contract-auditor` | ✅ |
| `wasi-defi-sentiment` | `/api/v1/agents-internal/wasi-defi-sentiment` | ✅ |
| `wasi-risk-report` | `/api/v1/agents-internal/wasi-risk-report` | ✅ |

---

## 2. Schema de Registro en DB

### Migration: `017_defi_risk_agents.sql`

```sql
-- Migration 017: DeFi Risk Intelligence Agents (HU-7.6)
-- Registra los 5 agentes oficiales de WasiAI en el marketplace

-- ① Asegurar que existe la categoría defi-risk (si categories es enum o check)
-- Si category es text libre, omitir. Si es enum, agregar 'defi-risk' al tipo.
-- El codebase usa text libre en agents.category → no se necesita cambio de tipo.

-- ② Insertar los 5 agentes oficiales
-- NOTA: creator_id debe ser el UUID del usuario oficial WasiAI.
--       Se lee desde env var WASIAI_OFFICIAL_CREATOR_ID en el seed script.
--       Esta migration usa una función helper que lee la variable de entorno
--       o inserta con creator_id = NULL si no está seteada (se actualiza en deploy).

-- Los agentes se insertan con DO UPDATE para ser idempotentes (re-runnable).

INSERT INTO agents (
  slug,
  name,
  description,
  category,
  price_per_call,
  currency,
  chain,
  status,
  endpoint_url,
  capabilities,
  created_at
) VALUES
(
  'wasi-chainlink-price',
  'Chainlink Price Feed Reader',
  'Lee precios on-chain desde Chainlink AggregatorV3Interface en Avalanche. Retorna precio actual, timestamp, y snapshot histórico de 7 rondas. Input: { feed_address, token_symbol? }',
  'defi-risk',
  0.05,
  'USDC',
  'avalanche-fuji',
  'active',
  'SITE_URL_PLACEHOLDER/api/v1/agents-internal/wasi-chainlink-price',
  '["chainlink","on-chain","price-feed"]',
  NOW()
),
(
  'wasi-onchain-analyzer',
  'On-Chain Token Analyzer',
  'Analiza métricas on-chain de cualquier token ERC-20 en Avalanche: holders, concentración top-10, age del contrato, flags de riesgo (mint activo, owner renounced, paused). Input: { token_address }',
  'defi-risk',
  0.10,
  'USDC',
  'avalanche-fuji',
  'active',
  'SITE_URL_PLACEHOLDER/api/v1/agents-internal/wasi-onchain-analyzer',
  '["on-chain","holders","contract-analysis"]',
  NOW()
),
(
  'wasi-contract-auditor',
  'Smart Contract Auditor',
  'Audita contratos EVM buscando patrones de rug pull, honeypot, permisos peligrosos y vulnerabilidades. Powered by Groq LLM. Input: { token_address, contract_source? }',
  'defi-risk',
  0.20,
  'USDC',
  'avalanche-fuji',
  'active',
  'SITE_URL_PLACEHOLDER/api/v1/agents-internal/wasi-contract-auditor',
  '["audit","security","llm"]',
  NOW()
),
(
  'wasi-defi-sentiment',
  'DeFi Sentiment Analyzer',
  'Analiza el nombre, símbolo, descripción y metadata del token para detectar red flags textuales y score de sentimiento. Input: { token_name, token_symbol, description? }',
  'defi-risk',
  0.05,
  'USDC',
  'avalanche-fuji',
  'active',
  'SITE_URL_PLACEHOLDER/api/v1/agents-internal/wasi-defi-sentiment',
  '["sentiment","nlp","defi"]',
  NOW()
),
(
  'wasi-risk-report',
  'DeFi Risk Report Generator',
  'Pipeline completo de análisis de riesgo DeFi. Agrega Chainlink price, on-chain metrics, auditoría de contrato y sentimiento en un reporte estructurado con score 0-100 y rating SAFE/CAUTION/AVOID. Input: { token_address, feed_address?, token_name?, token_symbol?, description? }',
  'defi-risk',
  0.35,
  'USDC',
  'avalanche-fuji',
  'active',
  'SITE_URL_PLACEHOLDER/api/v1/agents-internal/wasi-risk-report',
  '["risk","pipeline","chainlink","audit","sentiment"]',
  NOW()
)
ON CONFLICT (slug) DO UPDATE SET
  status      = EXCLUDED.status,
  endpoint_url = EXCLUDED.endpoint_url,
  description = EXCLUDED.description,
  price_per_call = EXCLUDED.price_per_call;
```

**Nota sobre `endpoint_url`:** La migration usa `SITE_URL_PLACEHOLDER` como marcador. El script de deploy (o un seed post-migration) reemplaza con `process.env.NEXT_PUBLIC_SITE_URL`. Alternativamente, el endpoint_url se puede actualizar vía Supabase Management API en el pipeline de CI/CD.

**Campos existentes usados** (no se agregan columnas nuevas):
- `slug` — identificador único del agente
- `name`, `description` — visibles en marketplace
- `category` — filtro en UI (`defi-risk`)
- `price_per_call` — fee en USDC
- `currency`, `chain` — metadata de pago
- `status` — `'active'` desde el insert
- `endpoint_url` — URL interna que llama el gateway
- `capabilities` — JSONB array de tags

**No se requieren columnas nuevas** — el schema existente cubre todos los campos necesarios.

---

## 3. Variables de Entorno Necesarias

```env
# Ya existe en el proyecto:
GROQ_API_KEY=...                          # Usado por demo agents, reutilizado aquí

# Nuevas (agregar a .env.local y Vercel):
CHAINLINK_AVAX_USD_FEED=0x5498BB86BC934c8D34FDA08E81D444153d0D06aD
AVALANCHE_FUJI_RPC=https://avalanche-fuji-c-chain-rpc.publicnode.com
SNOWTRACE_API_KEY=                        # Opcional — sin key funciona en modo free (rate limitado)
SNOWTRACE_BASE_URL=https://api-testnet.snowtrace.io  # Fuji testnet
```

---

## 4. Estructura de Archivos

```
src/
├── lib/
│   └── defi-risk/
│       ├── chainlink.ts       ← Agent 1 logic
│       ├── onchain.ts         ← Agent 2 logic
│       ├── auditor.ts         ← Agent 3 logic (Groq fallback)
│       ├── sentiment.ts       ← Agent 4 logic
│       ├── riskScorer.ts      ← Agent 5 scoring formula
│       └── types.ts           ← Shared TypeScript types
└── app/
    └── api/
        └── v1/
            └── agents-internal/
                ├── wasi-chainlink-price/route.ts
                ├── wasi-onchain-analyzer/route.ts
                ├── wasi-contract-auditor/route.ts
                ├── wasi-defi-sentiment/route.ts
                └── wasi-risk-report/route.ts

supabase/migrations/017_defi_risk_agents.sql
```

---

## 5. Código Completo

### 5.0 `src/lib/defi-risk/types.ts`

```typescript
// Shared TypeScript types for DeFi Risk Intelligence Pipeline

export interface ChainlinkResult {
  feed_address: string
  token_symbol: string
  price_usd: number
  timestamp: number
  round_id: string
  history: Array<{ round_id: string; price_usd: number; timestamp: number }>
  volatility_7d_pct: number
  error?: string
}

export interface OnChainResult {
  token_address: string
  name: string
  symbol: string
  total_supply: string
  decimals: number
  contract_age_days: number
  holder_count: number | null
  top10_concentration_pct: number | null
  flags: {
    has_mint_function: boolean
    owner_renounced: boolean
    is_paused: boolean
    is_proxy: boolean
    bytecode_size_bytes: number
  }
  error?: string
}

export interface AuditFinding {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'
  title: string
  description: string
}

export interface AuditResult {
  token_address: string
  findings: AuditFinding[]
  summary: string
  powered_by: 'groq-llama' | 'kite-ai'
  error?: string
}

export interface SentimentResult {
  token_name: string
  token_symbol: string
  sentiment_score: number       // 0 (clean) to 100 (very suspicious)
  flags: string[]               // e.g. ["FOMO naming", "Too-good-to-be-true"]
  analysis: string
  error?: string
}

export interface RiskScore {
  total: number                  // 0-100
  rating: 'SAFE' | 'CAUTION' | 'AVOID'
  breakdown: {
    volatility:    { score: number; weight: number; contribution: number }
    concentration: { score: number; weight: number; contribution: number }
    audit:         { score: number; weight: number; contribution: number }
    sentiment:     { score: number; weight: number; contribution: number }
  }
}

export interface RiskReport {
  token_address: string
  generated_at: string          // ISO timestamp
  risk_score: RiskScore
  agents: {
    chainlink:   ChainlinkResult | null
    onchain:     OnChainResult | null
    audit:       AuditResult | null
    sentiment:   SentimentResult | null
  }
  summary: string               // Human-readable summary
  disclaimer: string
}
```

---

### 5.1 `src/lib/defi-risk/chainlink.ts`

```typescript
/**
 * Agent 1 — Chainlink Price Feed Reader
 * Reads AggregatorV3Interface on-chain via viem v2
 * Uses: CHAINLINK_AVAX_USD_FEED env var as default feed
 */
import { getPublicClient } from '@/lib/viem'
import type { ChainlinkResult } from './types'

// Minimal ABI for Chainlink AggregatorV3Interface
const AGGREGATOR_ABI = [
  {
    name: 'latestRoundData',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId',         type: 'uint80' },
      { name: 'answer',          type: 'int256' },
      { name: 'startedAt',       type: 'uint256' },
      { name: 'updatedAt',       type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
  {
    name: 'getRoundData',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_roundId', type: 'uint80' }],
    outputs: [
      { name: 'roundId',         type: 'uint80' },
      { name: 'answer',          type: 'int256' },
      { name: 'startedAt',       type: 'uint256' },
      { name: 'updatedAt',       type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const

function rawToPrice(answer: bigint, decimals: number): number {
  return Number(answer) / Math.pow(10, decimals)
}

export async function readChainlinkFeed(
  feedAddress: string,
  tokenSymbol = 'UNKNOWN',
): Promise<ChainlinkResult> {
  const client = getPublicClient()
  const address = feedAddress.trim() as `0x${string}`

  try {
    // Parallel: get decimals + latest round data
    const [decimals, latest] = await Promise.all([
      client.readContract({ address, abi: AGGREGATOR_ABI, functionName: 'decimals' }),
      client.readContract({ address, abi: AGGREGATOR_ABI, functionName: 'latestRoundData' }),
    ])

    const dec = Number(decimals)
    const currentPrice = rawToPrice(latest[1], dec)
    const currentRoundId = latest[0]

    // Fetch 7 historical rounds (best-effort, skip on error)
    const HISTORY_COUNT = 7
    const history: ChainlinkResult['history'] = []

    for (let i = 0; i < HISTORY_COUNT; i++) {
      const targetRound = currentRoundId - BigInt(i + 1)
      if (targetRound <= 0n) break
      try {
        const round = await client.readContract({
          address,
          abi: AGGREGATOR_ABI,
          functionName: 'getRoundData',
          args: [targetRound],
        })
        history.push({
          round_id:  round[0].toString(),
          price_usd: rawToPrice(round[1], dec),
          timestamp: Number(round[3]),
        })
      } catch {
        // Round not available — skip
        break
      }
    }

    // Calculate 7d volatility: (max - min) / min * 100
    const prices = [currentPrice, ...history.map(h => h.price_usd)]
    const maxP = Math.max(...prices)
    const minP = Math.min(...prices)
    const volatility_7d_pct = minP > 0 ? ((maxP - minP) / minP) * 100 : 0

    return {
      feed_address:     address,
      token_symbol:     tokenSymbol,
      price_usd:        currentPrice,
      timestamp:        Number(latest[3]),
      round_id:         currentRoundId.toString(),
      history,
      volatility_7d_pct: Math.round(volatility_7d_pct * 100) / 100,
    }
  } catch (err) {
    return {
      feed_address:     address,
      token_symbol:     tokenSymbol,
      price_usd:        0,
      timestamp:        0,
      round_id:         '0',
      history:          [],
      volatility_7d_pct: 0,
      error:            `Chainlink read failed: ${String(err).slice(0, 200)}`,
    }
  }
}
```

---

### 5.2 `src/lib/defi-risk/onchain.ts`

```typescript
/**
 * Agent 2 — On-Chain Token Analyzer
 * Uses viem v2 for contract reads + Snowtrace API for holder data
 */
import { getPublicClient } from '@/lib/viem'
import type { OnChainResult } from './types'

const SNOWTRACE_BASE = (process.env.SNOWTRACE_BASE_URL ?? 'https://api-testnet.snowtrace.io').trim()
const SNOWTRACE_KEY  = (process.env.SNOWTRACE_API_KEY ?? '').trim()

// Minimal ERC-20 ABI
const ERC20_ABI = [
  { name: 'name',        type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'symbol',      type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'decimals',    type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8'  }] },
  { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'owner',       type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'paused',      type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool'   }] },
] as const

async function snowtraceGet(path: string): Promise<unknown> {
  const keyParam = SNOWTRACE_KEY ? `&apikey=${SNOWTRACE_KEY}` : ''
  const url = `${SNOWTRACE_BASE}/api?${path}${keyParam}`
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) })
  if (!res.ok) throw new Error(`Snowtrace HTTP ${res.status}`)
  return res.json()
}

export async function analyzeOnChain(tokenAddress: string): Promise<OnChainResult> {
  const client = getPublicClient()
  const address = tokenAddress.trim() as `0x${string}`

  // ── 1. Basic ERC-20 reads (parallel) ────────────────────────────────────
  const [nameRes, symbolRes, decimalsRes, totalSupplyRes, bytecodeRes] = await Promise.allSettled([
    client.readContract({ address, abi: ERC20_ABI, functionName: 'name' }),
    client.readContract({ address, abi: ERC20_ABI, functionName: 'symbol' }),
    client.readContract({ address, abi: ERC20_ABI, functionName: 'decimals' }),
    client.readContract({ address, abi: ERC20_ABI, functionName: 'totalSupply' }),
    client.getBytecode({ address }),
  ])

  const name        = nameRes.status        === 'fulfilled' ? String(nameRes.value)                      : 'Unknown'
  const symbol      = symbolRes.status      === 'fulfilled' ? String(symbolRes.value)                    : '???'
  const decimals    = decimalsRes.status    === 'fulfilled' ? Number(decimalsRes.value)                  : 18
  const totalSupply = totalSupplyRes.status === 'fulfilled' ? String(totalSupplyRes.value)               : '0'
  const bytecode    = bytecodeRes.status    === 'fulfilled' ? (bytecodeRes.value ?? '0x')                : '0x'

  // ── 2. Risk flags (best-effort reads) ───────────────────────────────────
  const [ownerRes, pausedRes] = await Promise.allSettled([
    client.readContract({ address, abi: ERC20_ABI, functionName: 'owner' }),
    client.readContract({ address, abi: ERC20_ABI, functionName: 'paused' }),
  ])

  const ownerAddress  = ownerRes.status  === 'fulfilled' ? String(ownerRes.value)      : null
  const isPaused      = pausedRes.status === 'fulfilled' ? Boolean(pausedRes.value)     : false
  const ownerRenounced = ownerAddress === '0x0000000000000000000000000000000000000000'

  // Detect mint function from bytecode selector (4-byte keccak of "mint(address,uint256)")
  const MINT_SELECTOR = '0x40c10f19'
  const hasMintFunction = bytecode.toLowerCase().includes(MINT_SELECTOR.slice(2))

  // Detect proxy pattern (EIP-1967 implementation slot in bytecode)
  const PROXY_PATTERN = '5c60da1b'
  const isProxy = bytecode.toLowerCase().includes(PROXY_PATTERN)

  const bytecodeSize = Math.floor((bytecode.length - 2) / 2)

  // ── 3. Contract age via Snowtrace ────────────────────────────────────────
  let contractAgeDays = 0
  try {
    const creationData = await snowtraceGet(
      `module=contract&action=getcontractcreation&contractaddresses=${address}`
    ) as { result?: Array<{ txHash: string }> }
    const txHash = creationData.result?.[0]?.txHash
    if (txHash) {
      const txData = await snowtraceGet(
        `module=proxy&action=eth_getTransactionByHash&txhash=${txHash}`
      ) as { result?: { blockNumber?: string } }
      const blockHex = txData.result?.blockNumber
      if (blockHex) {
        const block = await client.getBlock({ blockNumber: BigInt(blockHex) })
        const ageMs = Date.now() - Number(block.timestamp) * 1000
        contractAgeDays = Math.floor(ageMs / (1000 * 60 * 60 * 24))
      }
    }
  } catch {
    contractAgeDays = -1  // Unknown
  }

  // ── 4. Holder data via Snowtrace (best-effort) ───────────────────────────
  let holderCount: number | null = null
  let top10ConcentrationPct: number | null = null

  try {
    const holderData = await snowtraceGet(
      `module=token&action=tokenholderlist&contractaddress=${address}&page=1&offset=100`
    ) as { result?: Array<{ TokenHolderQuantity: string }> }

    if (Array.isArray(holderData.result) && holderData.result.length > 0) {
      const holders = holderData.result
      holderCount = holders.length

      // Top-10 concentration
      const totalQty = holders.reduce((sum, h) => sum + BigInt(h.TokenHolderQuantity), 0n)
      const top10Qty = holders
        .sort((a, b) => (BigInt(b.TokenHolderQuantity) > BigInt(a.TokenHolderQuantity) ? 1 : -1))
        .slice(0, 10)
        .reduce((sum, h) => sum + BigInt(h.TokenHolderQuantity), 0n)

      top10ConcentrationPct = totalQty > 0n
        ? Math.round(Number((top10Qty * 10000n) / totalQty) / 100)
        : null
    }
  } catch {
    // Snowtrace unavailable — degrade gracefully
  }

  return {
    token_address: address,
    name,
    symbol,
    total_supply:  totalSupply,
    decimals,
    contract_age_days: contractAgeDays,
    holder_count:  holderCount,
    top10_concentration_pct: top10ConcentrationPct,
    flags: {
      has_mint_function: hasMintFunction,
      owner_renounced:   ownerRenounced,
      is_paused:         isPaused,
      is_proxy:          isProxy,
      bytecode_size_bytes: bytecodeSize,
    },
  }
}
```

---

### 5.3 `src/lib/defi-risk/auditor.ts`

```typescript
/**
 * Agent 3 — Smart Contract Auditor
 * KITE AI STATUS: NOT AVAILABLE (verified 2026-02-28)
 * Fallback: Groq llama-3.3-70b-versatile with specialized audit prompt
 * 
 * Technical debt: integrate Kite AI when API becomes available.
 */
import { callGroq } from '@/lib/agents/groq'
import type { AuditResult, AuditFinding } from './types'

const AUDIT_SYSTEM_PROMPT = `You are a senior smart contract security auditor specializing in EVM/Avalanche DeFi contracts.

Given a token contract address and optionally its ABI or source, analyze for:
1. Rug pull mechanisms (hidden owner functions, drainable liquidity, emergency withdraw)
2. Honeypot patterns (sell restrictions, blacklist functions, transfer fees >10%)
3. Dangerous permissions (mint without cap, pause all transfers, setFee, blacklist/whitelist)
4. Centralization risks (single owner, upgradeable proxy without timelock)
5. Common vulnerabilities (reentrancy, integer overflow, unchecked returns)

RESPOND ONLY with valid JSON in this exact format, no extra text:
{
  "findings": [
    {
      "severity": "CRITICAL|HIGH|MEDIUM|LOW|INFO",
      "title": "Short title",
      "description": "What it means and why it matters"
    }
  ],
  "summary": "2-3 sentence overall assessment"
}`

export async function auditContract(
  tokenAddress: string,
  contractSource?: string,
): Promise<AuditResult> {
  const userContent = contractSource
    ? `Token address: ${tokenAddress}\n\nContract source/ABI:\n${contractSource.slice(0, 8000)}`
    : `Token address: ${tokenAddress}\n\nNo source code provided. Analyze based on the address and any known patterns for this type of contract on Avalanche Fuji testnet. Focus on common DeFi risks.`

  try {
    const response = await callGroq({
      messages: [
        { role: 'system', content: AUDIT_SYSTEM_PROMPT },
        { role: 'user',   content: userContent },
      ],
      model:       'llama-3.3-70b-versatile',
      maxTokens:   1024,
      temperature: 0,  // Deterministic for consistency
    })

    let parsed: { findings: AuditFinding[]; summary: string }
    try {
      parsed = JSON.parse(response.result)
    } catch {
      // LLM returned non-JSON — wrap in a single finding
      parsed = {
        findings: [{
          severity: 'INFO',
          title: 'Analysis completed',
          description: response.result.slice(0, 500),
        }],
        summary: response.result.slice(0, 200),
      }
    }

    // Validate and sanitize severities
    const validSeverities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']
    const findings: AuditFinding[] = (parsed.findings ?? []).map(f => ({
      severity:    validSeverities.includes(f.severity) ? f.severity : 'INFO',
      title:       String(f.title ?? '').slice(0, 100),
      description: String(f.description ?? '').slice(0, 500),
    })) as AuditFinding[]

    return {
      token_address: tokenAddress,
      findings,
      summary:    String(parsed.summary ?? '').slice(0, 500),
      powered_by: 'groq-llama',
    }
  } catch (err) {
    return {
      token_address: tokenAddress,
      findings: [],
      summary: 'Audit unavailable',
      powered_by: 'groq-llama',
      error: String(err).slice(0, 200),
    }
  }
}
```

---

### 5.4 `src/lib/defi-risk/sentiment.ts`

```typescript
/**
 * Agent 4 — DeFi Sentiment Analyzer
 * Analyzes token name, symbol, and description for red flags
 */
import { callGroq } from '@/lib/agents/groq'
import type { SentimentResult } from './types'

const SENTIMENT_SYSTEM_PROMPT = `You are a DeFi fraud detection specialist. Analyze a token's name, symbol, and description for warning signs.

Look for:
- FOMO/hype naming ("Moon", "Safe", "Gem", "100x", "ElonBased", "Turbo")
- Impersonation of legitimate projects ("SafeMoon", "BabyETH", "MiniDOGE")
- Unrealistic promises in description ("guaranteed returns", "rugproof", "fully audited" without proof)
- Anonymous team + aggressive marketing language
- Legitimate indicators (real utility description, team transparency, verifiable use case)

RESPOND ONLY with valid JSON, no extra text:
{
  "sentiment_score": <integer 0-100, where 0=very clean, 100=very suspicious>,
  "flags": ["list", "of", "detected", "red", "flags"],
  "analysis": "2-3 sentence explanation"
}`

export async function analyzeSentiment(
  tokenName: string,
  tokenSymbol: string,
  description?: string,
): Promise<SentimentResult> {
  const userContent = `Token name: ${tokenName}
Symbol: ${tokenSymbol}
Description: ${description ? description.slice(0, 1000) : 'Not provided'}`

  try {
    const response = await callGroq({
      messages: [
        { role: 'system', content: SENTIMENT_SYSTEM_PROMPT },
        { role: 'user',   content: userContent },
      ],
      model:       'llama-3.3-70b-versatile',
      maxTokens:   512,
      temperature: 0,
    })

    let parsed: { sentiment_score: number; flags: string[]; analysis: string }
    try {
      parsed = JSON.parse(response.result)
    } catch {
      parsed = {
        sentiment_score: 50,
        flags: ['Parse error — manual review recommended'],
        analysis: response.result.slice(0, 200),
      }
    }

    return {
      token_name:      tokenName,
      token_symbol:    tokenSymbol,
      sentiment_score: Math.min(100, Math.max(0, Number(parsed.sentiment_score ?? 50))),
      flags:           Array.isArray(parsed.flags) ? parsed.flags.map(f => String(f).slice(0, 100)) : [],
      analysis:        String(parsed.analysis ?? '').slice(0, 500),
    }
  } catch (err) {
    return {
      token_name:      tokenName,
      token_symbol:    tokenSymbol,
      sentiment_score: 50,
      flags:           [],
      analysis:        'Sentiment analysis unavailable',
      error:           String(err).slice(0, 200),
    }
  }
}
```

---

### 5.5 `src/lib/defi-risk/riskScorer.ts`

```typescript
/**
 * Agent 5 — Risk Scorer
 * Documented formula for aggregating 4 agent outputs into a 0-100 risk score.
 *
 * ══════════════════════════════════════════════════════════════
 * RISK SCORING FORMULA v1.0 (HU-7.6)
 * ══════════════════════════════════════════════════════════════
 *
 * FINAL SCORE = Σ (component_score × weight)
 *
 * Components and weights:
 * ┌─────────────────────┬────────┬──────────────────────────────────────┐
 * │ Component           │ Weight │ Source                               │
 * ├─────────────────────┼────────┼──────────────────────────────────────┤
 * │ Audit               │  35%   │ Agent 3 — contract security findings │
 * │ Concentration       │  25%   │ Agent 2 — top-10 holder concentration│
 * │ Volatility          │  25%   │ Agent 1 — 7d price volatility        │
 * │ Sentiment           │  15%   │ Agent 4 — name/description red flags │
 * └─────────────────────┴────────┴──────────────────────────────────────┘
 *
 * Component score mapping:
 *
 * AUDIT SCORE (0-100):
 *   CRITICAL finding present → 100
 *   HIGH finding present     → 75
 *   MEDIUM finding present   → 45
 *   LOW finding present      → 20
 *   INFO only                →  5
 *   No findings              →  0
 *   (uses worst single finding)
 *
 * CONCENTRATION SCORE (0-100):
 *   Top-10 owns ≥ 90%        → 100
 *   Top-10 owns 75-89%       →  80
 *   Top-10 owns 60-74%       →  60
 *   Top-10 owns 40-59%       →  35
 *   Top-10 owns < 40%        →  10
 *   Data unavailable         →  50 (neutral penalty)
 *
 * VOLATILITY SCORE (0-100):
 *   7d volatility ≥ 80%      → 100
 *   7d volatility 50-79%     →  75
 *   7d volatility 25-49%     →  50
 *   7d volatility 10-24%     →  25
 *   7d volatility < 10%      →   5
 *   Data unavailable         →  50
 *
 * SENTIMENT SCORE (0-100):
 *   Direct from Agent 4 (already 0-100 scale)
 *   Data unavailable         →  50
 *
 * ADDITIONAL FLAG PENALTIES (added to final score, capped at 100):
 *   Contract age < 7 days    →  +10
 *   Mint function active      →  +5
 *   Is proxy (unverified)     →  +5
 *
 * RATING THRESHOLDS:
 *   0-30  → SAFE
 *   31-65 → CAUTION
 *   66-100→ AVOID
 *
 * ══════════════════════════════════════════════════════════════
 */
import type {
  ChainlinkResult,
  OnChainResult,
  AuditResult,
  SentimentResult,
  RiskScore,
} from './types'

function auditComponentScore(audit: AuditResult | null): number {
  if (!audit || audit.findings.length === 0) return 0
  const worst = audit.findings.reduce<AuditResult['findings'][0] | null>((prev, curr) => {
    const order = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 }
    if (!prev) return curr
    return order[curr.severity] > order[prev.severity] ? curr : prev
  }, null)
  if (!worst) return 0
  const map = { CRITICAL: 100, HIGH: 75, MEDIUM: 45, LOW: 20, INFO: 5 }
  return map[worst.severity]
}

function concentrationComponentScore(onchain: OnChainResult | null): number {
  const pct = onchain?.top10_concentration_pct
  if (pct === null || pct === undefined) return 50
  if (pct >= 90) return 100
  if (pct >= 75) return 80
  if (pct >= 60) return 60
  if (pct >= 40) return 35
  return 10
}

function volatilityComponentScore(chainlink: ChainlinkResult | null): number {
  if (!chainlink || chainlink.error) return 50
  const v = chainlink.volatility_7d_pct
  if (v >= 80) return 100
  if (v >= 50) return 75
  if (v >= 25) return 50
  if (v >= 10) return 25
  return 5
}

function sentimentComponentScore(sentiment: SentimentResult | null): number {
  if (!sentiment || sentiment.error) return 50
  return sentiment.sentiment_score
}

export function computeRiskScore(
  chainlink:   ChainlinkResult | null,
  onchain:     OnChainResult | null,
  audit:       AuditResult | null,
  sentiment:   SentimentResult | null,
): RiskScore {
  const WEIGHTS = { volatility: 0.25, concentration: 0.25, audit: 0.35, sentiment: 0.15 }

  const scores = {
    volatility:    volatilityComponentScore(chainlink),
    concentration: concentrationComponentScore(onchain),
    audit:         auditComponentScore(audit),
    sentiment:     sentimentComponentScore(sentiment),
  }

  const breakdown = {
    volatility:    { score: scores.volatility,    weight: WEIGHTS.volatility,    contribution: scores.volatility    * WEIGHTS.volatility    },
    concentration: { score: scores.concentration, weight: WEIGHTS.concentration, contribution: scores.concentration * WEIGHTS.concentration },
    audit:         { score: scores.audit,         weight: WEIGHTS.audit,         contribution: scores.audit         * WEIGHTS.audit         },
    sentiment:     { score: scores.sentiment,     weight: WEIGHTS.sentiment,     contribution: scores.sentiment     * WEIGHTS.sentiment     },
  }

  let total = Object.values(breakdown).reduce((sum, c) => sum + c.contribution, 0)

  // Flag penalties
  if (onchain) {
    if (onchain.contract_age_days >= 0 && onchain.contract_age_days < 7)  total += 10
    if (onchain.flags.has_mint_function)                                    total += 5
    if (onchain.flags.is_proxy)                                             total += 5
  }

  const finalScore = Math.min(100, Math.round(total))
  const rating: RiskScore['rating'] = finalScore <= 30 ? 'SAFE' : finalScore <= 65 ? 'CAUTION' : 'AVOID'

  return { total: finalScore, rating, breakdown }
}

export function generateSummary(
  tokenAddress: string,
  score: RiskScore,
  chainlink: ChainlinkResult | null,
  onchain: OnChainResult | null,
  audit: AuditResult | null,
  sentiment: SentimentResult | null,
): string {
  const ratingEmoji = { SAFE: '✅', CAUTION: '⚠️', AVOID: '🚫' }[score.rating]
  const name = onchain?.name ?? tokenAddress.slice(0, 10) + '...'
  const symbol = onchain?.symbol ?? '???'
  const price = chainlink?.price_usd ? `$${chainlink.price_usd.toFixed(4)}` : 'N/A'

  const criticalFindings = audit?.findings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH') ?? []
  const criticalText = criticalFindings.length > 0
    ? ` Critical issues: ${criticalFindings.map(f => f.title).join(', ')}.`
    : ''

  return `${ratingEmoji} ${name} (${symbol}) — Risk Score: ${score.total}/100 [${score.rating}]. ` +
    `Current price: ${price}. ` +
    `Holder concentration (top-10): ${onchain?.top10_concentration_pct != null ? onchain.top10_concentration_pct + '%' : 'unknown'}. ` +
    `7d volatility: ${chainlink?.volatility_7d_pct != null ? chainlink.volatility_7d_pct.toFixed(1) + '%' : 'unknown'}.` +
    criticalText +
    ` Sentiment: ${sentiment?.analysis ?? 'not analyzed'}`
}
```

---

### 5.6 `src/app/api/v1/agents-internal/wasi-chainlink-price/route.ts`

```typescript
/**
 * Agent 1 — Chainlink Price Feed Reader
 * Internal endpoint — auth/payment enforced by the WasiAI gateway layer
 *
 * POST /api/v1/agents-internal/wasi-chainlink-price
 * Body: { input: string } where input = JSON string { feed_address, token_symbol? }
 *   OR  { feed_address: string, token_symbol?: string } (direct object)
 */
import { NextRequest, NextResponse } from 'next/server'
import { readChainlinkFeed } from '@/lib/defi-risk/chainlink'

const DEFAULT_FEED = (process.env.CHAINLINK_AVAX_USD_FEED ?? '').trim()

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Support both { input: "..." } (gateway pattern) and { feed_address: "..." } (direct)
  let feedAddress: string
  let tokenSymbol: string = 'UNKNOWN'

  if (typeof body.input === 'string') {
    try {
      const parsed = JSON.parse(body.input) as Record<string, string>
      feedAddress  = parsed.feed_address?.trim() ?? ''
      tokenSymbol  = parsed.token_symbol?.trim() ?? 'UNKNOWN'
    } catch {
      feedAddress = body.input.trim()
    }
  } else {
    feedAddress = String(body.feed_address ?? body.feedAddress ?? '').trim()
    tokenSymbol = String(body.token_symbol ?? body.tokenSymbol ?? 'UNKNOWN').trim()
  }

  // Fall back to default AVAX/USD feed if none provided
  if (!feedAddress) {
    if (!DEFAULT_FEED) {
      return NextResponse.json({ error: 'feed_address required. Set CHAINLINK_AVAX_USD_FEED env var for default.' }, { status: 400 })
    }
    feedAddress = DEFAULT_FEED
    if (tokenSymbol === 'UNKNOWN') tokenSymbol = 'AVAX'
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(feedAddress)) {
    return NextResponse.json({ error: 'Invalid feed_address — must be a 40-hex EVM address' }, { status: 400 })
  }

  const startMs = Date.now()
  const result = await readChainlinkFeed(feedAddress, tokenSymbol)

  return NextResponse.json({
    result,
    meta: {
      agent:     'wasi-chainlink-price',
      latency_ms: Date.now() - startMs,
      powered_by: 'chainlink-on-chain',
    },
  })
}

export async function GET() {
  return NextResponse.json({
    schema: 'wasiai/agent-spec/v1',
    slug:   'wasi-chainlink-price',
    name:   'Chainlink Price Feed Reader',
    input: {
      type: 'object',
      properties: {
        feed_address:  { type: 'string', description: 'Chainlink AggregatorV3 address' },
        token_symbol:  { type: 'string', description: 'Human-readable token symbol' },
      },
      example: { feed_address: '0x5498BB86BC934c8D34FDA08E81D444153d0D06aD', token_symbol: 'AVAX' },
    },
  })
}
```

---

### 5.7 `src/app/api/v1/agents-internal/wasi-onchain-analyzer/route.ts`

```typescript
/**
 * Agent 2 — On-Chain Token Analyzer
 *
 * POST /api/v1/agents-internal/wasi-onchain-analyzer
 * Body: { input: string } where input = JSON { token_address }
 *   OR  { token_address: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { analyzeOnChain } from '@/lib/defi-risk/onchain'

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  let tokenAddress: string
  if (typeof body.input === 'string') {
    try {
      const parsed = JSON.parse(body.input) as Record<string, string>
      tokenAddress = parsed.token_address?.trim() ?? body.input.trim()
    } catch {
      tokenAddress = body.input.trim()
    }
  } else {
    tokenAddress = String(body.token_address ?? body.tokenAddress ?? '').trim()
  }

  if (!tokenAddress || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) {
    return NextResponse.json({ error: 'Valid token_address (0x...) required' }, { status: 400 })
  }

  const startMs = Date.now()
  const result = await analyzeOnChain(tokenAddress)

  return NextResponse.json({
    result,
    meta: { agent: 'wasi-onchain-analyzer', latency_ms: Date.now() - startMs, powered_by: 'avalanche-rpc' },
  })
}

export async function GET() {
  return NextResponse.json({
    schema: 'wasiai/agent-spec/v1',
    slug:   'wasi-onchain-analyzer',
    input: {
      example: { token_address: '0x5498BB86BC934c8D34FDA08E81D444153d0D06aD' },
    },
  })
}
```

---

### 5.8 `src/app/api/v1/agents-internal/wasi-contract-auditor/route.ts`

```typescript
/**
 * Agent 3 — Smart Contract Auditor (Groq/Llama fallback — Kite AI unavailable)
 *
 * POST /api/v1/agents-internal/wasi-contract-auditor
 * Body: { token_address, contract_source? } or { input: string (JSON) }
 */
import { NextRequest, NextResponse } from 'next/server'
import { auditContract } from '@/lib/defi-risk/auditor'

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  let tokenAddress: string
  let contractSource: string | undefined

  if (typeof body.input === 'string') {
    try {
      const parsed = JSON.parse(body.input) as Record<string, string>
      tokenAddress   = parsed.token_address?.trim() ?? ''
      contractSource = parsed.contract_source
    } catch {
      tokenAddress = body.input.trim()
    }
  } else {
    tokenAddress   = String(body.token_address ?? body.tokenAddress ?? '').trim()
    contractSource = typeof body.contract_source === 'string' ? body.contract_source : undefined
  }

  if (!tokenAddress || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) {
    return NextResponse.json({ error: 'Valid token_address required' }, { status: 400 })
  }

  const startMs = Date.now()
  const result  = await auditContract(tokenAddress, contractSource)

  return NextResponse.json({
    result,
    meta: {
      agent:      'wasi-contract-auditor',
      latency_ms: Date.now() - startMs,
      powered_by: 'groq-llama',
      note:       'Kite AI API not available as of 2026-02-28. Using Groq/llama-3.3-70b-versatile.',
    },
  })
}

export async function GET() {
  return NextResponse.json({
    schema: 'wasiai/agent-spec/v1',
    slug:   'wasi-contract-auditor',
    input: {
      example: { token_address: '0x5498BB86BC934c8D34FDA08E81D444153d0D06aD', contract_source: 'optional ABI or Solidity source' },
    },
  })
}
```

---

### 5.9 `src/app/api/v1/agents-internal/wasi-defi-sentiment/route.ts`

```typescript
/**
 * Agent 4 — DeFi Sentiment Analyzer
 *
 * POST /api/v1/agents-internal/wasi-defi-sentiment
 * Body: { token_name, token_symbol, description? } or { input: string (JSON) }
 */
import { NextRequest, NextResponse } from 'next/server'
import { analyzeSentiment } from '@/lib/defi-risk/sentiment'

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  let tokenName: string
  let tokenSymbol: string
  let description: string | undefined

  if (typeof body.input === 'string') {
    try {
      const parsed = JSON.parse(body.input) as Record<string, string>
      tokenName   = parsed.token_name?.trim()   ?? ''
      tokenSymbol = parsed.token_symbol?.trim() ?? ''
      description = parsed.description
    } catch {
      tokenName   = body.input.trim()
      tokenSymbol = ''
    }
  } else {
    tokenName   = String(body.token_name   ?? body.tokenName   ?? '').trim()
    tokenSymbol = String(body.token_symbol ?? body.tokenSymbol ?? '').trim()
    description = typeof body.description === 'string' ? body.description : undefined
  }

  if (!tokenName) {
    return NextResponse.json({ error: 'token_name required' }, { status: 400 })
  }

  const startMs = Date.now()
  const result  = await analyzeSentiment(tokenName, tokenSymbol, description)

  return NextResponse.json({
    result,
    meta: { agent: 'wasi-defi-sentiment', latency_ms: Date.now() - startMs, powered_by: 'groq-llama' },
  })
}

export async function GET() {
  return NextResponse.json({
    schema: 'wasiai/agent-spec/v1',
    slug:   'wasi-defi-sentiment',
    input: {
      example: { token_name: 'SafeMoonElonGem', token_symbol: 'SMEG', description: '100x guaranteed returns!' },
    },
  })
}
```

---

### 5.10 `src/app/api/v1/agents-internal/wasi-risk-report/route.ts`

```typescript
/**
 * Agent 5 — DeFi Risk Report Generator
 * Orchestrates Agents 1-4 via shared lib (in-process, no HTTP calls)
 *
 * POST /api/v1/agents-internal/wasi-risk-report
 * Body: {
 *   token_address: string          (required)
 *   feed_address?:  string         (Chainlink feed; defaults to AVAX/USD)
 *   token_name?:    string         (fallback: read from on-chain)
 *   token_symbol?:  string         (fallback: read from on-chain)
 *   description?:   string
 * }
 */
import { NextRequest, NextResponse } from 'next/server'
import { readChainlinkFeed }  from '@/lib/defi-risk/chainlink'
import { analyzeOnChain }     from '@/lib/defi-risk/onchain'
import { auditContract }      from '@/lib/defi-risk/auditor'
import { analyzeSentiment }   from '@/lib/defi-risk/sentiment'
import { computeRiskScore, generateSummary } from '@/lib/defi-risk/riskScorer'
import type { RiskReport }    from '@/lib/defi-risk/types'

const DEFAULT_FEED = (process.env.CHAINLINK_AVAX_USD_FEED ?? '').trim()

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Parse input (gateway wraps in { input: "..." } or direct object)
  let params: Record<string, string | undefined>
  if (typeof body.input === 'string') {
    try { params = JSON.parse(body.input) } catch { params = { token_address: body.input } }
  } else {
    params = body as Record<string, string | undefined>
  }

  const tokenAddress = String(params.token_address ?? '').trim()
  if (!tokenAddress || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) {
    return NextResponse.json({ error: 'Valid token_address required' }, { status: 400 })
  }

  const feedAddress  = String(params.feed_address  ?? DEFAULT_FEED ?? '').trim()
  const inputName    = String(params.token_name    ?? '').trim()
  const inputSymbol  = String(params.token_symbol  ?? '').trim()
  const description  = String(params.description   ?? '').trim() || undefined

  const startMs = Date.now()

  // ── Run Agents 1 + 2 in parallel (both are on-chain reads, independent) ──
  const [chainlinkResult, onchainResult] = await Promise.all([
    feedAddress
      ? readChainlinkFeed(feedAddress, inputSymbol || 'TOKEN')
      : Promise.resolve(null),
    analyzeOnChain(tokenAddress),
  ])

  // Resolve name/symbol from on-chain if not provided
  const tokenName   = inputName   || onchainResult.name   || tokenAddress.slice(0, 10) + '...'
  const tokenSymbol = inputSymbol || onchainResult.symbol || '???'

  // ── Run Agents 3 + 4 in parallel (both use Groq, independent) ────────────
  const [auditResult, sentimentResult] = await Promise.all([
    auditContract(tokenAddress),
    analyzeSentiment(tokenName, tokenSymbol, description),
  ])

  // ── Agent 5: Score + Report ───────────────────────────────────────────────
  const riskScore = computeRiskScore(chainlinkResult, onchainResult, auditResult, sentimentResult)
  const summary   = generateSummary(tokenAddress, riskScore, chainlinkResult, onchainResult, auditResult, sentimentResult)

  const report: RiskReport = {
    token_address: tokenAddress,
    generated_at:  new Date().toISOString(),
    risk_score:    riskScore,
    agents: {
      chainlink:  chainlinkResult,
      onchain:    onchainResult,
      audit:      auditResult,
      sentiment:  sentimentResult,
    },
    summary,
    disclaimer: 'This report is generated by AI agents and on-chain data. It is not financial advice. Always DYOR.',
  }

  return NextResponse.json({
    result: report,
    meta: {
      agent:      'wasi-risk-report',
      latency_ms: Date.now() - startMs,
      powered_by: 'chainlink+avalanche-rpc+groq',
    },
  })
}

export async function GET() {
  return NextResponse.json({
    schema: 'wasiai/agent-spec/v1',
    slug:   'wasi-risk-report',
    name:   'DeFi Risk Report Generator',
    input: {
      example: {
        token_address: '0x5425890298aed601595a70AB815c96711a31BC65',
        feed_address:  '0x5498BB86BC934c8D34FDA08E81D444153d0D06aD',
        token_name:    'USD Coin',
        token_symbol:  'USDC',
      },
    },
  })
}
```

---

## 6. Fórmula de Scoring — Documentación Formal

### Componentes, pesos y mapeo

```
RISK SCORE FINAL = Σ (score_componente × peso) + penalizaciones_flags
                   capped en 100, redondeado a entero

Componentes:
  Audit Score      (peso 35%) → basado en el hallazgo de mayor severidad
  Concentration    (peso 25%) → concentración del top-10 holders
  Volatility       (peso 25%) → volatilidad de precio en 7 días
  Sentiment        (peso 15%) → análisis LLM de nombre/descripción

Penalizaciones de flags (suma directa al score):
  Contrato < 7 días de antigüedad  → +10 puntos
  Función mint() activa en bytecode → +5 puntos
  Es proxy sin verificar            → +5 puntos

Ratings:
  0  – 30  → SAFE    ✅
  31 – 65  → CAUTION ⚠️
  66 – 100 → AVOID   🚫
```

### Tabla de mapeo por componente

| Componente | Condición | Score |
|---|---|---|
| **Audit** | Finding CRITICAL | 100 |
| | Finding HIGH | 75 |
| | Finding MEDIUM | 45 |
| | Finding LOW | 20 |
| | Solo INFO | 5 |
| | Sin hallazgos | 0 |
| **Concentration** | Top-10 ≥ 90% | 100 |
| | Top-10 75-89% | 80 |
| | Top-10 60-74% | 60 |
| | Top-10 40-59% | 35 |
| | Top-10 < 40% | 10 |
| | Sin datos | 50 (penalización neutral) |
| **Volatility** | ≥ 80% en 7d | 100 |
| | 50-79% | 75 |
| | 25-49% | 50 |
| | 10-24% | 25 |
| | < 10% | 5 |
| | Sin datos | 50 |
| **Sentiment** | Directo de Agent 4 | 0-100 |
| | Sin datos | 50 |

### Ejemplo calculado

```
Token "SafeMoonElonGem" (SMEG):
  Audit:         HIGH finding → 75 × 0.35 = 26.25
  Concentration: Top-10 = 85% → 80 × 0.25 = 20.00
  Volatility:    7d vol = 65% → 75 × 0.25 = 18.75
  Sentiment:     Score = 90   → 90 × 0.15 = 13.50
  Subtotal = 78.50
  Flags: mint activo (+5), contrato < 7 días (+10) = +15
  TOTAL = 93.50 → capped = 93 → AVOID 🚫
```

---

## 7. Implementation Readiness Check

| Criterio | Estado | Detalle |
|---|---|---|
| ¿Dependencias disponibles? | ✅ | `viem`, `groq` ya instaladas. No deps nuevas. |
| ¿Variables de entorno definidas? | ✅ | `CHAINLINK_AVAX_USD_FEED`, `AVALANCHE_FUJI_RPC`, `GROQ_API_KEY` (existe), `SNOWTRACE_API_KEY` (opcional) |
| ¿Kite AI disponible? | ❌ | No disponible. Fallback Groq documentado y aprobado en HU. |
| ¿Schema DB requiere migration nueva? | ✅ | `017_defi_risk_agents.sql` — solo INSERTs, sin ALTER TABLE |
| ¿Patrón de agente replicable desde demo? | ✅ | Patrón idéntico a `demo/agents` — POST endpoint + callGroq |
| ¿Chainlink feed verificado en Fuji? | ✅ | `0x5498BB86BC934c8D34FDA08E81D444153d0D06aD` (AVAX/USD, oficial) |
| ¿Sin ethers.js? | ✅ | Solo viem v2 en todo el código |
| ¿Sin hardcodes? | ✅ | Direcciones y URLs desde env vars. Migration usa placeholder. |
| ¿SSRF risk? | ✅ | Agentes internos no aceptan URLs de usuario. Sin riesgo SSRF. |
| ¿RLS necesaria? | N/A | Solo se agregan filas a `agents` (lectura pública). Sin datos de usuario en estas rutas. |
| ¿ACs verificables? | ✅ | Cada AC del S0 mapea a código concreto en este SDD. |
| ¿Implementable sin ambigüedades? | ✅ | Código completo incluido. Dev puede implementar directo del SDD. |

---

## 8. Definition of Done (Verificable)

- [ ] **Migration 017** aplicada en Supabase — 5 agentes en tabla `agents` con `status: active`
- [ ] **Variables de entorno** `CHAINLINK_AVAX_USD_FEED`, `AVALANCHE_FUJI_RPC`, `SNOWTRACE_BASE_URL` seteadas en Vercel
- [ ] **Archivos creados:** `src/lib/defi-risk/{types,chainlink,onchain,auditor,sentiment,riskScorer}.ts`
- [ ] **Endpoints creados:** 5 routes en `src/app/api/v1/agents-internal/*/route.ts`
- [ ] **`npm run build` pasa** con 0 errores TypeScript
- [ ] **Agent 1** retorna precio AVAX/USD real con ≥ 5 puntos históricos en Fuji
- [ ] **Agent 2** retorna holder count, concentration, age y flags para USDC Fuji (`0x5425...`)
- [ ] **Agent 3** retorna findings[] con al menos 1 hallazgo INFO o superior para cualquier token
- [ ] **Agent 4** retorna sentiment_score entre 0-100 y analysis no vacío
- [ ] **Agent 5 (Risk Report)** completa en < 60 segundos para USDC Fuji
- [ ] **Score determinístico**: ±3 puntos máximo en 3 ejecuciones consecutivas para el mismo input
- [ ] **Ratings correctos**: SAFE ≤ 30, CAUTION 31-65, AVOID ≥ 66
- [ ] **Test con token limpio** (USDC Fuji) → rating SAFE o CAUTION
- [ ] **Test con honeypot simulado** (token con mint + concentración 95%) → rating AVOID
- [ ] **Marketplace visible**: los 5 agentes aparecen en `/marketplace` con categoría `defi-risk`
- [ ] **Kite AI deuda técnica** documentada como issue en Linear (para activar cuando API esté disponible)

---

## 9. Deuda Técnica Documentada

| Item | Descripción | Prioridad |
|---|---|---|
| **DT-001: Kite AI** | Cuando Kite AI lance API pública, reemplazar `auditor.ts` Groq por Kite AI inference. El código está aislado en `lib/defi-risk/auditor.ts` — cambio de 1 archivo. | P2 — post hackathon |
| **DT-002: Feeds registry** | Actualmente solo AVAX/USD disponible como default. Crear un registro de feeds (DB o env JSON) para mapear `token_address → feed_address` de forma dinámica. | P2 |
| **DT-003: Holder data real** | Snowtrace free API retorna máx 100 holders. Para tokens con 100k+ holders, holderCount será impreciso. Solución: indexer propio o API paga. | P3 |
| **DT-004: Cache** | Agent 2 y 3 son costosos (RPC + LLM). Agregar Redis cache (Upstash, TTL 5min) para mismo token_address. | P2 |
| **DT-005: Mainnet feeds** | Al pasar a Mainnet, actualizar registry con feeds oficiales de Chainlink Mainnet. | P1 — al activar E6 |

---

*Generado por S1 (Architect — San) — 2026-02-28*  
*Próximo paso: SPEC_APPROVED de Fer → SM genera story-HU-7.6.md*
