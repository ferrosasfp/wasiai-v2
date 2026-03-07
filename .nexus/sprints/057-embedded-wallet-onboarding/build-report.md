# Build Report — SDD #057: Embedded Wallet Onboarding

**Date:** 2026-03-06
**Commit:** `161d1f1` — `feat(057): integrate thirdweb embedded wallets`
**Status:** ✅ ALL WAVES PASSED

## Wave Results

| Wave | Description | Gate | Status |
|------|-------------|------|--------|
| 0 | Pre-flight checks | Manual | ✅ All checks pass |
| 1 | Install + Client (`thirdwebClient.ts`) | `tsc --noEmit` | ✅ |
| 2 | ThirdwebProvider wrapping | `tsc --noEmit` | ✅ |
| 3 | WalletConnectButton → ConnectButton | `tsc --noEmit` | ✅ |
| 4 | WalletConnectModal → ConnectEmbed | `tsc --noEmit` | ✅ |
| 5 | Unified `useWallet` hook | `tsc --noEmit` | ✅ |
| 6 | Patch all wagmi `useAccount` imports | `tsc --noEmit` | ✅ |
| 7 | Full build + commit | `npm run build` | ✅ |

## Pre-flight Summary

- thirdweb: 5.119.1, wagmi: 3.5.0, viem: 2.46.2 — no conflicts
- All target files existed
- `NEXT_PUBLIC_THIRDWEB_CLIENT_ID` set in `.env.local`

## Files Created

- `src/shared/lib/web3/thirdwebClient.ts`

## Files Modified

- `src/shared/providers/Web3Provider.tsx` — added ThirdwebProvider
- `src/features/payments/components/WalletConnectButton.tsx` — replaced with thirdweb ConnectButton
- `src/features/payments/components/WalletConnectModal.tsx` — replaced with thirdweb ConnectEmbed
- `src/features/wallet/hooks/useWallet.ts` — unified thirdweb + wagmi hook

### Wave 6 Patches (useAccount → useWallet)

- `src/features/wallet/hooks/useNetwork.ts`
- `src/features/agents/components/UpgradeOnChainButton.tsx`
- `src/features/payments/hooks/useChainGuard.ts`
- `src/features/payments/hooks/useWalletPayment.ts`
- `src/features/payments/hooks/useUsdcBalance.ts`
- `src/features/payments/components/PayToCallButton.tsx`
- `src/features/reputation/components/AgentRating.tsx`
- `src/app/[locale]/creator/agents/[slug]/edit/EditAgentForm.tsx`
- `src/app/[locale]/admin/page.tsx`
- `src/app/[locale]/publish/PublishForm.tsx`

## Amendment A1 — Wave 6b & 6c

**Date:** 2026-03-06
**Commit:** `d3a1f6b` (amended)
**Source:** Logic Audit blockers (Issues 5b, 5c, 2a, 3a, 5a)

| Wave | Description | Gate | Status |
|------|-------------|------|--------|
| 6b | Adapt payment hooks for thirdweb | `tsc --noEmit` | ✅ |
| 6c | Normalize chain type | `tsc --noEmit` | ✅ |
| — | Full build (`npm run build`) | lint + next build | ✅ |

### Wave 6b — Changes

1. **Created `src/features/wallet/hooks/useUnifiedWalletClient.ts`**
   - Dual-path contract writes: thirdweb (`prepareTransaction` + `sendTransaction`) vs wagmi (`simulateContract` + `writeContract`)
   - Uses `encodeFunctionData` from viem to prepare calldata for thirdweb path
   - Targets `avalancheFuji` chain for thirdweb transactions
   - Exposes `signTypedData` (wagmi-only, throws for thirdweb)

2. **Patched `src/features/payments/hooks/useChainGuard.ts`**
   - thirdweb wallets always report `isCorrectChain = true` (chain-agnostic; set at tx time)
   - `switchToFuji()` is a no-op for thirdweb wallets

3. **Patched `src/features/payments/hooks/useWalletPayment.ts`**
   - Replaced `useWalletClient` + `useWriteContract` with `useUnifiedWalletClient`
   - thirdweb wallets skip EIP-3009/EIP-712 signing → go straight to approve fallback flow
   - `executeApprove` uses unified `writeContract` (works for both wallet types)

4. **Patched `src/features/contracts/hooks/useContractWrite.ts`**
   - Replaced `useWalletClient` with `useUnifiedWalletClient`
   - Simulation handled inside unified client (wagmi path) or skipped (thirdweb path)

5. **`UpgradeOnChainButton.tsx`** — No changes needed (delegates to `UpgradeOnChainModal` → `useContractWrite`, now patched)

6. **Dual-connection guard in `src/features/wallet/hooks/useWallet.ts`**
   - `useEffect` auto-disconnects wagmi when thirdweb connects (prevents address mismatch)
   - `disconnect()` now clears BOTH providers (fixes Issue 3a — dangling wagmi)
   - `connectWallet` and `disconnect` wrapped in `useCallback` (fixes Issue 3b)

### Wave 6c — Changes

1. **Chain normalization in `src/features/wallet/hooks/useWallet.ts`**
   - thirdweb path returns `avalancheFuji` from `viem/chains` (full wagmi-compatible `Chain` object with `nativeCurrency`, `rpcUrls`, `blockExplorers`)
   - Removed `useActiveWalletChain` import (no longer needed)
   - Fixes Issue 5a — consumers get consistent `Chain` type regardless of wallet provider

### Blockers Resolved

| Issue | Description | Resolution |
|-------|-------------|------------|
| 5b | `useChainGuard` wagmi-only switching | thirdweb treated as always-correct-chain |
| 5c | `useWalletPayment` wagmi-only signing | Unified client; thirdweb → approve fallback |
| 2a | Dual-connection race | `useEffect` guard auto-disconnects wagmi |
| 3a | Disconnect leaves wagmi dangling | `disconnect()` clears both providers |
| 5a | Chain type mismatch | Normalized to viem `Chain` object |

## Notes

- **NOT pushed to remote** — awaiting PO local testing
- wagmi kept intact for backward compatibility (useWalletClient, useWriteContract, etc.)
- `src/shared/lib/web3/config.ts` untouched as specified
- `src/app/[locale]/admin/page.tsx` still uses `useWalletClient` directly (admin-only page, wagmi wallet expected for admin ops)
