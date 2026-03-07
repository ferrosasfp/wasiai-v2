# Logic Audit — SDD #057 (Post-Amendment A1)

**Auditor:** Logic Auditor (subagent)  
**Date:** 2026-03-06  
**Scope:** Re-audit of all three original blockers + new issue scan  

---

## Verdict: **CONDITIONAL PASS** ⚠️

All three original blockers are **resolved**. Two residual issues found (one medium, one low).

---

## Original Blocker Review

### 1. useWalletPayment / useChainGuard wagmi-only hooks — **RESOLVED** ✅

| File | Finding |
|---|---|
| `src/features/payments/hooks/useWalletPayment.ts` | No longer imports `useWriteContract` or `useWalletClient` from wagmi. Uses `useUnifiedWalletClient` (line 6) which branches thirdweb/wagmi internally. EIP-3009 path correctly skipped for thirdweb wallets (line 101: `if (isThirdweb) { setFlowState('eip3009_failed'); return }`). Approve fallback uses `unifiedWriteContract` (line 160) — works for both providers. |
| `src/features/payments/hooks/useChainGuard.ts:3` | Still imports `useWalletClient, useSwitchChain` from wagmi, BUT correctly short-circuits for thirdweb: `isCorrectChain = true` (line 14), `switchToFuji` is a no-op (line 23). The wagmi hooks are only invoked for external wallets. **Acceptable.** |
| `src/features/contracts/hooks/useContractWrite.ts` | Fully refactored — delegates to `useUnifiedWalletClient` (line 5). Zero direct wagmi imports. |

### 2. Dual-connection guard — **RESOLVED** ✅

| File | Finding |
|---|---|
| `src/features/wallet/hooks/useWallet.ts:27-31` | Guard present via `useEffect`: if both `thirdwebAccount` and `wagmiConnected` are truthy, auto-disconnects wagmi. Comment documents thirdweb-wins policy. |

### 3. Chain type mismatch — **RESOLVED** ✅

| File | Finding |
|---|---|
| `src/features/wallet/hooks/useWallet.ts:36-38` | Chain normalized: thirdweb path returns `viemAvalancheFuji` (viem `Chain` type), wagmi path returns `wagmiChain` (also viem-compatible). Consumers see a uniform `Chain` object. |

---

## New Unified Abstraction Layer

`src/features/wallet/hooks/useUnifiedWalletClient.ts` — **well-structured**:
- Thirdweb path: `prepareTransaction` + `sendTransaction` with `encodeFunctionData` (lines 36-52). Correct.
- Wagmi path: `simulateContract` + `writeContract` via viem `WalletClient` (lines 57-69). Correct.
- `signTypedData` explicitly throws for thirdweb (line 80). Callers handle this.

---

## Residual Issues

### R1. `src/app/[locale]/admin/page.tsx:5` — Direct `useWalletClient` from wagmi (MEDIUM) ⚠️

Admin page still uses raw `useWalletClient` for `signTypedData` and contract interactions (lines 54, 98, 104, 126, 158, 190). **This page will not work for thirdweb-connected users.** Since admin is likely restricted to external wallets, this may be acceptable — but it should either:
- Use `useUnifiedWalletClient`, or  
- Guard with `if (isThirdweb) { show error }`.

**Not a sprint blocker** (admin ≠ end-user flow), but should be tracked.

### R2. `src/features/payments/hooks/useChainGuard.ts:3` — wagmi hooks called unconditionally (LOW)

`useWalletClient()` and `useSwitchChain()` are called at the top level even for thirdweb users. React hooks can't be conditional, so this is technically correct — the results are just unused for thirdweb. No runtime issue, but worth noting for future refactoring.

---

## Wagmi Import Audit (src/)

| File | Import | Status |
|---|---|---|
| `wallet/hooks/useWallet.ts` | `useAccount, useConnect, useDisconnect` | ✅ Expected — unified hook internals |
| `wallet/hooks/useUnifiedWalletClient.ts` | `useWalletClient` | ✅ Expected — abstraction layer |
| `wallet/hooks/useNetwork.ts` | `useSwitchChain` | ✅ Guarded with `isThirdweb` check |
| `wallet/components/WalletInfo.tsx` | `useBalance` | ✅ Read-only, works with both |
| `payments/hooks/useChainGuard.ts` | `useWalletClient, useSwitchChain` | ⚠️ See R2 |
| `payments/hooks/useWalletPayment.ts` | `useWaitForTransactionReceipt` | ✅ Only for approve fallback tx |
| `payments/hooks/useUsdcBalance.ts` | `useReadContract` | ✅ Read-only |
| `transparency/TransparencyDashboard.tsx` | `useReadContract` | ✅ Read-only |
| `admin/page.tsx` | `useWalletClient` | ⚠️ See R1 |
| `shared/lib/web3/config.ts` | `createConfig, http` | ✅ Infrastructure |
| `shared/providers/Web3Provider.tsx` | `WagmiProvider` | ✅ Infrastructure |

No unexpected direct wagmi signing/writing imports outside the abstraction layer (except admin).

---

## Summary

| Blocker | Status |
|---|---|
| B1: wagmi-only hooks in payment/chain flows | ✅ RESOLVED |
| B2: Dual-connection guard | ✅ RESOLVED |
| B3: Chain type mismatch | ✅ RESOLVED |
| R1: Admin page raw wagmi | ⚠️ Track for next sprint |
| R2: Unconditional hook calls in useChainGuard | ℹ️ Low, cosmetic |

**All original blockers cleared. Sprint #057 may proceed to QA.**
