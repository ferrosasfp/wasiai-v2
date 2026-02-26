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
