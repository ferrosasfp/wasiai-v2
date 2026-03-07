# Spec Review — SDD #057 Embedded Wallet Onboarding

**Reviewer:** NexusAgil Spec Reviewer (automated)
**Date:** 2026-03-06
**SDD Version:** Initial
**Verdict:** ⚠️ CONDITIONAL PASS — 2 blockers must be resolved before Wave 1

---

## Check Results

### 1. Referenced Files Exist — ✅ PASS

All five files exist in the codebase:
- `src/shared/providers/Web3Provider.tsx` ✅
- `src/shared/lib/web3/config.ts` ✅
- `src/features/payments/components/WalletConnectButton.tsx` ✅
- `src/features/payments/components/WalletConnectModal.tsx` ✅
- `src/features/wallet/hooks/useWallet.ts` ✅

### 2. thirdweb Compatibility — ✅ PASS (with note)

- **thirdweb** `5.119.1` installed, peer dep `react: ^18 || ^19` → compatible with React 19 ✅
- thirdweb bundles its own viem `2.39.0` internally; project uses `viem ^2.45.2`. No conflict — thirdweb isolates its viem. ✅
- thirdweb has **no** peer dependency on wagmi → no version clash. ✅
- Next.js 16 not explicitly listed but thirdweb works with any React 19 framework. ✅

### 3. API Signatures — ⚠️ PARTIAL FAIL

| API | SDD Claim | Actual | Status |
|-----|-----------|--------|--------|
| `ThirdwebProvider` | No required props | Correct — wraps children only | ✅ |
| `ConnectButton` | Accepts `client, wallets, chain, theme` | Exports `ConnectButtonProps` — these props exist | ✅ |
| `ConnectEmbed` | (Wave 4) | Exported from `thirdweb/react` | ✅ |
| `inAppWallet` | `auth: { options: ['google', 'email'] }` | Exported from `thirdweb/wallets` — config shape valid for v5 | ✅ |
| `useActiveAccount` | SDD says "returns `{ address }`" | **Actually returns `Account \| undefined`** — it's NOT `{ address }`, it's a full Account object. Access via `account?.address` | ⚠️ |
| `useDisconnect` | SDD mentions wallet arg in Critical Constraints | `disconnect(wallet: Wallet) => void` — correct | ✅ |
| `createWallet` | IDs: `io.metamask`, `app.core.extension`, `com.coinbase.wallet` | These are WalletConnect registry IDs — valid for thirdweb v5 | ✅ |

### 4. ThirdwebProvider + WagmiProvider Nesting — ✅ PASS

thirdweb has zero dependency on wagmi. They maintain independent React contexts. Nesting order `WagmiProvider → QueryClientProvider → ThirdwebProvider` is safe. No shared state or provider conflicts.

### 5. Downstream Imports — 🔴 FAIL (BLOCKER)

Files that import from modified files:

| File | Imports | Risk |
|------|---------|------|
| `src/features/wallet/components/WalletInfo.tsx` | `useWallet` → uses `{ address, isConnected, chain }` | Must match new return type |
| `src/features/wallet/components/ConnectWallet.tsx` | `useWallet` → uses `{ address, isConnected, isConnecting, chain, connectWallet, disconnect }` | Must match new return type |
| `src/features/payments/hooks/useChainGuard.ts` | Uses `wagmi` `useAccount` directly | **BLOCKER — see Issue #1** |
| `src/features/payments/hooks/useWalletPayment.ts` | Uses `useChainGuard` | Transitively affected |
| `src/features/payments/components/PayToCallButton.tsx` | Imports `WalletConnectModal`, `useWalletPayment` | Transitively affected |
| `src/app/[locale]/layout.tsx` | `Web3Provider` | Safe — just wraps children |
| `src/app/[locale]/admin/page.tsx` | `WalletConnectButton` | Safe if component API unchanged |
| `src/app/[locale]/profile/page.tsx` | `WalletConnectButton` | Safe if component API unchanged |
| `src/components/WasiNavBar.tsx` | `WalletConnectButton` | Safe if component API unchanged |

### 6. Wallets Array Config — ✅ PASS

