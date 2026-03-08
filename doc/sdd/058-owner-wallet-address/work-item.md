# Work Item #058 — Owner Wallet Address en Agent Keys

> Fecha: 2026-03-07
> Tipo: bugfix + improvement
> SDD_MODE: full
> Branch: fix/058-owner-wallet-address

---

## Work Item

| Campo | Valor |
|-------|-------|
| **#** | 058 |
| **Tipo** | bugfix + improvement |
| **SDD_MODE** | full |
| **Objetivo** | Persistir la wallet del primer depósito en `agent_keys.owner_wallet_address`. Solo esa wallet recibe el retiro. Si el usuario deposita con otra wallet, se permite con warning claro. |
| **Root Cause** | `agent_keys` no tiene `owner_wallet_address`. El upsert en `creator_profiles` usa `.eq('user_id')` pero la PK es `id` — nunca guarda nada. El retiro usa `getKeyOwnerOnChain` como workaround costoso. |
| **Scope IN** | Migración DB, deposit route, withdraw route, DepositModal UI |
| **Scope OUT** | Contrato on-chain, `creator_profiles`, `WithdrawModal`, depósitos directos al contrato bypasseando UI |

---

## Acceptance Criteria (EARS)

**AC-1:** WHEN el usuario hace el primer depósito en una key (`owner_wallet_address IS NULL`),
THEN `agent_keys.owner_wallet_address` se persiste con su wallet address.

**AC-2a:** WHEN el usuario deposita con la misma wallet ya registrada en la key,
THEN el depósito procede normalmente y no se muestra ningún warning.

**AC-2b:** WHEN el usuario deposita con una wallet diferente a la ya registrada,
THEN el depósito se acepta Y el response incluye `{ warning: "El retiro solo se puede hacer con 0xOriginal..." }`.

**AC-3:** WHEN el DepositModal se abre y la key ya tiene `owner_wallet_address` que difiere de la wallet conectada,
THEN se muestra aviso: "Esta key solo puede retirarse con 0xABCD…1234. Tu wallet actual puede depositar pero no retirar."

**AC-4:** WHEN el retiro es solicitado,
THEN el servidor lee `owner_wallet_address` de DB; si es null usa `getKeyOwnerOnChain` como fallback.

**AC-5:** IF el usuario intenta depositar en una key con `owner_id` de otro usuario,
THEN el servidor retorna `403 Forbidden`.

---

## Gates

| Gate | Estado |
|------|--------|
| **Gate 1** | HU_APPROVED — 2026-03-07 |
| **Gate 2** | SPEC_APPROVED — 2026-03-07 |
