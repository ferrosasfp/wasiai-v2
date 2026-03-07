# Work Item — 057: Embedded Wallet on Signup

**Classification:** HU-MAJOR
**Priority:** P1 — HIGH (onboarding friction)
**Sprint:** Backlog
**Linear:** TBD

---

## Problem

Users must install and connect an external wallet (Core, MetaMask) to make payments or interact on-chain. This is the #1 friction point for non-crypto users.

## Desired Outcome

When a user signs up (Google or email), a wallet is automatically created for them. They can:
- Pay for agent calls without installing any extension
- Deposit USDC to their embedded wallet
- Sign x402 payments seamlessly
- Optionally upgrade to on-chain registration (ERC-8004) without external wallet

## Options to Evaluate

### Option A: Reactivate Pimlico (ERC-4337)
- Already partially in codebase (bundler + paymaster URLs commented out)
- Full Account Abstraction: smart wallets, gasless txs
- Higher complexity, WasiAI pays gas (sponsoring)
- Free tier: 100 UserOps/day

### Option B: thirdweb Embedded Wallets
- Login with Google → wallet created automatically
- SDK replaces wagmi connect flow
- Free tier: 1000 wallets
- Medium complexity

### Option C: Privy
- Same embedded wallet concept
- Very easy integration
- Free tier: 1000 MAU
- Lowest complexity

### Option D: Coinbase Smart Wallet
- Already have coinbaseWallet connector in config
- Native Coinbase ecosystem
- Free, no paymaster needed for basic operations

## Acceptance Criteria

1. **AC-1:** User signs up with Google → wallet address is created and stored in DB
2. **AC-2:** User can deposit USDC to their embedded wallet from the dashboard
3. **AC-3:** User can call agents and pay via x402 using embedded wallet (no extension)
4. **AC-4:** User can upgrade agent to on-chain (ERC-8004) using embedded wallet
5. **AC-5:** Existing users with external wallets are not broken (backward compatible)
6. **AC-6:** Gas costs are documented and budgeted (if using sponsored paymaster)

## Files Likely Affected

- `src/shared/lib/web3/config.ts` — wallet config
- `src/shared/providers/Web3Provider.tsx` — provider setup
- `src/features/wallet/` — connect flow
- `src/features/payments/` — payment hooks
- `src/features/agents/components/UpgradeOnChainButton.tsx`
- `src/app/[locale]/(auth)/` — signup flow

## Notes

- ADR-005 eliminated Pimlico because API key was exposed in NEXT_PUBLIC_. If reactivating, use server-side paymaster proxy.
- Evaluate gas cost per user per month before choosing sponsored mode.
- This HU changes the landing page FAQ from "connect a wallet" back to "we create a wallet for you".
