# HU-071: Retirar Thirdweb del stack de wallets

**Linear:** WAS-171 | **SDD_MODE:** full | **Tipo:** refactor
**Autor:** San (Adversary) | **Estado:** SPEC_APPROVED

---

## Objetivo

Eliminar Thirdweb del frontend de WasiAI. Los embedded wallets (Google/email/inApp)
son incompatibles con ERC-3009 USDC y con `claimEarnings` on-chain. El doble stack
genera complejidad, bugs frecuentes y superficie de ataque innecesaria.

Reemplazar con wagmi puro + EIP-6963 (detecta Core Wallet, MetaMask, Rabby,
Coinbase Wallet automáticamente). Sin nuevas dependencias.

---

## Acceptance Criteria

| # | Criterio (EARS) |
|---|-----------------|
| AC-1 | WHILE usuario abre la app, THE UI SHALL no instanciar ThirdwebProvider ni ningún hook de thirdweb |
| AC-2 | WHEN usuario hace clic en "Connect Wallet", THE modal SHALL mostrar wallets EOA vía EIP-6963 (wagmi injected + coinbaseWallet) |
| AC-3 | WHEN wallet EOA conectada, THE `useWallet()` SHALL retornar `address`, `isConnected`, `chain`, `disconnect` — sin lógica thirdweb |
| AC-4 | WHEN `writeContract` llamado, THE `useUnifiedWalletClient` SHALL usar viem WalletClient exclusivamente |
| AC-5 | WHEN `signTypedData` / `signMessage` llamado, THE hook SHALL usar viem WalletClient exclusivamente |
| AC-6 | THE flag `isThirdweb` SHALL ser eliminado de todos los componentes y hooks |
| AC-7 | THE Route C (smart account `transfer` path) en `useWalletPayment` SHALL ser eliminado |
| AC-8 | THE codebase SHALL pasar `tsc --noEmit` sin errores y `npm run build` sin errores |

---

## Arquitectura post-refactor

```
WalletConnectButton (reescrito)
  └── useConnect() wagmi
  └── useConnectors() — EIP-6963: Core, MetaMask, Rabby, Coinbase
  └── WalletDetailsPill (sin cambios de UX)

useWallet (simplificado)
  └── useAccount() wagmi
  └── useDisconnect() wagmi
  └── useConnect() wagmi

useUnifiedWalletClient (simplificado)
  └── useWalletClient() wagmi
  └── writeContract → wagmiWalletClient.writeContract
  └── signTypedData → wagmiWalletClient.signTypedData
  └── signMessage → wagmiWalletClient.signMessage

Web3Provider
  └── WagmiProvider ✓
  └── QueryClientProvider ✓
  └── ThirdwebProvider ← ELIMINAR

useWalletPayment
  └── Route A (EIP-3009 transferWithAuthorization) ← mantener
  └── Route B (approve + transferFrom fallback) ← mantener
  └── Route C (isThirdweb transfer directo) ← ELIMINAR
```

---

## Waves de implementación

### Wave 1 — Core hooks
1. **`useWallet.ts`**: eliminar thirdweb state, `isThirdweb`, dual-connection guard. Solo wagmi.
2. **`useUnifiedWalletClient.ts`**: eliminar todo el doble path. Solo `useWalletClient()`.

### Wave 2 — Provider + connect UI
3. **`Web3Provider.tsx`**: eliminar `ThirdwebProvider`.
4. **`WalletConnectButton.tsx`**: reescribir con wagmi `useConnect` + `useConnectors`. Mantener `WalletDetailsPill` UX.
5. **`WalletConnectModal.tsx`**: reescribir con wagmi connectors (usado en `PayToCallButton`).

### Wave 3 — Consumers de isThirdweb
6. **`useWalletPayment.ts`**: eliminar Route C (`isThirdweb` branch), simplificar `deriveState`.
7. **`useNetwork.ts`**: eliminar guards `isThirdweb`.
8. **`agent-keys/page.tsx`**: eliminar guards `isThirdweb` (divs amber + checks).
9. **`WithdrawButton.tsx`**: eliminar guard `isThirdweb` (ya no hay embedded wallets).

### Wave 4 — Cleanup
10. **`thirdwebClient.ts`**: eliminar archivo.
11. **`wallet-cleanup.ts`**: eliminar keys thirdweb del localStorage.
12. Verificar `useChainGuard.ts` — puede tener refs thirdweb.

---

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| Usuarios con sesión thirdweb activa quedan desconectados | Esperado y deseado — reconectan con EOA |
| `WalletConnectModal` en `PayToCallButton` necesita connectors list | Usar `useConnectors()` de wagmi — lista dinámica EIP-6963 |
| `useChainGuard` puede tener refs a thirdweb | Auditar en Wave 4 |
| `NEXT_PUBLIC_THIRDWEB_CLIENT_ID` en env sin uso | Dejar en .env sin referencias — no rompe nada |