`inAppWallet()`, `createWallet('io.metamask')`, `createWallet('app.core.extension')`, `createWallet('com.coinbase.wallet')` — all valid thirdweb v5 wallet IDs.

### 7. Missing Acceptance Criteria — ⚠️ MINOR GAPS

See Issues section.

---

## Issues

### 🔴 BLOCKER #1 — `useChainGuard` is wagmi-only; payments will break for thirdweb wallets

**Severity:** BLOCKER

`src/features/payments/hooks/useChainGuard.ts` imports directly from wagmi (`useAccount`, `useSwitchChain`). When a user connects via thirdweb embedded wallet, wagmi's `useAccount` will return `undefined` — the chain guard will think the user is disconnected, and **all payment flows will fail silently**.

The SDD says "DO NOT modify `src/shared/lib/web3/config.ts`" but says nothing about `useChainGuard`. This file **must** be updated to check thirdweb state too, or the unified `useWallet` hook is incomplete.

**Recommendation:** Add a Wave 5.5 step to update `useChainGuard` to use the unified `useWallet` hook (or check both thirdweb and wagmi state). This is the most critical gap — AC #4 ("embedded wallet initiates a transaction") cannot pass without it.

### 🔴 BLOCKER #2 — `useActiveAccount` return type mismatch in SDD

**Severity:** BLOCKER (implementation risk)

SDD Wave 5 / Check 0.3d says `useActiveAccount` "returns `{ address }` compatible with `0x${string}`". In reality, `useActiveAccount()` returns `Account | undefined` where `Account` has `.address` as a property. This isn't destructurable as `{ address }` directly from the hook — you call `const account = useActiveAccount()` then `account?.address`.

If the implementer follows the SDD literally and writes `const { address } = useActiveAccount()`, TypeScript will error because Account is not destructured that way (it's an object with methods, not a plain `{ address }` shape).

**Recommendation:** Fix SDD to show: `const account = useActiveAccount(); const address = account?.address;`

### ⚠️ MAJOR #3 — `connectWallet()` in unified hook is underspecified

**Severity:** MAJOR

Current `useWallet` exports `connectWallet()` which calls `connect({ connector: injected() })`. The SDD says to return `connectWallet` in the new hook but doesn't specify what it should do — open the thirdweb modal? Connect injected? The ConnectButton handles its own connection flow, so `connectWallet()` may be dead code, but `ConnectWallet.tsx` component calls it.

**Recommendation:** Clarify whether `connectWallet()` should be removed or should programmatically open the connect modal.

### ⚠️ MINOR #4 — No acceptance criterion for chain switching with thirdweb wallets

**Severity:** MINOR

AC #4 says "embedded wallet initiates a transaction, system SHALL sign it using thirdweb account" but doesn't cover chain validation. Thirdweb embedded wallets on the wrong chain won't have the `switchChain` UX that MetaMask provides.

### ⚠️ MINOR #5 — `connectModal.showThirdwebBranding: false` may require paid plan

**Severity:** MINOR

Hiding thirdweb branding on ConnectButton may require a Growth/Pro plan on thirdweb dashboard. Verify the current plan supports this.

### ⚠️ MINOR #6 — Missing AC for auto-reconnect persistence

**Severity:** MINOR

No acceptance criterion covers: "WHEN user refreshes the page, THE embedded wallet session SHALL persist." thirdweb handles this internally but it should be explicitly tested.

---

## Summary

| Check | Result |
|-------|--------|
| 1. Files exist | ✅ PASS |
| 2. Compatibility | ✅ PASS |
| 3. API signatures | ⚠️ PARTIAL (useActiveAccount return type wrong in SDD) |
| 4. Provider conflicts | ✅ PASS |
| 5. Downstream breakage | 🔴 FAIL — useChainGuard + payment hooks blind to thirdweb |
| 6. Wallets config | ✅ PASS |
| 7. Missing ACs | ⚠️ MINOR gaps |

**Action Required:** Fix Blockers #1 and #2 before starting implementation. Blocker #1 requires adding a new wave step. Blocker #2 requires SDD text correction.
