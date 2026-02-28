# Story File — HU-7.6: DeFi Risk Intelligence Pipeline
> **Agente:** SM (Scrum Master)  
> **Generado:** 2026-02-28  
> **Estado:** LISTO PARA DEV  
> **Metodología:** BMAD v6 — WasiAI  
> **Gates completados:** HU_APPROVED ✅ · SPEC_APPROVED ✅

---

## ⚠️ INSTRUCCIONES PARA EL DEV

Este archivo es autocontenido. **NO necesitas leer ningún otro documento.**

Todo el código está aquí. Copias el código, creas los archivos, corres los tests. Eso es todo.

**Orden de implementación obligatorio:**
1. `lib/defi-risk/` — tipos y lógica compartida
2. Endpoints `agents-internal/` — 5 rutas
3. Migration DB — registro de agentes en marketplace
4. Tests

---

## Historia de Usuario

**Como** equipo I+D de WasiAI,  
**quiero** crear y publicar en el marketplace 5 agentes especializados que, en pipeline, analicen el riesgo de cualquier token en Avalanche usando Chainlink Data Feeds y LLM (Groq),  
**para** demostrar en el hackathon Avalanche Build Games (Semana 3) que WasiAI puede orquestar agentes reales con datos on-chain y entregar inteligencia de riesgo DeFi accionable.

### Contexto crítico

- **Kite AI NO está disponible** (verificado 2026-02-28: todos sus dominios caídos/crasheados)
- **Agent 3 usa Groq `llama-3.3-70b-versatile`** — esta es la decisión final aprobada por Fer
- **Kite AI es deuda técnica DT-001** — cuando lancen API se reemplaza solo `auditor.ts`
- Los 5 agentes son **callables individualmente** via x402 + registrados en el marketplace
- Orquestación vía `/compose` es **HU-5.1 separada** — fuera de scope aquí

---

## Flujo del Pipeline

```
Input: token_address (ERC-20 en Avalanche Fuji)
        ↓
Agent 1 — Chainlink Price Feed Reader
  → Lee AggregatorV3Interface on-chain (viem v2)
  → Output: { price_usd, history[7], volatility_7d_pct }
        ↓
Agent 2 — On-Chain Token Analyzer
  → Holders, concentración top-10, age contrato, flags de riesgo
  → Output: { holder_count, top10_concentration_pct, contract_age_days, flags }
        ↓
Agent 3 — Smart Contract Auditor (Groq llama-3.3-70b-versatile)
  → Analiza patrones rug pull, honeypot, permisos peligrosos
  → Output: { findings[], severity, summary }
        ↓
Agent 4 — DeFi Sentiment Analyzer (Groq llama-3.3-70b-versatile)
  → Analiza nombre, símbolo, descripción para red flags textuales
  → Output: { sentiment_score, flags[], analysis }
        ↓
Agent 5 — Risk Report Generator
  → Agrega outputs 1-4 con fórmula documentada
  → Output: { risk_score: 0-100, rating: SAFE/CAUTION/AVOID, report completo }
```

---

## Acceptance Criteria (Verificables)

### AC-1: 5 agentes registrados en DB
- [ ] Los 5 agentes existen en tabla `agents` con `status: 'active'`, `category: 'defi-risk'`
- [ ] Son visibles en `/marketplace` con categoría `DeFi Risk`
- [ ] Cada uno tiene `fee_usdc` definido (ver valores en migration)
- [ ] **Cómo verificar:** `SELECT slug, status, price_per_call FROM agents WHERE category = 'defi-risk'` → 5 filas

### AC-2: Agent 1 — Chainlink Price Feed Reader funciona on-chain
- [ ] Dado feed_address de AVAX/USD en Fuji (`0x5498BB86BC934c8D34FDA08E81D444153d0D06aD`), retorna `price_usd > 0`
- [ ] Retorna al menos 5 puntos en `history[]`
- [ ] `volatility_7d_pct` es un número >= 0
- [ ] Si feed_address inválido, retorna `error` descriptivo (no 500)
- [ ] **Cómo verificar:** `POST /api/v1/agents-internal/wasi-chainlink-price` con body `{ feed_address: "0x5498BB86BC934c8D34FDA08E81D444153d0D06aD", token_symbol: "AVAX" }`

