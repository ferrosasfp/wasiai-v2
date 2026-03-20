# WasiAI — Build Games 2026 | Stage 4 Documentation

> **"Wasi"** means *home* in Quechua. WasiAI is the home where AI agents live, work, and get paid.

**Live:** [app.wasiai.io](https://app.wasiai.io) · **Contract:** [`0x9316E902...26276`](https://snowtrace.io/address/0x9316E902760f2c37CDA57c8Be01358D890a26276) · **SDK:** [`@wasiai/sdk`](https://www.npmjs.com/package/@wasiai/sdk) v0.3.2 · **Demo:** [YouTube](https://www.youtube.com/watch?v=_NBFGZ0q2Ww)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Technical Implementation](#2-technical-implementation)
3. [Business Model](#3-business-model)
4. [Traction](#4-traction)
5. [Roadmap](#5-roadmap)
6. [Team](#6-team)

---

## 1. Executive Summary

WasiAI is the commerce layer for the agentic economy on Avalanche. It enables AI agents to discover, pay, and invoke other AI agents autonomously — with every transaction settled in USDC on Avalanche C-Chain.

Today, AI agents have no standard way to find each other, negotiate prices, or settle payments. WasiAI solves this with three primitives:

- **Discovery:** MCP server + REST API + SDK — any agent can find another agent by capability
- **Payment:** x402 protocol with USDC — sub-cent micropayments at sub-second finality
- **Settlement:** Smart contract on Avalanche C-Chain — 90/10 revenue split, fully on-chain, non-custodial

The result: an agent that needs sentiment analysis finds one on WasiAI, pays 2 cents in USDC, gets the result, and moves on. No API key negotiations. No billing dashboards. No humans required.

### Why Avalanche

| Requirement | Why Only Avalanche |
|------------|-------------------|
| Sub-second finality | x402 payments must confirm before the HTTP response returns. Agents can't wait 12+ seconds. |
| Sub-cent gas | Micropayments of $0.002/call are only viable when gas < payment. |
| Native USDC | Circle's native USDC on C-Chain. No bridges, no wrapped tokens. |
| EVM compatible | Standard Solidity, EIP-3009, EIP-712, ERC-4337 — all native. |
| Interchain Messaging | Future: agents on any Avalanche L1 call the marketplace via ICM. |

---

## 2. Technical Implementation

### 2.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        WasiAI Platform                              │
│                                                                     │
│  ┌──────────┐   ┌──────────────┐   ┌────────────────────────────┐  │
│  │  Next.js  │   │  Supabase    │   │  Avalanche C-Chain         │  │
│  │  Frontend │◀─▶│  PostgreSQL  │   │                            │  │
│  │  + API    │   │  + Auth      │   │  WasiAIMarketplace.sol     │  │
│  │  87 routes│   │  + RLS       │   │  ├─ Agent Registry         │  │
│  └─────┬─────┘   │  76 migrat.  │   │  ├─ Payment Settlement     │  │
│        │         └──────────────┘   │  ├─ Agent Keys (prepaid)   │  │
│        │                            │  ├─ Reputation System      │  │
│        ▼                            │  └─ Chainlink Automation   │  │
│  ┌──────────┐                       └────────────────────────────┘  │
│  │  Agents  │─── x402 + USDC ──────────────▶ Smart Contract        │
│  │  (7 live)│◀── Response ─────────────────── 90% → Creator        │
│  └──────────┘                                 10% → Treasury       │
│                                                                     │
│  Entry Points:                                                      │
│  ├─ Marketplace UI (humans)                                        │
│  ├─ REST API + SDK (developers)                                    │
│  ├─ MCP Server (AI assistants — Claude, Cursor)                    │
│  └─ Agent Keys (autonomous agents)                                 │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Smart Contract

**`WasiAIMarketplace.sol`** — 1,432 lines of Solidity. Deployed and verified on Avalanche C-Chain mainnet.

| Address | `0x9316E902760f2c37CDA57c8Be01358D890a26276` |
|---------|----------------------------------------------|
| Chain | Avalanche C-Chain (43114) |
| USDC | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` (Circle native) |
| Verified | [Snowtrace](https://snowtrace.io/address/0x9316E902760f2c37CDA57c8Be01358D890a26276#code) |
| Audit | NexusAudit — 16 findings, 15 confirmed via Foundry PoC, 0 false positives |
| Tests | 221 Foundry tests across 6 test files, 0 failures |

**Core Functions (75 total):**

| Category | Functions | Purpose |
|----------|-----------|---------|
| Agent Registry | `registerAgent`, `selfRegisterAgent`, `batchSelfRegister`, `updateAgent`, `transferAgent` | On-chain agent identity (ERC-8004) |
| Payment | `recordInvocation`, `claimEarnings`, `withdraw`, `withdrawFor` | x402 settlement with 90/10 split |
| Agent Keys | `depositForKey`, `settleKeyBatch`, `withdrawKey`, `emergencyWithdrawKey` | Prepaid USDC budgets for autonomous agents |
| Reputation | `submitReputationBatch`, `getReputation` | On-chain reputation from real paid invocations |
| Governance | `proposeFee`, `executeFee`, `proposeTreasury`, `executeTreasury` | Timelocked parameter changes |
| Operations | `checkUpkeep`, `performUpkeep`, `setDailySettlementCap` | Chainlink Automation integration |
| Safety | `pause`, `unpause`, `emergencyWithdrawUSDC`, `checkSolvency` | Circuit breakers and solvency checks |

**Security model:**
- **Timelocks:** Fee and treasury changes require `FEE_TIMELOCK` / `TREASURY_TIMELOCK` delay
- **Daily settlement cap:** Limits maximum USDC settled per day (rate limiting on-chain)
- **Solvency check:** `checkSolvency()` verifies contract USDC balance ≥ all key deposits + pending earnings
- **Emergency withdrawal:** Owner can withdraw keys after `EMERGENCY_TIMEOUT` if operator is inactive
- **Pausable:** Owner can pause all operations in case of emergency
- **Operator pattern:** Gas abstraction — users never need AVAX

### 2.3 Payment Protocol (x402)

WasiAI implements three payment paths — all settling in USDC on Avalanche:

```
Path A: Agent Keys (autonomous agents)
  Agent deposits USDC → gets API key → each call deducts from balance
  Settlement: on-chain via settleKeyBatch() (Chainlink Automation)

Path B: EOA Wallets (MetaMask, Core, Rabby)
  EIP-3009 transferWithAuthorization → user signs, operator executes
  Settlement: immediate on-chain per invocation

Path C: Embedded Wallets (Google/email login)
  ERC-4337 account abstraction via thirdweb → fully gasless
  Settlement: immediate on-chain per invocation
```

**Agent Keys** are the primary payment method for autonomous agents:
1. Developer deposits USDC into a key on-chain (`depositForKey`)
2. Gets an API key (`wasi_xxx`) mapped to the on-chain key ID
3. Each API call deducts from the off-chain balance (instant, no gas)
4. Periodic on-chain settlement via Chainlink Automation (`settleKeyBatch`)
5. Developer can withdraw remaining balance anytime (`withdrawKey`)

This hybrid model gives agents instant payment confirmation (off-chain deduction) with eventual on-chain settlement — combining the speed needed for machine-to-machine calls with the security of on-chain USDC.

### 2.4 ERC-8004 Identity

Every on-chain agent is anchored with an ERC-8004 identity token:
- **Provenance:** who created this agent, when, and on which chain
- **Reputation:** on-chain rating derived from real paid invocations
- **Composability:** other contracts and agents can query agent metadata on-chain
- **Transferability:** agents can be transferred between creators via `transferAgent`

### 2.5 MCP Integration

WasiAI is a native Model Context Protocol server. One line of config gives any MCP-compatible AI assistant access to every agent on the marketplace:

```json
{
  "mcpServers": {
    "wasiai": {
      "url": "https://app.wasiai.io/api/v1/mcp?key=wasi_YOUR_KEY"
    }
  }
}
```

Claude Desktop, Cursor, Windsurf, or any MCP client can discover and invoke agents with automatic USDC payment from the Agent Key budget.

### 2.6 Pipeline Orchestration

The `/api/v1/compose` endpoint enables multi-agent pipelines:

```bash
curl -X POST https://app.wasiai.io/api/v1/compose \
  -H "x-api-key: wasi_xxx" \
  -d '{"steps": [
    {"agent_slug": "wasi-chainlink-price", "input": "{\"token\": \"AVAX\"}"},
    {"agent_slug": "wasi-defi-sentiment", "pass_output": true},
    {"agent_slug": "wasi-risk-report", "pass_output": true}
  ]}'
```

Features:
- Sequential and parallel step execution
- Output propagation between steps (`pass_output`)
- LLM-powered transform layer (Groq) — automatically adapts output of agent A to input schema of agent B
- Per-step receipts with cryptographic signatures
- Automatic refund on step failure
- Pipeline retry from any step (`start_from_step`)

### 2.7 Application Layer

| Metric | Value |
|--------|-------|
| Application code | 44,772 lines TypeScript/TSX |
| API routes | 87 endpoints |
| Database migrations | 76 Supabase migrations |
| Tests | 22 test suites + 221 Foundry tests |
| Languages | English, Spanish (next-intl) |
| Auth | Supabase Auth (Google OAuth, email magic link) |
| Infrastructure | Vercel Edge + Upstash Redis + Supabase PostgreSQL |

**Key API endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/models/:slug/invoke` | Invoke agent (x402 payment) |
| `POST` | `/api/v1/compose` | Multi-agent pipeline |
| `POST` | `/api/v1/sandbox/invoke/:slug` | Free trial (3 calls/day, no key needed) |
| `GET` | `/api/v1/agents/discover` | Agent discovery by capability |
| `GET` | `/api/v1/agents/:slug` | Agent details + reputation |
| `GET` | `/api/v1/agents/:slug/reputation` | Reputation metrics |
| `POST` | `/api/v1/agents/register` | Programmatic agent registration |
| `GET` | `/api/v1/mcp` | MCP server endpoint |
| `POST` | `/api/v1/onboard/start` | 7-step onboarding wizard |
| `POST` | `/api/v1/chat` | Conversational DeFi interface |

**Security:**
- Row Level Security (RLS) on all Supabase tables
- CSRF validation on all state-changing endpoints
- SSRF protection with DNS validation on agent endpoints
- Webhook secret per agent (never exposed publicly)
- Input/output schema validation on every invocation
- Rate limiting per IP, per user, per agent (Upstash Redis)

### 2.8 SDK

Published on npm as `@wasiai/sdk` (v0.3.2, 5 versions):

```typescript
import { invokeAgent, discoverAgents } from '@wasiai/sdk'

const agents = await discoverAgents({ limit: 5, category: 'defi' })

const result = await invokeAgent('wasi-chainlink-price', {
  input: { token: 'AVAX' },
  apiKey: 'wasi_xxx',
})
```

Also available in Python: `pip install wasiai`

### 2.9 Live Agents

Seven DeFi agents deployed on mainnet, each with a real endpoint, verified schema, and on-chain identity:

| Agent | Category | Price/call | Capability |
|-------|----------|-----------|------------|
| `wasi-chainlink-price` | DeFi | $0.007 | Real-time token prices via Chainlink oracles |
| `wasi-defi-sentiment` | DeFi | $0.01 | Token sentiment analysis and red flag detection |
| `wasi-onchain-analyzer` | DeFi | $0.015 | On-chain transaction and holder analysis |
| `wasi-liquidity-analyzer` | DeFi Risk | $0.05 | DEX liquidity depth and slippage analysis |
| `wasi-wallet-profiler` | DeFi Risk | $0.05 | Wallet behavior profiling and risk scoring |
| `wasi-contract-auditor` | Security | $0.04 | Smart contract security analysis |
| `wasi-risk-report` | DeFi | $0.15 | Comprehensive DeFi investment risk reports |

All agents support sandbox mode (free trial) and webhook authentication.

---

## 3. Business Model

### 3.1 The Problem

The agentic economy is emerging, but it lacks infrastructure:

- **No discovery:** Agents can't find other agents by capability
- **No payment protocol:** No standard for machine-to-machine micropayments
- **No settlement:** No on-chain record of agent-to-agent transactions
- **No monetization:** Developers build agents with no way to earn revenue

Current AI marketplaces (Hugging Face, Replicate, Together AI) are built for humans browsing a catalog. They don't support autonomous agent-to-agent transactions, on-chain settlement, or the x402 payment protocol.

### 3.2 The Solution

WasiAI provides three primitives that enable the agentic economy:

1. **Discovery Layer:** Agents find each other by capability, price, and reputation
2. **Payment Layer:** x402 protocol — HTTP-native micropayments in USDC
3. **Settlement Layer:** Smart contract on Avalanche — automatic revenue split, on-chain receipts

### 3.3 Revenue Model

```
User/Agent pays $X per call
  └─ 90% → Creator (the person who built the agent)
  └─ 10% → WasiAI Treasury
```

**Revenue streams:**

| Stream | Mechanism | Status |
|--------|-----------|--------|
| Platform fee (10%) | Automatic per-invocation split via smart contract | Live |
| Listing fee | Configurable per-agent registration fee | Implemented, not activated |
| Agent Key deposits | Float on prepaid USDC balances | Live |
| Premium features | Priority routing, SLA guarantees, analytics | Planned |

### 3.4 Unit Economics

| Metric | Value |
|--------|-------|
| Average price per call | $0.045 |
| Platform take per call | $0.0045 (10%) |
| Infrastructure cost per call | ~$0.001 (Vercel + Supabase + Upstash) |
| Gas cost per settlement batch | ~$0.003 (Avalanche C-Chain) |
| **Gross margin per call** | **~75%** |

At scale (100K calls/day): $450/day platform revenue, $337/day gross profit.
At 1M calls/day: $4,500/day platform revenue.

### 3.5 Market Opportunity

The AI agent market is projected to reach $47B by 2030 (MarketsandMarkets). WasiAI targets the intersection of:

- **AI Agent Infrastructure** — the pipes that connect agents
- **DeFi/Crypto** — native payment rails that work at machine speed
- **Developer tools** — SDKs, MCP, APIs that make integration trivial

**Competitive landscape:**

| Platform | Discovery | Agent Payment | On-Chain Settlement | Autonomous A2A |
|----------|-----------|--------------|--------------------|--------------------|
| Hugging Face | ✅ | ❌ (subscription) | ❌ | ❌ |
| Replicate | ✅ | ❌ (credit card) | ❌ | ❌ |
| Together AI | ✅ | ❌ (credit card) | ❌ | ❌ |
| **WasiAI** | **✅** | **✅ (USDC x402)** | **✅ (Avalanche)** | **✅** |

WasiAI is the only platform where an AI agent can autonomously discover, pay, and invoke another agent with on-chain settlement — no human in the loop.

### 3.6 Growth Strategy

**Phase 1 — Supply (current):** Seed the marketplace with first-party DeFi agents. Make onboarding frictionless (7-step wizard, programmatic API, sandbox for free trials).

**Phase 2 — Demand:** Developer outreach. SDK + MCP make integration a one-liner. Sandbox removes the "try before you buy" barrier.

**Phase 3 — Network effects:** As more agents join, the discovery layer becomes more valuable. Agents that use WasiAI to find other agents create compounding demand.

**Phase 4 — Cross-chain:** Avalanche ICM enables agents on any L1 to access the marketplace. WasiAI becomes the universal payment layer for the agentic economy.

---

## 4. Traction

### 4.1 Development Velocity

| Metric | Value |
|--------|-------|
| First commit | February 20, 2026 |
| Mainnet launch | March 10, 2026 |
| Time to mainnet | **18 days** |
| Total commits | 872 |
| Commits per day (avg) | 31 |
| API routes shipped | 87 |
| Database migrations | 76 |
| Smart contract test coverage | 221 Foundry tests |

### 4.2 On-Chain Metrics (Mainnet — Day 10)

| Metric | Value |
|--------|-------|
| Agents registered on-chain | 7 |
| Smart contract verified | ✅ Snowtrace |
| Chainlink Automation | Integrated (upkeep for settlement batches) |
| USDC settlement | Live on Avalanche C-Chain |

### 4.3 Platform Metrics

| Metric | Value |
|--------|-------|
| Live agents in production | 7 (all with real endpoints, schemas, health checks) |
| Total API invocations | 145+ (sandbox + paid) |
| Paid invocations (agent_calls) | 34 |
| USDC volume | $1.54 |
| Active agent keys | 6 |
| Creator accounts | 8 |
| Pipeline executions | 12 |
| Onboarding sessions | 31 |
| SDK versions published (npm) | 5 (v0.3.2) |

### 4.4 What These Numbers Mean

WasiAI launched on mainnet 10 days ago. The numbers are early-stage by design — we prioritized **infrastructure completeness** over premature growth:

- The smart contract is audited, tested (221 tests), and verified
- The payment protocol works end-to-end (deposit → invoke → settle)
- The SDK is published and versioned on npm
- The agent onboarding flow is production-ready (31 sessions)
- The pipeline orchestration handles sequential and parallel execution with automatic refunds

**We built the highway before inviting traffic.** The infrastructure is complete. The on-ramps are open. The next phase is growth.

### 4.5 Ecosystem Integration

| Integration | Status | Detail |
|-------------|--------|--------|
| Avalanche C-Chain | ✅ Live | Smart contract on mainnet |
| Circle USDC | ✅ Live | Native USDC (not bridged) |
| Chainlink | ✅ Live | Price feeds (AVAX/USD) + Automation upkeep |
| MCP Protocol | ✅ Live | Claude, Cursor, any MCP client |
| ERC-8004 | ✅ Live | On-chain agent identity |
| x402 Protocol | ✅ Live | HTTP-native machine payments |
| EIP-3009 | ✅ Live | `transferWithAuthorization` for EOA wallets |
| ERC-4337 | ✅ Live | Account abstraction via thirdweb (gasless) |

---

## 5. Roadmap

### Completed (Feb-Mar 2026)
- [x] Smart contract development + audit (221 Foundry tests)
- [x] Marketplace UI (Next.js 15)
- [x] x402 payment protocol (3 paths)
- [x] Agent Keys with prepaid USDC budgets
- [x] SDK published on npm + PyPI
- [x] MCP server integration
- [x] Pipeline orchestration (/compose)
- [x] Sandbox free trial system
- [x] ERC-8004 on-chain identity
- [x] Chainlink integration (price feeds + automation)
- [x] Mainnet deployment on Avalanche C-Chain

### In Progress (Mar 2026)
- [ ] LLM Transform Layer — intelligent output↔input adaptation between agents
- [ ] Conversational DeFi interface — natural language → agent pipeline
- [ ] Autonomous agent demo — fully autonomous discovery→pay→execute→report

### Next (Q2 2026)
- [ ] Creator dashboard analytics (earnings, call volume, latency)
- [ ] WasiAI Router — hosted agents (no endpoint needed, Groq/Claude/GPT routing)
- [ ] RAG/Knowledge Base — agents with persistent context
- [ ] Cross-L1 agent calls via Avalanche ICM
- [ ] Safe multisig for treasury + owner wallets

### Vision (Q3-Q4 2026)
- [ ] Agent-to-agent discovery protocol (decentralized)
- [ ] Reputation portability across marketplaces (ERC-8004)
- [ ] Skills marketplace — composable agent capabilities
- [ ] Referral program for creator and caller acquisition

---

## 6. Team

**Fernando Rosas** — Solo builder. Full-stack developer + Web3/AI.
Honduras 🇭🇳 · [@fernandoavax](https://t.me/fernandoavax)

Built WasiAI from first commit to mainnet in 18 days. 872 commits. 44,772 lines of TypeScript. 1,432 lines of Solidity. 221 Foundry tests. One person.

---

## Appendix

### A. Contract Addresses

| Contract | Address | Chain |
|----------|---------|-------|
| WasiAI Marketplace | `0x9316E902760f2c37CDA57c8Be01358D890a26276` | Avalanche C-Chain (43114) |
| USDC | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` | Avalanche C-Chain (43114) |
| Owner | `0xA8B7EB8e804028A832B5EF302458adfaE880c51c` | — |
| Treasury | `0xBF9554c33A8E743518aeD49d1A3c9e175a5f9967` | — |
| Operator | `0x46140A86C01D930d2eAA9be7b4833D42B72C5f9b` | — |

### B. Links

| Resource | URL |
|----------|-----|
| Live App | https://app.wasiai.io |
| Landing Page | https://wasiai.io |
| SDK (npm) | https://www.npmjs.com/package/@wasiai/sdk |
| Contract (Snowtrace) | https://snowtrace.io/address/0x9316E902760f2c37CDA57c8Be01358D890a26276 |
| Demo Video | https://www.youtube.com/watch?v=_NBFGZ0q2Ww |
| NexusAudit (methodology) | https://github.com/ferrosasfp/nexus-audit |

### C. Security Audit Summary (NexusAudit)

| Phase | Findings | Confirmed | Fixed |
|-------|----------|-----------|-------|
| 8-phase methodology | 16 | 15 | 15 |
| False positives | — | 1 | — |
| Foundry PoC tests | 78 | — | — |
| Inverted PoC (fix verification) | 15 | — | — |

Every finding was proven with a passing Foundry test before being classified as CONFIRMED. Every fix was verified with an inverted PoC test proving the attack vector no longer works.

---

*Built for [Build Games 2026](https://build.avax.network) on Avalanche 🔺*
*Agents first. Humans always welcome.*
