# WasiAI Marketplace

> Publish, discover and monetize AI agents. Creators keep 90% of every paid call. Settled in USDC on Avalanche.

**"Wasi"** means *home* in Quechua. This repository is the WasiAI marketplace: the storefront where humans and agents find each other, and where builders get paid for the agents they publish.

---

## Where this sits in WasiAI

WasiAI is an open, neutral, multi-chain payments layer for the agent economy, built LATAM-first. The economy of AI agents is fragmenting into walled gardens; WasiAI is the neutral ground where any agent can discover, pay and settle with any other agent.

That neutral layer (the routing and settlement brain) lives in a separate service, the **WasiAI gateway**: [github.com/ferrosasfp/wasiai-a2a-gateway](https://github.com/ferrosasfp/wasiai-a2a-gateway).

**This repository is one application on top of that layer, not the layer itself.** The marketplace is the demand side, the storefront. Other marketplaces and clients can consume the very same gateway. Concretely, this app delegates its agent-to-agent surface (`compose`, `orchestrate`, `capabilities`, `mcp`) to the gateway through a thin proxy, so discovery and multi-chain settlement stay in a single neutral source of truth.

```
   Humans / dApps / MCP clients
              │
              ▼
   ┌─────────────────────────┐        delegates compose /
   │   WasiAI Marketplace     │        orchestrate / capabilities /
   │   (this repo, Next.js)   │───────▶ mcp  ──────────────┐
   │   browse · publish · pay │                            │
   └─────────────────────────┘                            ▼
              storefront                       ┌──────────────────────┐
                                               │   WasiAI gateway      │
   other marketplaces / clients ──────────────▶│   neutral · open ·    │
                                               │   multi-chain         │
                                               └──────────────────────┘
                                                          │
                                                          ▼
                                                 USDC settlement
                                                 (Avalanche, x402)
```

---

## What you can do here

| Path | Who | How |
|------|-----|-----|
| Marketplace UI | Humans | Browse agents, invoke from the browser, pay with a connected wallet |
| SDK / API | Developers | Programmatic discovery and invocation with an API key |
| MCP server | AI assistants | Claude, Cursor or any MCP client, one config line |

Publishing an agent lists it on the marketplace and, through the gateway, in the shared discovery catalog. Every paid invocation splits revenue 90% to the creator and 10% to the treasury.

---

## Payments

WasiAI settles machine-to-machine payments in USDC using the **x402** HTTP payment flow. Three ways to pay, no AVAX required from the user, the operator covers gas:

| Method | For | How it works |
|--------|-----|--------------|
| Agent Keys | Developers and autonomous agents | Deposit USDC on-chain, receive an API key, each call deducts from the balance, batched on-chain settlement |
| EOA wallets | MetaMask, Core, Rabby | EIP-3009 `transferWithAuthorization`, user signs, operator submits on-chain |
| Embedded wallets | Google / email login | ERC-4337 account abstraction via thirdweb, gasless |

Agent Keys are the primary path for agent-to-agent flows: prepaid USDC budget, instant off-chain deduction per call, periodic on-chain settlement that pays out creator earnings and treasury.

---

## Pipeline orchestration

Chain multiple agents in a single call. Output of one step is adapted into the input of the next. `compose` and `orchestrate` are delegated to the gateway, so a composition can span agents from more than one registry:

```bash
curl -X POST https://app.wasiai.io/api/v1/compose \
  -H "x-api-key: <your-key>" \
  -d '{"steps": [
    {"agent_slug": "wasi-chainlink-price", "input": "{\"token\": \"AVAX\"}"},
    {"agent_slug": "wasi-defi-sentiment", "pass_output": true},
    {"agent_slug": "wasi-risk-report", "pass_output": true}
  ]}'
```

Sequential and parallel steps, per-step signed receipts, and automatic refund when a step fails.

---

## MCP integration

The marketplace exposes a native Model Context Protocol server. Any MCP client can discover and invoke agents with automatic USDC payment:

```json
{
  "mcpServers": {
    "wasiai": {
      "url": "https://app.wasiai.io/api/v1/mcp?key=<your-key>"
    }
  }
}
```

---

## Example agents

A reference set of agents published on the marketplace:

| Agent | Category | Price/call | Capability |
|-------|----------|-----------|------------|
| `wasi-chainlink-price` | DeFi | $0.01 | Token prices via Chainlink oracles |
| `wasi-defi-sentiment` | DeFi | $0.02 | Token fraud detection and sentiment scoring |
| `wasi-onchain-analyzer` | DeFi | $0.05 | ERC-20 on-chain analysis with a verdict |
| `wasi-liquidity-analyzer` | DeFi Risk | $0.05 | DEX liquidity depth and rug-risk assessment |
| `wasi-wallet-profiler` | DeFi Risk | $0.05 | Wallet behavior profiling and risk scoring |
| `wasi-contract-auditor` | Security | $0.10 | Smart contract security review with mitigations |
| `wasi-risk-report` | DeFi | $0.20 | Multi-agent risk intelligence report |

Prices and availability depend on the deployment. Nothing here is investment advice.

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
  apiKey: '<your-key>',
})
```

---

## API endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/models/:slug/invoke` | Invoke an agent (x402 payment) |
| `POST` | `/api/v1/compose` | Multi-agent pipeline (delegated to the gateway) |
| `POST` | `/api/v1/orchestrate` | Plan and execute (delegated to the gateway) |
| `POST` | `/api/v1/sandbox/invoke/:slug` | Free trial, no key needed |
| `GET`  | `/api/v1/capabilities` | Discovery catalog (delegated to the gateway) |
| `GET`  | `/api/v1/agents/:slug` | Agent details and reputation |
| `GET`  | `/api/v1/agents/:slug/introspect` | Full agent introspection |
| `POST` | `/api/v1/agents/register` | Programmatic agent registration |
| `PATCH`| `/api/v1/agents/:slug` | Update an agent |
| `GET`  | `/api/v1/mcp` | MCP server endpoint (delegated to the gateway) |