### AC-3: Agent 2 — On-Chain Analyzer retorna data real
- [ ] Para USDC Fuji (`0x5425890298aed601595a70AB815c96711a31BC65`) retorna `name: "USD Coin"`, `symbol: "USDC"`
- [ ] `contract_age_days >= 0`
- [ ] Al menos uno de: `holder_count`, `top10_concentration_pct` tiene valor (no null)
- [ ] `flags` object presente con `has_mint_function`, `owner_renounced`, `is_paused`, `is_proxy`
- [ ] Tiempo de respuesta < 10 segundos
- [ ] **Cómo verificar:** `POST /api/v1/agents-internal/wasi-onchain-analyzer` con `{ token_address: "0x5425890298aed601595a70AB815c96711a31BC65" }`

### AC-4: Agent 3 — Contract Auditor conecta a Groq y retorna findings
- [ ] Para cualquier token address retorna `findings[]` (puede ser vacío si el contrato es limpio)
- [ ] `powered_by: "groq-llama"` en el resultado
- [ ] `summary` no vacío
- [ ] Si Groq falla, retorna `error` descriptivo (no 500)
- [ ] **Cómo verificar:** `POST /api/v1/agents-internal/wasi-contract-auditor` con `{ token_address: "0x5425..." }`

### AC-5: Agent 5 — Risk Score determinístico y justificado
- [ ] `risk_score.total` es entero entre 0 y 100
- [ ] `risk_score.rating` es exactamente `"SAFE"`, `"CAUTION"` o `"AVOID"`
- [ ] `risk_score.breakdown` contiene los 4 componentes con `score`, `weight`, `contribution`
- [ ] El mismo input en 3 ejecuciones consecutivas varía <= 3 puntos
- [ ] Rating maps correctos: ≤30 → SAFE, 31-65 → CAUTION, ≥66 → AVOID
- [ ] **Cómo verificar:** 3 llamadas a `wasi-risk-report` con mismo token y comparar `risk_score.total`

### AC-6: Pipeline completo end-to-end en Fuji
- [ ] Para USDC Fuji: reporte completo en < 60 segundos
- [ ] `report.summary` es string no vacío con precio y rating
- [ ] `report.disclaimer` presente
- [ ] `report.generated_at` es ISO timestamp válido
- [ ] `report.agents` contiene resultados de los 4 sub-agentes
- [ ] **Cómo verificar:** `POST /api/v1/agents-internal/wasi-risk-report` con `{ token_address: "0x5425...", feed_address: "0x5498..." }`

### AC-7: Tests mínimos pasan en CI
- [ ] Existe al menos 1 test por agente (puede ser smoke test)
- [ ] `npm run build` pasa con 0 errores TypeScript
- [ ] **Cómo verificar:** `npm run build && npm run test`

### AC-8: Deuda técnica documentada
- [ ] Kite AI registrado como issue en Linear con label `tech-debt`, descripción de cómo activar cuando API esté disponible
- [ ] **Cómo verificar:** Issue existe en Linear con referencia a `DT-001`

---

## Variables de Entorno Necesarias

Agregar a `.env.local` y a Vercel:

```env
# Ya existe en el proyecto (reutilizar):
GROQ_API_KEY=...

# Nuevas — agregar:
CHAINLINK_AVAX_USD_FEED=0x5498BB86BC934c8D34FDA08E81D444153d0D06aD
AVALANCHE_FUJI_RPC=https://avalanche-fuji-c-chain-rpc.publicnode.com
SNOWTRACE_BASE_URL=https://api-testnet.snowtrace.io
SNOWTRACE_API_KEY=                    # Opcional. Sin key funciona (rate limitado).
```

