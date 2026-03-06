# Work Item #006 — WAS-45: Wallet connect/disconnect en WasiNavBar

| Campo | Valor |
|-------|-------|
| **#** | 006 |
| **Linear** | WAS-45 |
| **Tipo** | improvement |
| **SDD_MODE** | full |
| **Objetivo** | Mover wallet connect/disconnect a la WasiNavBar principal — visible en desktop y en el header mobile. Actualmente está enterrado en el menú de usuario. |
| **Reglas de negocio** | Desktop: botón "Connect Wallet" o dirección truncada (0x1234...5678) en navbar. Mobile: en el header (no en bottom nav). Reutilizar WalletConnectButton existente sin modificarlo internamente. Estado persiste via el provider de wallet existente. |
| **Scope IN** | WasiNavBar.tsx desktop y mobile header. Reutilizar WalletConnectButton. |
| **Scope OUT** | Lógica interna de WalletConnectButton. Bottom nav (WAS-48). Página de perfil. |

## Acceptance Criteria

| # | AC |
|---|---|
| 1 | WHEN usuario sin wallet entra al sitio, THE navbar desktop SHALL mostrar botón "Connect Wallet" visible |
| 2 | WHEN usuario conecta wallet, THE navbar SHALL mostrar dirección truncada (0x1234...5678) |
| 3 | WHEN usuario hace click en la dirección, THE navbar SHALL mostrar opción "Disconnect" en dropdown |
| 4 | WHEN app carga en mobile, THE header SHALL mostrar botón wallet (connect o dirección) visible |
| 5 | WHILE wallet está conectada y usuario recarga, THE navbar SHALL mostrar la dirección (estado persistido por provider) |