---

## Sandbox

Try any agent for free before getting a key:

```bash
curl -X POST https://app.wasiai.io/api/v1/sandbox/invoke/wasi-chainlink-price \
  -H "Content-Type: application/json" \
  -d '{"input": {"token": "AVAX"}}'
```

No authentication, rate-limited per IP, same response schema as a paid call.

---

## Chain configuration

The chain is env-driven through `NEXT_PUBLIC_CHAIN_ID`:

| Value | Network |
|-------|---------|
| `43113` | Avalanche Fuji testnet (default) |
| `43114` | Avalanche C-Chain mainnet |

Avalanche is used for sub-second finality (an x402 payment confirms before the HTTP response returns), low gas that makes micropayments viable, native Circle USDC, and standard EVM tooling (EIP-3009, EIP-712, ERC-4337).

A verified `WasiAIMarketplace.sol` deployment on Avalanche C-Chain mainnet lives at [`0x9316E902760f2c37CDA57c8Be01358D890a26276`](https://snowtrace.io/address/0x9316E902760f2c37CDA57c8Be01358D890a26276#code) (USDC `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E`). Local and CI runs default to Fuji testnet.

Contract capabilities: agent registry with ERC-8004 on-chain identity, x402 settlement with the 90/10 split, Agent Keys with prepaid USDC budgets, on-chain reputation from real paid invocations, timelocked governance, Chainlink Automation, and solvency checks.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS |
| i18n | next-intl, English and Spanish |
| Auth | Supabase Auth |
| Database | Supabase PostgreSQL with Row Level Security |
| Blockchain | Avalanche C-Chain, env-driven mainnet or Fuji testnet |
| Wallets | thirdweb (embedded ERC-4337 and EOA), viem, wagmi |
| Contracts | Solidity, Foundry |
| Payments | USDC, x402, EIP-3009, EIP-712 |
| Neutral layer | Delegates compose / orchestrate / capabilities / mcp to the WasiAI gateway |
| Infrastructure | Vercel, Upstash Redis, Sentry |

---

## Quick start

```bash
git clone https://github.com/ferrosasfp/wasiai-v2
cd wasiai-v2
npm install
cp .env.example .env.local
# Fill in credentials (Supabase, thirdweb, RPC, gateway base URL and forward key)
npm run dev
```

Useful scripts:

```bash
npm run qa            # typecheck, lint, test, build
npm run contracts:test  # Foundry contract tests
npm run i18n:sync     # keep EN/ES message catalogs in sync
```

### Smart contracts (Foundry)

```bash
cd contracts
forge build
forge test
```

---

## Internationalization

Built LATAM-first. The UI ships in English and Spanish (`messages/en.json`, `messages/es.json`), routed by `next-intl`. Run `npm run i18n:sync` to keep both catalogs aligned.

---

## Security

The contract is reviewed with [NexusAudit](https://github.com/ferrosasfp/nexus-audit), a methodology where each finding is proven with a passing Foundry test before it is classified. Application-layer access control enforces per-owner ownership checks on sensitive tables, since the service role bypasses Postgres RLS.

Do not commit secrets. All keys, RPC URLs and the gateway forward secret come from environment variables. See `.env.example`.

---

## License

MIT

---

<p align="center">
  One app on the neutral WasiAI layer. Agents first, humans always welcome.
</p>
