# SDD #057 — Embedded Wallet on Signup via thirdweb

**Classification:** HU-MAJOR
**Sprint:** 16

---

## Context

Users must install a browser extension wallet to interact with WasiAI on-chain. thirdweb SDK v5 provides `inAppWallet` that creates embedded wallets via Google/email login, eliminating this friction. We keep wagmi for backward compatibility with existing hooks.

## Acceptance Criteria (EARS)

1. WHEN user clicks ConnectButton, THE system SHALL show Google, Email, MetaMask, Core Wallet, and Coinbase as options
2. WHEN user selects Google, THE system SHALL authenticate via thirdweb OAuth and create an embedded wallet
3. WHEN embedded wallet is connected, THE system SHALL display the wallet address in the navbar
4. WHEN user with embedded wallet initiates a transaction, THE system SHALL sign it using the thirdweb account
5. WHEN user connects via MetaMask/Core/Coinbase, THE existing wagmi flow SHALL work unchanged
6. WHEN `useWallet()` is called, THE hook SHALL return unified state (address, isConnected, chain, disconnect) regardless of wallet type
7. WHEN user clicks disconnect, THE system SHALL disconnect the active wallet (thirdweb or wagmi)
8. WHEN building the project, `tsc --noEmit` AND `eslint` AND `next build` SHALL pass with zero errors

## Wave 0 — Pre-flight

- [ ] 0.1: Verify `thirdweb` package is compatible with Next.js 16 + React 19
- [ ] 0.2: Verify files exist: `src/shared/providers/Web3Provider.tsx`, `src/shared/lib/web3/config.ts`, `src/features/payments/components/WalletConnectButton.tsx`, `src/features/payments/components/WalletConnectModal.tsx`, `src/features/wallet/hooks/useWallet.ts`
- [ ] 0.3a: Verify `ThirdwebProvider` accepts no required props (just wraps children)
- [ ] 0.3b: Verify `ConnectButton` from `thirdweb/react` accepts `client`, `wallets`, `chain`, `theme` props
- [ ] 0.3c: Verify `inAppWallet` from `thirdweb/wallets` accepts `auth.options: ['google', 'email']`
- [ ] 0.3d: Verify `useActiveAccount` from `thirdweb/react` returns `Account | undefined` where `Account.address` is compatible with `0x${string}`
- [ ] 0.4: No dependency conflicts between `thirdweb`, `wagmi@3.4.2`, `viem@2.45.2`
- [ ] 0.5: `NEXT_PUBLIC_THIRDWEB_CLIENT_ID` is set in `.env.local`

## Wave 1 — Install + Client

**Steps:**
1. `npm install thirdweb`
2. Create `src/shared/lib/web3/thirdwebClient.ts`:
```ts
import { createThirdwebClient } from "thirdweb"

export const thirdwebClient = createThirdwebClient({
  clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID!,
})
```
3. Add `NEXT_PUBLIC_THIRDWEB_CLIENT_ID=118353d558aec3001cb000d9cdc27660` to `.env.local`

**Build gate:** `npx tsc --noEmit` passes

## Wave 2 — ThirdwebProvider

**Steps:**
1. Edit `src/shared/providers/Web3Provider.tsx`
2. Import `ThirdwebProvider` from `thirdweb/react`
3. Wrap children inside ThirdwebProvider, nested inside WagmiProvider + QueryClientProvider:
```
WagmiProvider → QueryClientProvider → ThirdwebProvider → children
```

**Build gate:** `npx tsc --noEmit` passes

## Wave 3 — WalletConnectButton

**Steps:**
1. Rewrite `src/features/payments/components/WalletConnectButton.tsx`
2. Replace custom button + modal with thirdweb `ConnectButton`
3. Configure wallets array:
   - `inAppWallet({ auth: { options: ['google', 'email'] } })`
   - `createWallet('io.metamask')`
   - `createWallet('app.core.extension')`
   - `createWallet('com.coinbase.wallet')`
