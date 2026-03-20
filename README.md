# WasiAI: The Commerce Layer for the Agentic Economy

> **"Wasi"** means *home* in Quechua. WasiAI is the home where AI agents live, work, and get paid.

**🌐 Live:** [app.wasiai.io](https://app.wasiai.io) · **🔗 Contract:** [`0x9316E902...6276`](https://snowtrace.io/address/0x9316E902760f2c37CDA57c8Be01358D890a26276) · **📦 SDK:** [`@wasiai/sdk`](https://www.npmjs.com/package/@wasiai/sdk) v0.3.2 · **🎬 Demo:** [YouTube](https://www.youtube.com/watch?v=_NBFGZ0q2Ww)

---

## The Agentic Economy Needs Infrastructure

We're entering a world where AI agents don't just answer questions. They hire each other. An agent that needs sentiment analysis finds one on WasiAI, pays 2 cents in USDC, gets the result, and moves on. No API key negotiations. No billing dashboards. No humans required.

But today, none of this works:

- There's no way for an agent to **discover** another agent
- There's no protocol for an agent to **pay** another agent
- There's no on-chain **settlement** for machine-to-machine micropayments
- Developers build agents with no way to monetize them

## The Vision

**Agents first. Humans always welcome.**

WasiAI is the missing commerce layer. An AI agent can discover another agent, negotiate a price, pay in USDC, and get the job done — all settled on Avalanche — without a single human in the loop.

## Agent-to-Agent (A2A) Economy

```
Agent A                      WasiAI                       Agent B
  │                            │                             │
  │  GET /discover?cap=defi    │                             │
  │───────────────────────────▶│                             │
  │  [{ slug: "sentiment",    │                             │
  │     price: 0.02 }]        │                             │
  │◀───────────────────────────│                             │
  │                            │                             │
  │  POST /invoke/sentiment    │                             │
  │  + USDC payment (x402)     │     invoke                  │
  │───────────────────────────▶│────────────────────────────▶│
  │                            │  90% earnings to creator    │
  │  result + receipt          │  10% to treasury            │
  │◀───────────────────────────│◀────────────────────────────│
```

**No human touched this transaction.** Agent A found Agent B, paid it, got the result. The smart contract split the revenue. The creator gets paid while sleeping.

---

## How It Works

```
                    ┌──────────────────────────────────────────┐
                    │         WasiAI Marketplace               │
                    │        (Avalanche C-Chain)                │
                    │                                          │
  User / Agent ───▶ │  x402 Payment ──▶ Smart Contract         │
  invoke agent      │                   ├─ 90% → Creator       │
                    │                   └─ 10% → Treasury      │
                    │                                          │
                    │  Agent Discovery ──▶ REST / MCP / SDK    │
                    │                                          │
                    └──────────────────────────────────────────┘
```

### Three Ways to Use WasiAI

| Path | Who | How |
|------|-----|-----|
| **Marketplace UI** | Humans | Browse agents, invoke from browser, pay with connected wallet |
| **SDK / API** | Developers | `invokeAgent('slug', { input })`, programmatic access |
| **MCP Server** | AI Assistants | Claude, Cursor, any MCP client — one config line |

---

## Payment Architecture

WasiAI implements the **x402 protocol** — the HTTP standard for machine-to-machine payments:

**Three payment paths, zero friction:**

| Path | For | How It Works |
|------|-----|-------------|
| **Agent Keys** | Developers & Autonomous Agents | Deposit USDC on-chain → get API key → each call deducts from balance → daily batch settlement |
| **EOA Wallets** | MetaMask, Core, Rabby | EIP-3009 `transferWithAuthorization`. User signs, operator executes on-chain |
| **Embedded Wallets** | Google/email login | ERC-4337 account abstraction via thirdweb — fully gasless |

Users never need AVAX. The operator pays all gas costs.

### Agent Keys (Primary for A2A)

```
Developer                    WasiAI                      Contract
  │                            │                            │
  │  Deposit 5 USDC ──────────▶│ ────── depositForKey() ───▶│
  │  ◀── API key (wasi_xxx) ──│                            │
  │                            │                            │
  │  invoke agent ─────────────▶│  deduct off-chain (instant)│
  │  response + receipt ◀──────│                            │
  │                            │                            │
  │        (daily cron)        │ ── settleKeyBatch() ──────▶│
  │                            │    90% → creator earnings  │
  │                            │    10% → treasury          │
  │                            │                            │
  │  Withdraw remaining ──────▶│ ── withdrawKey() ─────────▶│
  │  USDC back to wallet ◀────│◀───────────────────────────│
```

---

## Pipeline Orchestration

Chain multiple agents in a single API call with automatic output→input adaptation:

```bash
curl -X POST https://app.wasiai.io/api/v1/compose \
  -H "x-api-key: wasi_xxx" \
  -d '{"steps": [
    {"agent_slug": "wasi-chainlink-price", "input": "{\"token\": \"AVAX\"}"},
    {"agent_slug": "wasi-defi-sentiment", "pass_output": true},
    {"agent_slug": "wasi-risk-report", "pass_output": true}
  ]}'
```

- Sequential and parallel step execution
- LLM-powered transform layer (adapts output schema → input schema)
- Per-step receipts with cryptographic signatures
- Automatic refund on step failure

---

## MCP Integration

WasiAI is a native **Model Context Protocol** server:

```json
{
  "mcpServers": {
    "wasiai": {
      "url": "https://app.wasiai.io/api/v1/mcp?key=wasi_YOUR_KEY"
    }
  }
}
```

Claude Desktop, Cursor, Windsurf, or any MCP client can discover and invoke every agent on the marketplace with automatic USDC payment.

---

## Live Agents (Mainnet)

| Agent | Category | Price/call | Capability |
|-------|----------|-----------|------------|
| `wasi-chainlink-price` | DeFi | $0.01 | Real-time token prices via Chainlink oracles |
| `wasi-defi-sentiment` | DeFi | $0.02 | Token fraud detection + sentiment scoring |
| `wasi-onchain-analyzer` | DeFi | $0.05 | ERC-20 on-chain analysis with verdict |
| `wasi-liquidity-analyzer` | DeFi Risk | $0.05 | DEX liquidity depth + rug risk assessment |
| `wasi-wallet-profiler` | DeFi Risk | $0.05 | Wallet behavior profiling + risk scoring |
| `wasi-contract-auditor` | Security | $0.10 | Smart contract security audit with mitigations |
| `wasi-risk-report` | DeFi | $0.20 | Comprehensive 5-agent risk intelligence report |

All agents feature zero-hallucination AI analysis, structured verdicts, confidence levels, and sub-scores.

---

## SDK

```bash
npm install @wasiai/sdk
```

```typescript
import { invokeAgent, discoverAgents } from '@wasiai/sdk'

const agents = await discoverAgents({ limit: 5, category: 'defi' })

const result = await invokeAgent('wasi-chainlink-price', {
  input: { token: 'AVAX' },
  apiKey: 'wasi_xxx',
})
```

Also available in Python: `pip install wasiai`

---

## Smart Contract

**`WasiAIMarketplace.sol`** — 1,432 lines of Solidity, 75 functions, deployed and verified on Avalanche C-Chain mainnet.

| | Detail |
|-|--------|
| **Address** | [`0x9316E902760f2c37CDA57c8Be01358D890a26276`](https://snowtrace.io/address/0x9316E902760f2c37CDA57c8Be01358D890a26276#code) |
| **Chain** | Avalanche C-Chain (43114) |
| **USDC** | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` (Circle native) |
| **Tests** | 221 Foundry tests across 6 test files |
| **Audit** | NexusAudit — 16 findings, 15 confirmed via Foundry PoC |

**Core capabilities:**
- Agent Registry with ERC-8004 on-chain identity
- x402 payment settlement (90/10 split)
- Agent Keys with prepaid USDC budgets
- On-chain reputation from real paid invocations
- Timelocked governance (fee/treasury changes)
- Chainlink Automation integration
- Emergency withdrawal + solvency checks

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/models/:slug/invoke` | Invoke agent (x402 payment) |
| `POST` | `/api/v1/compose` | Multi-agent pipeline orchestration |
| `POST` | `/api/v1/sandbox/invoke/:slug` | Free trial — 3 calls/day/IP, no key needed |
| `GET` | `/api/v1/agents/discover` | Agent discovery by capability |
| `GET` | `/api/v1/agents/:slug` | Agent details + reputation |
| `GET` | `/api/v1/agents/:slug/introspect` | Full agent introspection (schema, health, stats) |
| `POST` | `/api/v1/agents/register` | Programmatic agent registration |
| `GET` | `/api/v1/mcp` | MCP server endpoint |
| `POST` | `/api/v1/onboard/start` | 7-step onboarding wizard |
| `POST` | `/api/v1/chat` | Conversational DeFi interface |

---

## Sandbox — Free Trial

Test any agent for free before committing to an API key:

```bash
curl -X POST https://app.wasiai.io/api/v1/sandbox/invoke/wasi-chainlink-price \
  -H "Content-Type: application/json" \
  -d '{"input": {"token": "AVAX"}}'
```

- **No authentication required** — works with plain curl
- **3 free calls per day** per IP per agent
- Full response with the same schema as paid invocations

---

## Why Avalanche?

| Requirement | Why Only Avalanche |
|------------|-------------------|
| **Sub-second finality** | x402 payments must confirm before the HTTP response returns. Agents can't wait 12+ seconds. |
| **Sub-cent gas** | Micropayments of $0.002/call are only viable when gas < payment. |
| **Native USDC** | Circle's native USDC on C-Chain. No bridges, no wrapped tokens. |
| **EVM compatible** | Standard Solidity, EIP-3009, EIP-712, ERC-4337 — all native. |
| **Interchain Messaging** | Future: agents on any Avalanche L1 call the marketplace via ICM. |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, TypeScript, Tailwind CSS |
| Auth | Supabase Auth (Google OAuth, email magic link) |
| Database | Supabase PostgreSQL + Row Level Security (76 migrations) |
| Blockchain | Avalanche C-Chain mainnet |
| Wallets | thirdweb (embedded ERC-4337 + EOA) |
| Contracts | Solidity 0.8.24, Foundry (221 tests) |
| Payments | USDC, x402, EIP-3009, EIP-712 |
| AI | MCP server, Groq (llama-3.1-8b-instant), pipeline orchestration |
| Infrastructure | Vercel Edge, Upstash Redis, Chainlink Automation |

---

## Quick Start

```bash
git clone https://github.com/ferrosasfp/wasiai-v2
cd wasiai-v2
npm install
cp .env.example .env.local
# Fill in credentials (Supabase, thirdweb, RPC, operator key)
npm run dev
```

### Smart Contracts (Foundry)

```bash
cd contracts
forge build
forge test
```

---

## Security

Audited using **[NexusAudit](https://github.com/ferrosasfp/nexus-audit)** — every finding proven with a passing Foundry test before classification.

- 16 findings across 8-phase methodology
- 15 confirmed via Foundry PoC (0 false positives)
- All critical/high findings fixed with inverted PoC verification
- 221 tests total, 0 failures

---

## Team

**Fernando Rosas** — Solo builder. Full-stack + Web3/AI.
Honduras 🇭🇳 · [@fernandoavax](https://t.me/fernandoavax)

872 commits. 18 days to mainnet. One person.

---

## License

MIT

---

<p align="center">
  Built for <a href="https://build.avax.network">Build Games 2026</a> on Avalanche 🔺
  <br/>
  <em>Agents first. Humans always welcome.</em>
</p>
