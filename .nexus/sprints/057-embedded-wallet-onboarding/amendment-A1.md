# Amendment A1 — Adapt payment hooks for thirdweb embedded wallets

**Requested by:** PO
**Impact:** HIGH (payment flow broken for embedded wallets)
**Source:** Logic Auditor blocker finding

---

## Problem

`useWalletPayment`, `useChainGuard`, `useContractWrite`, and related hooks use wagmi's `useWalletClient()`, `useWriteContract()`, and `useSwitchChain()`. These return `undefined` when the active wallet is a thirdweb embedded wallet, causing silent payment failures.

## New Waves

### Wave 6b — Adapt payment hooks for thirdweb

**Steps:**

1. Create `src/features/wallet/hooks/useUnifiedWalletClient.ts`:
   - If thirdweb wallet active → use thirdweb's `useActiveAccount()` to get the account, then use thirdweb's `prepareContractCall` + `sendTransaction` for contract writes
   - If wagmi wallet active → use wagmi's `useWalletClient()` as before
   - Export a unified interface that both payment flows can use

2. Patch `src/features/payments/hooks/useChainGuard.ts`:
   - Replace `useAccount` from wagmi with unified `useWallet`
   - Replace `useSwitchChain` with a version that handles thirdweb (thirdweb wallets auto-switch or we use `switchChain` from thirdweb)

3. Patch `src/features/payments/hooks/useWalletPayment.ts`:
   - Replace `useWalletClient` usage with unified approach
   - For thirdweb: use `sendTransaction` from `thirdweb` with the active account
   - For wagmi: keep existing `useWalletClient` flow

4. Patch `src/features/contracts/hooks/useContractWrite.ts`:
   - Replace `useWriteContract` from wagmi with unified approach
   - For thirdweb: use `prepareContractCall` + `sendTransaction`
   - For wagmi: keep existing `useWriteContract`

5. Ensure `UpgradeOnChainButton.tsx` works with both wallet types

6. Add dual-connection guard: if thirdweb is connected, disable wagmi connectors (and vice versa) to prevent address mismatch

**Build gate:** `npx tsc --noEmit` + `npm run build` passes

### Wave 6c — Normalize chain type

**Steps:**
1. In `useWallet` hook, ensure `chain` always returns wagmi-compatible `Chain` object
2. For thirdweb: map `{ id, name }` to full Chain from `viem/chains`

**Build gate:** `npx tsc --noEmit` passes

**Approval:** AMENDMENT_APPROVED (requires PO)