---

## Estructura de Archivos a Crear

```
src/
├── lib/
│   └── defi-risk/
│       ├── types.ts           ← PASO 1
│       ├── chainlink.ts       ← PASO 2 (Agent 1)
│       ├── onchain.ts         ← PASO 3 (Agent 2)
│       ├── auditor.ts         ← PASO 4 (Agent 3)
│       ├── sentiment.ts       ← PASO 5 (Agent 4)
│       └── riskScorer.ts      ← PASO 6 (Agent 5)
└── app/
    └── api/
        └── v1/
            └── agents-internal/
                ├── wasi-chainlink-price/route.ts    ← PASO 7
                ├── wasi-onchain-analyzer/route.ts   ← PASO 8
                ├── wasi-contract-auditor/route.ts   ← PASO 9
                ├── wasi-defi-sentiment/route.ts     ← PASO 10
                └── wasi-risk-report/route.ts        ← PASO 11

supabase/migrations/017_defi_risk_agents.sql         ← PASO 12
```

---

## PASO 1: `src/lib/defi-risk/types.ts`

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

## PASO 2: `src/lib/defi-risk/chainlink.ts`

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

## PASO 3: `src/lib/defi-risk/onchain.ts`

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

## PASO 4: `src/lib/defi-risk/auditor.ts`

> ⚠️ **NOTA IMPORTANTE:** Agent 3 usa **Groq `llama-3.3-70b-versatile`** — NO Kite AI.  
> Kite AI verificado como no disponible (2026-02-28). Decisión aprobada por Fer.  
> Ver DT-001 para reactivación futura.

```typescript
/**
 * Agent 3 — Smart Contract Auditor
 * KITE AI STATUS: NOT AVAILABLE (verified 2026-02-28)
 * Fallback: Groq llama-3.3-70b-versatile with specialized audit prompt
 * 
 * Technical debt DT-001: integrate Kite AI when API becomes available.
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

## PASO 5: `src/lib/defi-risk/sentiment.ts`

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

## PASO 6: `src/lib/defi-risk/riskScorer.ts`

### Fórmula de Scoring — Documentada Formalmente

```
RISK SCORE FINAL = Σ (score_componente × peso) + penalizaciones_flags
                   capped en 100, redondeado a entero

Componentes y pesos:
  Audit Score      (peso 35%) → basado en el hallazgo de mayor severidad
  Concentration    (peso 25%) → concentración del top-10 holders
  Volatility       (peso 25%) → volatilidad de precio en 7 días  
  Sentiment        (peso 15%) → análisis LLM de nombre/descripción

Penalizaciones de flags (suma directa al score):
  Contrato < 7 días de antigüedad   → +10 puntos
  Función mint() activa en bytecode  → +5 puntos
  Es proxy sin verificar             → +5 puntos

Mapeo por componente:
  AUDIT:         CRITICAL→100, HIGH→75, MEDIUM→45, LOW→20, INFO→5, sin findings→0
  CONCENTRATION: ≥90%→100, 75-89%→80, 60-74%→60, 40-59%→35, <40%→10, N/A→50
  VOLATILITY:    ≥80%→100, 50-79%→75, 25-49%→50, 10-24%→25, <10%→5, N/A→50
  SENTIMENT:     Score directo del LLM (0-100), N/A→50

Ratings:
  0  – 30  → SAFE    ✅
  31 – 65  → CAUTION ⚠️
  66 – 100 → AVOID   🚫

Ejemplo calculado (token "SafeMoonElonGem"):
  Audit:         HIGH finding → 75 × 0.35 = 26.25
  Concentration: Top-10 = 85% → 80 × 0.25 = 20.00
  Volatility:    7d vol = 65% → 75 × 0.25 = 18.75
  Sentiment:     Score = 90   → 90 × 0.15 = 13.50
  Subtotal = 78.50
  Flags: mint activo (+5) + contrato < 7 días (+10) = +15
  TOTAL = 93.50 → capped = 93 → AVOID 🚫
