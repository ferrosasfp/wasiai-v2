# WasiAI Marketplace

> Publish, discover and monetize AI agents. Settled in USDC on Avalanche.

**"Wasi"** means *home* in Quechua. This repository is the WasiAI marketplace: the storefront where humans and agents find each other, and where builders get paid for the agents they publish.

---

## What this repo is, and what it is not

This is a **marketplace application that runs on Avalanche**. It publishes agents, exposes a catalog, meters calls and settles them in USDC on an Avalanche C-Chain contract. Everything in `src/` and `contracts/` targets one EVM chain family, and the config proves it: `NEXT_PUBLIC_CHAIN_ID` accepts exactly two values, `43113` (Fuji) and `43114` (Avalanche C-Chain), and anything else silently falls back to Fuji (`src/shared/lib/web3/chains.ts`, `src/lib/chain.ts`).

**This repo is not the neutral layer.** Cross-chain neutrality is one level below, in a separate open protocol service, the **WasiAI A2A gateway**: [github.com/ferrosasfp/wasiai-a2a](https://github.com/ferrosasfp/wasiai-a2a). The marketplace is one client of that gateway. Other marketplaces can be clients too.

The split is deliberate, and worth explaining because it is the whole architecture:

- A **marketplace** is opinionated. It has one settlement contract, one fee policy, one treasury, one chain. Trying to make it chain-agnostic means every new chain touches the contract, the wallet layer, the fee math and the UI at once.
- A **protocol** should be the opposite. Discovery has no reason to care about chains: an agent card is metadata. Settlement has every reason to care, so it is pushed out to a dedicated service (`wasiai-facilitator`) with one adapter per chain.

So the boundary is: **this repo owns the Avalanche marketplace. The gateway owns chain-agnostic discovery and orchestration. The facilitator owns per-chain settlement.** An application built on top of all three can charge its own fees on Avalanche while moving the principal of a remittance over Solana, because those two concerns never share a code path.

```
   Humans / dApps / MCP clients
              |
              v
   +--------------------------+
   |   WasiAI Marketplace     |   delegates compose,
   |   (this repo, Next.js)   |   orchestrate, capabilities
   |   browse, publish, pay   | ---------------------------+
   |   Avalanche C-Chain      |                            |
   +--------------------------+                            v
              |                              +--------------------------+
     own catalog, own contract,               |   WasiAI A2A gateway     |
     own fee split, one chain                 |   chain-agnostic         |
                                              |   discovery + routing    |
   other marketplaces / clients -----------> +--------------------------+
                                                           |
                                                  settlement handed off
                                                           v
                                              +--------------------------+
                                              |   wasiai-facilitator     |
                                              |   one adapter per chain  |
                                              +--------------------------+
```

### You can see the boundary working

`GET /api/v1/capabilities` on this marketplace is delegated to the gateway's `/discover` (`src/app/api/v1/capabilities/route.ts:81-87`). Query it by capability and the federated answer comes back with agents on different chains, from a codebase that contains zero lines of Solana:

```bash
curl -s "https://app.wasiai.io/api/v1/capabilities?tag=remittance-fx-quote"
```

At the time of writing that returns two agents for the same capability. One declares `"chain": "solana-devnet"` in its payment metadata, the other does not. The marketplace never had to know. That is what "the neutrality lives below" means in practice, and it is checkable in ten seconds without cloning anything.

Honest tense on the Solana side: the Solana agents currently in the federated catalog are on **devnet**, published from a separate repo, and settled by the facilitator, not by this contract. Nothing in this repository is Solana-aware and nothing here should be read as a Solana implementation.

---

## Delegation, and how it is switched

Four endpoints can be delegated to the gateway instead of served locally. The switch is the comma-separated flag `V2_DELEGATE_TO_A2A`, parsed once at module load (`src/lib/proxy/forward-handler.ts:59`):

| Endpoint | Local handler | Delegated target | Status in production |
|----------|---------------|------------------|----------------------|
| `capabilities` | Supabase `agents` query | gateway `GET /discover` | delegated |
| `compose` | removed | gateway `POST /compose` | delegated |
| `orchestrate` | removed | gateway `POST /orchestrate` | delegated |
| `mcp` | full local MCP server | gateway `POST /mcp` | served locally |

Two details that are not obvious and cost real debugging time:

1. **The loop break.** The gateway holds a registry called `WasiAI` whose discovery endpoint points back at `/api/v1/capabilities`. With delegation on, that is an infinite proxy loop. The route detects the gateway calling back (an `x-agent-key` header with no `x-wasiai-source: v2-proxy`) and forces the legacy local handler for that one hop (`src/app/api/v1/capabilities/route.ts:48-52`).
2. **Param translation.** This marketplace's public query schema uses `tag`, `max_price`, `min_reputation`. The gateway uses `capabilities`, `maxPrice`, `minReputation`. Without a rename before forwarding, the upstream ignores the filters and silently returns the unfiltered set, which looks like a working call and is not. The rename happens in `translateParamsForA2A`.

If a delegated endpoint is enabled without `WASIAI_A2A_BASE_URL` and `WASIAI_V2_FORWARD_KEY`, env validation fails at boot rather than sending an empty auth header upstream and getting a cryptic 401.

---

## What you can do here

| Path | Who | How |
|------|-----|-----|
| Marketplace UI | Humans | Browse agents, invoke from the browser, pay with a connected wallet |
| SDK / API | Developers | Programmatic discovery and invocation with an API key |
| MCP server | AI assistants | Claude, Cursor or any MCP client, one config line |

Publishing an agent lists it in this marketplace's catalog and, through the gateway registry, in the federated discovery catalog.

---

## Payments

Machine-to-machine payments use the **x402** HTTP payment flow, settled in USDC. Two paths are live:

| Method | For | How it works |
|--------|-----|--------------|
| Agent Keys | Developers and autonomous agents | Deposit USDC on-chain, receive a key, each call deducts off-chain from the balance, settled on-chain in batches |
| EOA wallets | Any injected wallet (Core, MetaMask, Rabby, discovered via EIP-6963) | EIP-3009 `transferWithAuthorization`: the user signs, the operator submits the transaction and pays the gas |

Agent Keys are the primary path for agent-to-agent flows. The reason is latency, not convenience: an on-chain confirmation per call would put block time inside every HTTP request. Prepaid budget plus off-chain deduction plus batched settlement keeps the payment inside the request and the finality outside it.

The revenue split is enforced in the contract, not in the app. `platformFeeBps` defaults to `1000` (10% platform, 90% creator) and any change goes through a 48 hour timelock (`FEE_TIMELOCK`, `contracts/src/WasiAIMarketplace.sol:74,86`). Treasury changes are timelocked the same way.

An escrow contract (`contracts/src/WasiEscrow.sol`) and its server client (`src/lib/contracts/escrow.ts`) are implemented for held settlement with expiry release. They are not configured in `.env.example` and are off by default.

---

## MCP integration

The marketplace serves a Model Context Protocol server directly (this endpoint is not delegated). It currently advertises one tool per catalog agent:

```json
{
  "mcpServers": {
    "wasiai": {
      "url": "https://app.wasiai.io/api/v1/mcp?key=<your-key>"
    }
  }
}
```

`GET https://app.wasiai.io/api/v1/mcp` returns the tool manifest with no auth, which is the fastest way to see the live catalog.

---

## Pipeline orchestration

Chain multiple agents in one call, with the output of one step adapted into the input of the next. `compose` and `orchestrate` are delegated, so a single composition can span agents from more than one registry and more than one chain:

```bash
curl -X POST https://app.wasiai.io/api/v1/compose \
  -H "x-api-key: <your-key>" \
  -H "Content-Type: application/json" \
  -d '{"steps": [
    {"agent_slug": "remit-kyc-validator", "input": "{\"amountUsd\": 400}"},
    {"agent_slug": "remit-corridor-fx", "pass_output": true}
  ]}'
```

Sequential and parallel steps, per-step signed receipts, and refund when a step fails. Use slugs from the live catalog: the example above is only valid while those agents are published.

---

## SDK

```bash
npm install @wasiai/sdk
```

```typescript
import { invokeAgent, discoverAgents } from '@wasiai/sdk'

const { agents } = await discoverAgents({ limit: 5, category: 'defi' })

const { result } = await invokeAgent({
  slug: 'wasi-chainlink-price',
  input: JSON.stringify({ token: 'AVAX' }),
  apiKey: '<your-key>',
})
```

Note that `input` is a **string**, not an object, and `invokeAgent` takes a single options object. The published package is maintained in its own repository. `packages/sdk` in this repo is an older internal client with a different surface (a `WasiAI` class) and is not what npm installs.

---

## API endpoints

The app exposes 53 route handlers, 50 of them under `/api/v1`. The ones worth knowing:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/models/:slug/invoke` | Invoke an agent with x402 payment |
| `POST` | `/api/v1/compose` | Multi-agent pipeline (delegated) |
| `POST` | `/api/v1/orchestrate` | Plan and execute (delegated) |
| `GET`  | `/api/v1/capabilities` | Federated discovery catalog (delegated) |
| `GET`  | `/api/v1/agents` | This marketplace's own catalog |
| `GET`  | `/api/v1/agents/:slug` | Agent details and reputation |
| `GET`  | `/api/v1/agents/:slug/introspect` | Full agent introspection |
| `POST` | `/api/v1/agents/register` | Programmatic agent registration |
| `PATCH`| `/api/v1/agents/:slug` | Update an agent |
| `GET`  | `/api/v1/mcp` | MCP server manifest (served locally) |
| `POST` | `/api/v1/sandbox/invoke/:slug` | Free trial, session-scoped |

The two discovery endpoints answer different questions on purpose. `/api/v1/agents` is "what did this marketplace publish". `/api/v1/capabilities` is "what can the network do", which includes registries this marketplace does not own.

A free sandbox path exists for signed-in users, with per-IP limits for anonymous callers. The anonymous path is currently not serving: unauthenticated calls return `404 Agent not found` for every catalog slug, so do not treat it as a working demo entry point until that is fixed.

---

## Chain configuration

One env var drives every chain constant (`src/lib/chain.ts`):

| `NEXT_PUBLIC_CHAIN_ID` | Network | USDC |
|------------------------|---------|------|
| `43113` (default) | Avalanche Fuji testnet | `0x5425890298aed601595a70AB815c96711a31Bc65` |
| `43114` | Avalanche C-Chain mainnet | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` |

The live deployment currently runs on **Fuji testnet**. That is a choice, not a gap: real remittance flows are being exercised end to end against testnet rails before any user money moves.

A `WasiAIMarketplace` deployment exists and is live on Avalanche C-Chain mainnet at [`0x9316E902760f2c37CDA57c8Be01358D890a26276`](https://snowtrace.io/address/0x9316E902760f2c37CDA57c8Be01358D890a26276#code) (deploy record in `contracts/broadcast/DeployV2.s.sol/43114/`, bytecode confirmed present via `eth_getCode`). The Fuji address in use comes from `NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI`; several Fuji deployments are recorded under `contracts/broadcast/`, so read the env, not the history.

Because two independent env families resolve that address (the server on-chain client and the EIP-712 voucher `verifyingContract`), a coherence assert fails loudly on mismatch instead of signing vouchers against a stale contract (`src/lib/contracts/marketplaceAddressCoherence.ts`).

Why Avalanche for the marketplace: sub-second finality, so an x402 payment confirms inside the HTTP response rather than after it, gas cheap enough for sub-cent calls, native Circle USDC, and standard EVM tooling for EIP-3009 and EIP-712.

Contract capabilities: agent registry with an ERC-8004 identity id per agent, x402 settlement with the configurable split, Agent Keys with prepaid USDC budgets, on-chain reputation derived from paid invocations, 48 hour timelocks on fee and treasury, Chainlink Automation upkeep, and solvency counters.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS |
| i18n | next-intl, English and Spanish |
| Auth | Supabase Auth |
| Database | Supabase PostgreSQL with Row Level Security |
| Blockchain | Avalanche C-Chain, mainnet or Fuji by env |
| Wallets | wagmi + viem, injected connector with EIP-6963 discovery |
| Contracts | Solidity, Foundry |
| Payments | USDC, x402, EIP-3009, EIP-712 |
| Neutral layer | Delegates compose, orchestrate and capabilities to the WasiAI A2A gateway |
| Infrastructure | Vercel, Upstash Redis, Sentry |

---

## Quick start

```bash
git clone https://github.com/ferrosasfp/wasiai-v2
cd wasiai-v2
npm install
cp .env.example .env.local
npm run dev
```

`.env.example` lists 40 variables. The app boots for local UI work with the Supabase and chain group filled in; the gateway group (`WASIAI_A2A_BASE_URL`, `WASIAI_V2_FORWARD_KEY`, `V2_DELEGATE_TO_A2A`) is only required if you turn delegation on, and env validation will refuse to start if you turn it on halfway.

Scripts, as defined in `package.json`:

```bash
npm run dev              # next dev, serves on :3000
npm run build            # lint + next build
npm run typecheck        # tsc --noEmit
npm run lint             # eslint . --max-warnings 0
npm test                 # vitest run
npm run test:coverage    # vitest run --coverage
npm run test:e2e         # playwright test
npm run qa               # typecheck + lint + test + build
npm run qa:hybrid        # qa + forge build + forge test
npm run contracts:test   # forge test -vvv
npm run contracts:build  # forge build
npm run contracts:slither
npm run contracts:sync-abi
npm run i18n:sync        # keep the EN/ES catalogs aligned
npm run validate:env
```

### Tests

| Suite | Command | Result |
|-------|---------|--------|
| Unit and integration | `npm test` | 652 passing, 5 skipped, across 80 files |
| Contracts | `cd contracts && forge test` | 236 passing, 0 failing, 10 suites |
| Types | `npm run typecheck` | clean |
| Lint | `npm run lint` | clean at `--max-warnings 0` |
| Browser | `npm run test:e2e` | 26 Playwright specs in 6 files, not part of `npm run qa`, needs a running app |

The 5 skipped unit tests are RLS integration tests that require live Supabase credentials.

### Smart contracts

```bash
cd contracts
forge build
forge test
```

---

## Internationalization

Built LATAM-first. The UI ships in English and Spanish, routed by `next-intl`. Both catalogs currently hold 1023 keys across 45 namespaces and are in exact parity; `npm run i18n:sync` is what keeps them there.

---

## Security

Contracts are reviewed with NexusAudit, a methodology where every finding must be reproduced by a passing Foundry test before it is classified, so severities are argued from a failing case rather than from reading.

At the application layer, the Supabase service role bypasses Postgres RLS, so ownership is also enforced in code: any query touching an owner-scoped table filters by owner in addition to id. RLS is defense in depth, not the only defense.

All keys, RPC URLs, the operator private key and the gateway forward secret come from environment variables. Nothing is committed. See `.env.example` for the full list.

---

## License

MIT
