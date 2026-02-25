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

- **Speed:** Sub-second finality — critical for real-time agent payments
- **Low fees:** $0.001–0.003 per tx — economically viable for micropayments
- **EVM:** Full Solidity compatibility, USDC native support
- **Ecosystem:** Core Wallet integration, growing AI + DeFi builder community

The vision: WasiAI becomes the commerce layer for the agentic economy — the place where AI agents discover, pay, and get paid for services at machine speed.

---

## Team

**Fernando Rosas** — Full-stack developer & Web3 builder  
Based in Honduras 🇭🇳 | Building for the Latin American Web3/AI ecosystem  
[@fernandoavax](https://t.me/fernandoavax)

---

## License

MIT