```

```typescript
/**
 * Agent 5 — Risk Scorer
 * Documented formula for aggregating 4 agent outputs into a 0-100 risk score.
 *
 * ══════════════════════════════════════════════════════════════
 * RISK SCORING FORMULA v1.0 (HU-7.6)
 * ══════════════════════════════════════════════════════════════
 *
 * FINAL SCORE = Σ (component_score × weight) + flag_penalties (capped at 100)
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
 * AUDIT SCORE:         CRITICAL→100, HIGH→75, MEDIUM→45, LOW→20, INFO→5, none→0
 * CONCENTRATION SCORE: ≥90%→100, 75-89%→80, 60-74%→60, 40-59%→35, <40%→10, N/A→50
 * VOLATILITY SCORE:    ≥80%→100, 50-79%→75, 25-49%→50, 10-24%→25, <10%→5, N/A→50
 * SENTIMENT SCORE:     Direct from Agent 4 (0-100), N/A→50
 *
 * FLAG PENALTIES:      age<7d→+10, mint_active→+5, is_proxy→+5
 *
 * RATINGS:             0-30→SAFE, 31-65→CAUTION, 66-100→AVOID
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

## PASO 7: `src/app/api/v1/agents-internal/wasi-chainlink-price/route.ts`

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

## PASO 8: `src/app/api/v1/agents-internal/wasi-onchain-analyzer/route.ts`

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

## PASO 9: `src/app/api/v1/agents-internal/wasi-contract-auditor/route.ts`

```typescript
/**
 * Agent 3 — Smart Contract Auditor (Groq/llama-3.3-70b-versatile)
 * NOTE: Kite AI unavailable as of 2026-02-28. Using Groq as permanent fallback.
 *       See DT-001 for reactivation when Kite AI launches public API.
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

## PASO 10: `src/app/api/v1/agents-internal/wasi-defi-sentiment/route.ts`

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

## PASO 11: `src/app/api/v1/agents-internal/wasi-risk-report/route.ts`

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

## PASO 12: `supabase/migrations/017_defi_risk_agents.sql`

```sql
-- Migration 017: DeFi Risk Intelligence Agents (HU-7.6)
-- Registra los 5 agentes oficiales de WasiAI en el marketplace
-- Idempotente: ON CONFLICT DO UPDATE — safe to re-run

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
  'Audita contratos EVM buscando patrones de rug pull, honeypot, permisos peligrosos y vulnerabilidades. Powered by Groq LLM (llama-3.3-70b-versatile). Input: { token_address, contract_source? }',
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
  status       = EXCLUDED.status,
  endpoint_url = EXCLUDED.endpoint_url,
  description  = EXCLUDED.description,
  price_per_call = EXCLUDED.price_per_call;

-- NOTA POST-MIGRATION: Actualizar endpoint_url reemplazando SITE_URL_PLACEHOLDER
-- con process.env.NEXT_PUBLIC_SITE_URL en el script de deploy o vía Supabase Management API.
-- Ejemplo:
--   UPDATE agents SET endpoint_url = REPLACE(endpoint_url, 'SITE_URL_PLACEHOLDER', 'https://wasiai-v2.vercel.app')
--   WHERE category = 'defi-risk';
```

---

## Tests Mínimos Requeridos

Crear en `src/lib/defi-risk/__tests__/` o junto a cada archivo como `*.test.ts`:

### Smoke tests mínimos (1 por agente)

```typescript
// src/lib/defi-risk/__tests__/smoke.test.ts
import { describe, it, expect } from 'vitest'
import { computeRiskScore } from '../riskScorer'
import type { AuditResult, OnChainResult, ChainlinkResult, SentimentResult } from '../types'

describe('riskScorer — unit tests (no external calls)', () => {

  it('AVOID: token con CRITICAL finding', () => {
    const audit: AuditResult = {
      token_address: '0x0000',
      findings: [{ severity: 'CRITICAL', title: 'Rug pull', description: 'drainable' }],
      summary: 'Dangerous',
      powered_by: 'groq-llama',
    }
    const score = computeRiskScore(null, null, audit, null)
    expect(score.total).toBeGreaterThanOrEqual(66)
    expect(score.rating).toBe('AVOID')
  })

  it('SAFE: token limpio, baja concentración, baja volatilidad', () => {
    const chainlink: ChainlinkResult = {
      feed_address: '0x1234567890123456789012345678901234567890',
      token_symbol: 'TEST',
      price_usd: 1.0,
      timestamp: Date.now() / 1000,
      round_id: '1',
      history: [],
      volatility_7d_pct: 5,  // bajo
    }
    const onchain: OnChainResult = {
      token_address: '0x1234567890123456789012345678901234567890',
      name: 'Clean Token',
      symbol: 'CLN',
      total_supply: '1000000',
      decimals: 18,
      contract_age_days: 365,
      holder_count: 5000,
      top10_concentration_pct: 25,  // bajo
      flags: { has_mint_function: false, owner_renounced: true, is_paused: false, is_proxy: false, bytecode_size_bytes: 1000 },
    }
    const sentiment: SentimentResult = {
      token_name: 'Clean Token',
      token_symbol: 'CLN',
      sentiment_score: 5,  // muy limpio
      flags: [],
      analysis: 'Appears legitimate',
    }
    const score = computeRiskScore(chainlink, onchain, null, sentiment)
    expect(score.total).toBeLessThanOrEqual(30)
    expect(score.rating).toBe('SAFE')
  })

  it('CAUTION: datos neutros sin findings', () => {
    const score = computeRiskScore(null, null, null, null)
    // All components return 50 (neutral)
    // 50*0.35 + 50*0.25 + 50*0.25 + 50*0.15 = 50
    expect(score.total).toBe(50)
    expect(score.rating).toBe('CAUTION')
  })

  it('rating thresholds correctos', () => {
    // Test boundary values
    const makeScore = (total: number) => {
      const rating = total <= 30 ? 'SAFE' : total <= 65 ? 'CAUTION' : 'AVOID'
      return rating
    }
    expect(makeScore(0)).toBe('SAFE')
    expect(makeScore(30)).toBe('SAFE')
    expect(makeScore(31)).toBe('CAUTION')
    expect(makeScore(65)).toBe('CAUTION')
    expect(makeScore(66)).toBe('AVOID')
    expect(makeScore(100)).toBe('AVOID')
  })

  it('breakdown contiene los 4 componentes', () => {
    const score = computeRiskScore(null, null, null, null)
    expect(score.breakdown).toHaveProperty('volatility')
    expect(score.breakdown).toHaveProperty('concentration')
    expect(score.breakdown).toHaveProperty('audit')
    expect(score.breakdown).toHaveProperty('sentiment')
    expect(score.breakdown.audit.weight).toBe(0.35)
    expect(score.breakdown.volatility.weight).toBe(0.25)
  })

})
```

---

## Definition of Done — Checklist Completo

### Infrastructure
- [ ] Variables de entorno seteadas en `.env.local` y Vercel Dashboard
- [ ] `CHAINLINK_AVAX_USD_FEED`, `AVALANCHE_FUJI_RPC`, `SNOWTRACE_BASE_URL` presentes
- [ ] `GROQ_API_KEY` verificado (ya existía, confirmar que sigue activo)

### Código
- [ ] `src/lib/defi-risk/types.ts` creado
- [ ] `src/lib/defi-risk/chainlink.ts` creado
- [ ] `src/lib/defi-risk/onchain.ts` creado
- [ ] `src/lib/defi-risk/auditor.ts` creado (con nota Kite AI DT-001)
- [ ] `src/lib/defi-risk/sentiment.ts` creado
- [ ] `src/lib/defi-risk/riskScorer.ts` creado
- [ ] `src/app/api/v1/agents-internal/wasi-chainlink-price/route.ts` creado
- [ ] `src/app/api/v1/agents-internal/wasi-onchain-analyzer/route.ts` creado
- [ ] `src/app/api/v1/agents-internal/wasi-contract-auditor/route.ts` creado
- [ ] `src/app/api/v1/agents-internal/wasi-defi-sentiment/route.ts` creado
- [ ] `src/app/api/v1/agents-internal/wasi-risk-report/route.ts` creado

### Build y Tests
- [ ] `npm run build` → 0 errores TypeScript
- [ ] Tests unitarios de `riskScorer` pasan (los 4 del smoke test)
- [ ] `npm run test` pasa en CI

### Database
- [ ] `supabase/migrations/017_defi_risk_agents.sql` creado y aplicado
- [ ] `endpoint_url` actualizado con URL real (no `SITE_URL_PLACEHOLDER`)
- [ ] Query de verificación: `SELECT slug, status, price_per_call FROM agents WHERE category = 'defi-risk'` → 5 filas

### Acceptance Criteria (re-verificar)
- [ ] AC-1: 5 agentes visibles en `/marketplace` con categoría `defi-risk`
- [ ] AC-2: Agent 1 retorna precio AVAX/USD real con historial
- [ ] AC-3: Agent 2 retorna data real de USDC Fuji (`0x5425...`) en < 10s
- [ ] AC-4: Agent 3 retorna `findings[]` y `powered_by: "groq-llama"`
- [ ] AC-5: Score determinístico (±3 pts en 3 runs), ratings correctos
- [ ] AC-6: Pipeline completo en < 60s con `summary` y `disclaimer` presentes
- [ ] AC-7: Tests y build pasan
- [ ] AC-8: Issue DT-001 Kite AI creado en Linear

### Pre-commit
- [ ] Adversarial Review completado (activar con: `Actúa como AR. Lee _bmad/core/tasks/review-adversarial-general.xml y revisa lib/defi-risk/ y agents-internal/wasi-*/route.ts`)
- [ ] Code Review completado

---

## Notas de Implementación

### Patrón `callGroq` — cómo lo usan los agentes existentes

Antes de implementar `auditor.ts` y `sentiment.ts`, buscar en el codebase cómo se llama Groq actualmente:

```bash
grep -r "callGroq\|groq" src/lib/agents/ --include="*.ts" | head -20
```

Si `callGroq` no existe con esa firma, adaptar al patrón que exista. El import `@/lib/agents/groq` puede variar — verificar el archivo real.

### viem `getPublicClient` — verificar configuración

```bash
grep -r "getPublicClient\|publicClient" src/lib/viem* --include="*.ts" | head -10
```

El cliente debe estar configurado para Fuji testnet con `AVALANCHE_FUJI_RPC`. Si el cliente existente solo soporta mainnet, crear un cliente específico para Fuji en `lib/viem-fuji.ts`.

### Patrón de endpoint interno — referencia

Ver cualquier agente en `src/app/api/v1/agents-internal/` o `demo/agents/` para el patrón exacto que usa el codebase. Los endpoints aquí siguen el mismo patrón.

### Deuda Técnica a documentar en Linear

**DT-001: Kite AI Integration**
- Label: `tech-debt`, `HU-7.6`
- Descripción: "Cuando Kite AI lance API pública, reemplazar `src/lib/defi-risk/auditor.ts` líneas de Groq por llamada a Kite AI inference. El código está aislado — cambio de 1 archivo, sin tocar el resto del pipeline."
- Prioridad: P2 (post-hackathon)

---

*Story file generado por SM (San) — 2026-02-28*  
*Gates: HU_APPROVED ✅ · SPEC_APPROVED ✅*  
*El Dev implementa SOLO desde este archivo.*
