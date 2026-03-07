# Work Item — 057: Embedded Wallet on Signup via thirdweb

**Classification:** HU-MAJOR
**Priority:** P1 — HIGH (onboarding friction)
**Sprint:** 16

---

## Problem

Users must install and connect an external wallet (Core, MetaMask) to make payments or interact on-chain. This is the #1 friction point for non-crypto users. The project had Pimlico Account Abstraction (ADR-005) but it was removed due to exposed API keys.

## Desired Outcome

When a user connects their wallet via the app, they can choose:
1. **Embedded wallet** (Google/email via thirdweb) — wallet created automatically, zero crypto knowledge needed
2. **External wallet** (MetaMask, Core, Coinbase) — for users who already have one

Both paths lead to a connected wallet that can sign x402 payments and interact with the WasiAI contract.

## Solution

Integrate **thirdweb SDK v5** (Starter plan, $5/mo — already subscribed) with `inAppWallet` for embedded wallets alongside existing wagmi connectors.

## Acceptance Criteria

1. **AC-1:** ConnectButton shows "Sign in with Google" and "Email" as wallet options alongside MetaMask/Core/Coinbase
2. **AC-2:** User selects Google → authenticates → embedded wallet is created and connected
3. **AC-3:** Embedded wallet address is displayed in the navbar after connection
4. **AC-4:** User with embedded wallet can sign transactions (x402 payments, on-chain registration)
5. **AC-5:** Existing external wallet flow (MetaMask, Core) still works unchanged
6. **AC-6:** `useWallet` hook returns unified state regardless of wallet type (thirdweb or wagmi)
7. **AC-7:** Disconnect works for both wallet types
8. **AC-8:** Build passes (`tsc --noEmit` + `eslint` + `next build`)

## Technical Constraints

- thirdweb Client ID: `118353d558aec3001cb000d9cdc27660`
- `app.wasiai.io` must be in thirdweb allowed domains
- Chain: Avalanche Fuji (43113) for now, Mainnet (43114) later
- Keep wagmi for backward compatibility with existing payment hooks
- ThirdwebProvider wraps inside WagmiProvider (coexistence)

## Files to Modify

- `package.json` — add `thirdweb` dependency
- `src/shared/lib/web3/thirdwebClient.ts` — NEW: thirdweb client
- `src/shared/providers/Web3Provider.tsx` — add ThirdwebProvider
- `src/shared/lib/web3/config.ts` — no changes (keep wagmi config)
- `src/features/payments/components/WalletConnectButton.tsx` — use thirdweb ConnectButton
- `src/features/payments/components/WalletConnectModal.tsx` — use thirdweb ConnectEmbed
- `src/features/wallet/hooks/useWallet.ts` — unified thirdweb + wagmi hook
- `.env.local` — add NEXT_PUBLIC_THIRDWEB_CLIENT_ID

## Rollback

1. `npm uninstall thirdweb`
2. Revert modified files to pre-057 state
3. Remove NEXT_PUBLIC_THIRDWEB_CLIENT_ID from env
