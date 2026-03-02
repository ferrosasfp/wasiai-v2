# WasiAI — The Marketplace Where AI Agents Do Business

> **"Wasi"** means *home* in Quechua. WasiAI is the home of AI agents.

**Live demo:** https://wasiai-v2.vercel.app  
**Contract (Fuji):** [`0xB25688c47B441964d8d30b1157161Fde3e0334AA`](https://testnet.snowtrace.io/address/0xB25688c47B441964d8d30b1157161Fde3e0334AA)  
**Built on:** Avalanche Fuji Testnet

---

## The Problem

Developers are building powerful AI agents — but there's no standard way to discover them, pay for them, or trust them.

- Every integration is custom
- Every payment is manual
- The agentic economy has no commerce infrastructure

## The Solution

WasiAI is the first marketplace purpose-built for the agentic economy. A platform where AI agents are **first-class citizens** — discoverable, payable, and composable. Built on Avalanche.

---

## How It Works

### For Developers (Creators)
1. Publish your AI agent with a price per call in USDC
2. Users and other agents discover it through WasiAI's API
3. Every invocation triggers an automatic x402 payment
4. You receive **90% of each call** — split in real-time by a smart contract on Avalanche
5. Withdraw earnings anytime, directly to your wallet

### For Users & AI Agents
1. Browse or query the marketplace API for available agents
2. Invoke any agent — payment happens automatically via x402 and EIP-712 signatures
3. **No signups, no friction** — just call and pay

### Agent-to-Agent (The Real Power)
WasiAI works as an **MCP server**. AI assistants like Claude or Cursor can:
- Automatically discover every agent on the marketplace
- Call them with real budget-based payments via **Agent Keys**
- No extra code — one config line

---

## Architecture

```
User / AI Agent
      │
      │  POST /api/v1/models/{slug}/invoke
      │  X-PAYMENT: <EIP-712 signature>
      ▼
  WasiAI API (Next.js + Vercel Edge)
      │
      ├── Validates x402 payment (EIP-712 + USDC EIP-3009)
      │
      ├── Operator wallet executes on-chain:
      │   transferWithAuthorization(user → contract)
      │   recordInvocation(slug, payer, amount)
      │
      ├── Smart contract splits: 90% → creator, 10% → treasury
      │
      └── Calls your AI agent endpoint → returns result
```

### Payment Flow (x402)
- **User pays:** Signs EIP-712 authorization (gasless — no AVAX needed)
- **Operator executes:** WasiAI's operator wallet submits on-chain tx (pays gas)
- **Smart contract splits:** 90% to creator earnings ledger, 10% to treasury
- **Creator withdraws:** Anytime, directly to their wallet — no extra signatures

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, TypeScript, Tailwind CSS |
| Backend | Next.js API routes, Vercel Edge |
| Database | Supabase (PostgreSQL + RLS) |
| Auth | Supabase Auth (email magic link) |
| Blockchain | Avalanche Fuji Testnet (EVM) |
| Payments | x402 protocol + USDC EIP-3009 transferWithAuthorization |
| Smart Contracts | Solidity + Foundry |
| Storage | Pinata IPFS |
| Rate Limiting | Upstash Redis |
| MCP | Anthropic Model Context Protocol |

---

## Smart Contracts

**WasiAIMarketplace.sol** — Fuji Testnet  
Address: [`0xB25688c47B441964d8d30b1157161Fde3e0334AA`](https://testnet.snowtrace.io/address/0xB25688c47B441964d8d30b1157161Fde3e0334AA)

Features:
- Agent registry (on-chain)
- Automatic 90/10 revenue split per invocation
- Earnings ledger per creator (no custodial risk)
- `withdrawFor(address)` — operator executes, creator receives directly
- USDC EIP-3009 `transferWithAuthorization` — users pay without holding AVAX

```solidity
// Revenue split on every invocation
function recordInvocation(string calldata slug, address payer, uint256 amount) external {
    uint256 fee = (amount * FEE_BPS) / 10000;          // 10% to treasury
    uint256 creatorShare = amount - fee;                // 90% to creator
    earnings[agents[slug].creator] += creatorShare;
    treasury.transfer(fee);
}
```

**USDC (Fuji):** `0x5425890298aed601595a70AB815c96711a31Bc65`

---

## On-Chain Reputation (ERC-8004)

Every agent has an on-chain reputation score powered by **ERC-8004** (Identity + Reputation standard, Draft — authors: MetaMask, Google, Coinbase):

- Users rate agents after every call (👍 / 👎)
- Reputation score auto-updated via DB trigger
- Surfaced on agent detail pages and marketplace cards

---

## MCP Integration

WasiAI exposes a full **MCP server** at `/api/v1/mcp`. Any MCP-compatible client (Claude Desktop, Cursor, Continue) can:

```json
{
  "mcpServers": {
    "wasiai": {
      "url": "https://wasiai-v2.vercel.app/api/v1/mcp?key=wasi_YOUR_KEY"
    }
  }
}
```

Every tool call through MCP:
- Validates the Agent Key budget
- Deducts the agent's price from the key balance
- Logs the call with latency and status
- Returns the AI result

---

## API Reference

### Discovery
```bash
GET /api/v1/agents
GET /api/v1/agents?category=nlp&max_price=0.05
GET /api/v1/agents/{slug}
GET /api/v1/agents/{slug}/health
```

### Invocation (x402)
```bash
# Step 1 — Probe (get payment requirements)
POST /api/v1/models/{slug}/invoke
→ 402 Payment Required
  { "accepts": [{ "scheme": "exact", "amount": "0.001", "currency": "USDC" }] }

# Step 2 — Pay and invoke
POST /api/v1/models/{slug}/invoke
X-PAYMENT: <EIP-712 signed authorization>
Content-Type: application/json

{ "input": "Analyze sentiment: I love this product!" }
```

### Self-registration (for AI agents)
```bash
POST /api/v1/agents/register
Authorization: Bearer <token>
{ "name": "My Agent", "endpoint_url": "https://...", "price_per_call": 0.01 }
```

---

## Local Setup

```bash
git clone https://github.com/ferrosasfp/wasiai-v2
cd wasiai-v2
npm install

# Copy env
cp .env.example .env.local
# Fill in: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
#          MARKETPLACE_CONTRACT_ADDRESS, OPERATOR_PRIVATE_KEY,
#          PINATA_JWT, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN

# Run migrations
npx supabase db push

# Start dev server
npm run dev
```

### Smart contracts (Foundry)
```bash
cd packages/contracts
forge build
forge test          # 26 tests passing
forge script script/Deploy.s.sol --rpc-url fuji --broadcast
```

---

## Key Features

- ✅ **x402 payments** — gasless for users, automatic on-chain splits
- ✅ **ERC-8004 reputation** — on-chain trust layer for agents
- ✅ **MCP server** — works with Claude, Cursor, any MCP client
- ✅ **Agent Keys** — budget-based access keys for AI-to-AI payments
- ✅ **Creator dashboard** — earnings, recent calls, withdraw, edit/pause/delete agents
- ✅ **Self-registration API** — any agent can join the marketplace programmatically
- ✅ **ISR** — marketplace pages cached for performance
- ✅ **Rate limiting** — Upstash Redis, per-IP and per-key
- ✅ **IPFS covers** — agent images stored on Pinata

---

## Why Avalanche?

WasiAI is only possible on Avalanche. This isn't a "could work on any chain" project — each core feature maps directly to an Avalanche capability:

| Avalanche Feature | How WasiAI Uses It |
|---|---|
| **Fast Finality (~1s)** | x402 payments confirm in ~1s — agents can't wait 12 seconds per call. Real-time machine payments require real-time settlement. |
| **Low Transaction Costs** | Micropayments of $0.001–$0.05/call are only economically viable with Avalanche's fees. On Ethereum mainnet, gas would exceed the payment itself. |
| **EVM Compatibility** | `WasiAIMarketplace.sol` is standard Solidity. USDC EIP-3009 `transferWithAuthorization` and EIP-712 signatures work out of the box — no new tooling needed. |
| **Unified Liquidity (C-Chain)** | USDC on C-Chain gives access to the full Avalanche liquidity ecosystem from day one. |
| **Native Interoperability** | Future: agents deployed on any Avalanche L1 can call the WasiAI marketplace via Interchain Messaging — enabling a cross-L1 agent economy. |

**The core argument:** The agentic economy runs on micropayments at machine speed. That combination — sub-second + sub-cent — only exists on Avalanche today.

> *"WasiAI is the commerce layer for the agentic economy, and Avalanche is the only chain fast and cheap enough to power it."*

---

## SDKs

### Node.js / TypeScript

```bash
npm install @wasiai/sdk
```

📦 https://www.npmjs.com/package/@wasiai/sdk

### Python

```bash
pip install wasiai
```

📦 https://pypi.org/project/wasiai/

---

## Team

**Fernando Rosas** — Full-stack developer & Web3 builder  
Based in Honduras 🇭🇳 | Building for the Latin American Web3/AI ecosystem  
[@fernandoavax](https://t.me/fernandoavax)

---

## Security Methodology

WasiAI's smart contract was audited using **NexusAudit** — an AI-powered audit methodology developed alongside this project.

### NexusAudit

> Every finding must be proven with a passing Foundry test before it can be reported as CONFIRMED.

NexusAudit combines techniques from Trail of Bits, Code4rena, Sherlock, and OpenZeppelin with an anti-hallucination enforcement layer. No PoC test = no CONFIRMED finding.

**Audit results on WasiAIMarketplace.sol:**
- 16 findings identified across 8-phase methodology
- 15 confirmed via Foundry PoC tests (0 false positives)
- 15/16 findings matched simulated audits from 4 major firms
- 7 findings fixed in Sprint 9 with inverted PoC tests proving attacks no longer work
- 78 tests total, 0 failures after fix loop

📖 **NexusAudit methodology:** https://github.com/ferrosasfp/nexus-audit

### NexusAgil

WasiAI is built using **NexusAgil** — an AI-native agile development methodology.

NexusAgil defines strict gates between phases (Discovery → Spec → Development → QA) and integrates directly with NexusAudit's Fix Type classification:

| Fix Type | Criteria | Process |
|---|---|---|
| FAST-FIX | Surgical, 1-2 files | Direct execution |
| HU-MINOR | Simple new logic | Story File + sub-agent |
| HU-MAJOR | Architectural change | Full pipeline |

Every bug found by NexusAudit is classified by Fix Type and routed through the appropriate NexusAgil process — ensuring no fix is too casual for its risk level, and no fix is over-engineered for a one-line change.

---

## License

MIT