4. Set chain to `avalancheFuji` from `thirdweb/chains`
5. Style ConnectButton to match existing UI (light theme, rounded-lg, text-xs, gray border)
6. Set `connectModal.showThirdwebBranding: false`

**Build gate:** `npx tsc --noEmit` passes

## Wave 4 — WalletConnectModal

**Steps:**
1. Rewrite `src/features/payments/components/WalletConnectModal.tsx`
2. Replace custom modal content with thirdweb `ConnectEmbed`
3. Same wallets array as Wave 3
4. On `onConnect` callback: call `onConnected?.()` then `onClose()`

**Build gate:** `npx tsc --noEmit` passes

## Wave 5 — Unified useWallet Hook

**Steps:**
1. Rewrite `src/features/wallet/hooks/useWallet.ts`
2. Import from `thirdweb/react`: `useActiveAccount`, `useActiveWallet`, `useActiveWalletChain`, `useDisconnect`
3. Import from `wagmi`: `useAccount`, `useConnect`, `useDisconnect`
4. Logic: if thirdweb has active account → use thirdweb state. Otherwise → use wagmi state.
5. Return unified interface: `{ address, isConnected, isConnecting, chain, connectWallet, disconnect, isThirdweb }`
6. `disconnect()` calls thirdweb disconnect (with wallet arg) or wagmi disconnect based on active type

**Build gate:** `npx tsc --noEmit` passes

## Wave 6 — Patch wagmi-only hooks for thirdweb compatibility

**Steps:**
1. Scan all files importing `useAccount` from `wagmi` directly:
   - `src/features/payments/hooks/useChainGuard.ts`
   - `src/features/payments/hooks/useWalletPayment.ts`
   - `src/features/payments/hooks/useUsdcBalance.ts`
   - `src/features/payments/components/PayToCallButton.tsx`
   - `src/features/reputation/components/AgentRating.tsx`
   - `src/app/[locale]/admin/page.tsx`
   - `src/app/[locale]/publish/PublishForm.tsx`
   - Any other files found by grep
2. For each file: replace `useAccount` from `wagmi` with the unified `useWallet` hook from `@/features/wallet/hooks/useWallet`
3. Adapt destructuring: `useAccount()` returns `{ address, isConnected, chain }` → `useWallet()` returns same shape
4. For files that use `useConnect` from wagmi (not just read state): keep wagmi import, the unified hook handles connect via `connectWallet()`

**Build gate:** `npx tsc --noEmit` passes

## Wave 7 — Full Build + Verification

**Steps:**
1. Run `npx tsc --noEmit` — must pass
2. Run `npx eslint src/` — must pass with zero warnings
3. Run `npm run build` — must pass
4. Commit locally: `feat(057): integrate thirdweb embedded wallets`
5. **DO NOT PUSH** — wait for PO to test locally

**Build gate:** Full `npm run build` passes

## Rollback

1. `npm uninstall thirdweb`
2. `git checkout HEAD~1 -- src/shared/providers/Web3Provider.tsx src/shared/lib/web3/thirdwebClient.ts src/features/payments/components/WalletConnectButton.tsx src/features/payments/components/WalletConnectModal.tsx src/features/wallet/hooks/useWallet.ts`
3. Remove `NEXT_PUBLIC_THIRDWEB_CLIENT_ID` from `.env.local` and Vercel

## Critical Constraints

- DO NOT remove wagmi — existing payment hooks depend on it
- DO NOT modify `src/shared/lib/web3/config.ts` (wagmi config stays as-is)
- ALL files using `useAccount` from wagmi MUST be patched to use unified `useWallet` hook (Wave 6)
- DO NOT push to remote until PO tests locally and approves
- thirdweb `inAppWallet` disconnect requires passing the wallet object (not zero args)
- `app.wasiai.io` and `localhost:3000` must be in thirdweb dashboard allowed domains
