# NEXUS-AUDIT-REPORT v3.0
## WasiAI Marketplace — Security Audit Report

**Fecha:** 2026-03-08
**Auditores:** NexusAudit v2.0 (on-chain) + NexusGuard v1.0 (off-chain)
**Version codebase:** post-pull v3 — 41 archivos cambiados, +4300 lineas
**Commit base:** ab64565 (main)
**Score de seguridad:** 8.6 / 10 (mejora respecto a 8.3/10 de v2)

---

## Executive Summary

Auditoria post-pull v3 del codebase WasiAI. Los cambios principales auditados son:
- **Agent Key system completo:** deposit (Route B EOA), withdraw directo (HU-063), refund
- **Route C (embedded wallet):** USDC.transfer directo para invoke y deposit
- **withdrawKey()** nueva funcion on-chain (HU-063)
- **ERC-8004 Reputation Registry** en contrato
- **Migracion 041** (UNIQUE index tx_hash en agent_calls) y **042** (owner_wallet_address column)
- **Correcciones de v2:** NG-101 FIXED, NG-102 FIXED, NG-105 FIXED, NA-301/303/304 FIXED

**Hallazgos nuevos:** 8 (0 CRITICAL, 2 MEDIUM, 3 LOW, 3 INFO)
**Hallazgos confirmados resueltos de v2:** 6 (NG-101, NG-102, NG-105, NA-301, NA-303, NA-304)
**Sin regresiones** en los 22 fixes de v2.

---

## Scope Delta v3

### Archivos nuevos/modificados criticos examinados

| Archivo | Tipo | Razon de inclusion |
|---|---|---|
| `contracts/src/WasiAIMarketplace.sol` | Contract | `withdrawKey()`, reg. fee, ERC-8004 reputation |
| `src/app/api/agent-keys/[id]/deposit/route.ts` | Route | Route B EOA + Route C blocking |
| `src/app/api/agent-keys/[id]/withdraw/route.ts` | Route | HU-063 withdraw directo, receipt verify |
| `src/app/api/creator/agents/[slug]/upgrade-onchain/route.ts` | Route | NG-101 fix verificado |
| `src/app/api/v1/models/[slug]/invoke/route.ts` | Route | Route C embedded wallet, NG-105 fix |
| `src/lib/contracts/usdcSettler.ts` | Lib | x402 EIP-3009 settlement nativo |
| `src/lib/contracts/marketplaceClient.ts` | Lib | withdrawForCreator, getKeyOwnerOnChain |
| `src/lib/contracts/verifyUsdcTransfer.ts` | Lib | Verificacion USDC on-chain Route C |
| `src/lib/contracts/abis.ts` | Lib | WITHDRAW_KEY_ABI |
| `src/features/wallet/hooks/useWallet.ts` | Hook | Dual-wallet guard (thirdweb + wagmi) |
| `src/features/payments/hooks/useWalletPayment.ts` | Hook | Route C embedded wallet client |
| `supabase/migrations/041_unique_tx_hash.sql` | Migration | Anti-replay UNIQUE index |
| `supabase/migrations/042_owner_wallet_address.sql` | Migration | owner_wallet_address column |

---

## Estado de Hallazgos Previos (v2 — 2026-03-05)

### Fixes Confirmados en v3

| ID | Severidad | Descripcion | Estado |
|---|---|---|---|
| NG-101 | CRITICAL | upgrade-onchain no verificaba contrato destino ni evento AgentRegistered | **FIXED** v3 |
| NG-102 | MEDIUM | Sin rate limiting en upgrade-onchain | **FIXED** v3 |
| NG-105 | MEDIUM | Redis mutex fail-open permitia doble gasto en agent keys | **FIXED** v3 |
| NA-301 | MEDIUM | selfRegisterAgent permisionless — slug squatting sin costo | **FIXED** v3 |
| NA-303 | LOW | Sin validacion de longitud de slug en selfRegisterAgent | **FIXED** v3 |
| NA-304 | LOW | Sin validacion de rango de precio en selfRegisterAgent | **FIXED** v3 |

**Evidencia de fixes:**
- NG-101: `upgrade-onchain/route.ts:89-141` — verifica `receipt.to == MARKETPLACE_CONTRACT_ADDRESS` + `decodeEventLog` para AgentRegistered con slug correcto.
- NG-102: `upgrade-onchain/route.ts:29` — usa `getRegisterLimit()` (5/h por IP).
- NG-105: `invoke/route.ts:248-260` — catch del Redis mutex retorna 503 en lugar de proceder.
- NA-301: `WasiAIMarketplace.sol:261-268` — registrationFee + freeRegistrationsPerUser = 2.
- NA-303: `WasiAIMarketplace.sol:270` — `bytes(slug).length <= 80`.
- NA-304: `WasiAIMarketplace.sol:273` — `pricePerCall >= 1000 && pricePerCall <= 100_000_000`.

### Hallazgos Previos Aun Abiertos

| ID | Severidad | Descripcion | Estado |
|---|---|---|---|
| NG-103 | MEDIUM | register/route.ts retorna on_chain_registered:true antes de confirmar tx | **OPEN** |
| NG-104 | MEDIUM | discover_agents_v2 RPC usa SECURITY DEFINER bypassing RLS | **OPEN** |
| NA-302 | MEDIUM | Sin cron de reconciliacion on-chain vs DB para agentes on_chain | **OPEN** |

---

## Nuevos Hallazgos v3

---

### NG-108 — MEDIUM: withdraw/route.ts sin guard de unicidad para txHash

**Categoria:** NexusGuard | **Severidad:** MEDIUM
**Archivo:** `src/app/api/agent-keys/[id]/withdraw/route.ts:134-159`

**Descripcion:**
El endpoint de retiro directo (HU-063) verifica el receipt on-chain y extrae el monto del evento `KeyWithdrawn`. Sin embargo, no registra el `txHash` con un constraint UNIQUE en ninguna tabla. Enviar el mismo txHash dos veces al endpoint causa sincronizaciones duplicadas del saldo DB.

**Flujo de explotacion (self-harm):**
1. Usuario retira 5 USDC on-chain (txHash A). On-chain balance: 5 USDC.
2. Llama al endpoint con txHash A. DB: `budget_usdc` 10 → 5. Correcto.
3. Llama al endpoint de nuevo con txHash A.
4. DB lee `budget_usdc = 5`, calcula `newBudget = max(0, 5 - 5) = 0`.
5. DB marca `budget_usdc = 0`, `is_active = false`.
6. La key se desactiva aunque on-chain aun tenga 5 USDC.
7. El usuario pierde acceso hasta intervencion manual del operador.

**Evidencia:**
```typescript
// withdraw/route.ts:135-145
const realAmount = Number(BigInt(log.data)) / 1_000_000
const newBudget = Math.max(0, Number(keyRow.budget_usdc) - realAmount)
await serviceClient
  .from('agent_keys')
  .update({ budget_usdc: newBudget, is_active: newBudget > 0 })
  .eq('id', id)
// Sin INSERT en tabla con UNIQUE(tx_hash) — mismo txHash puede procesarse N veces
```

**Nota de contexto:** La migracion 041 agrega `UNIQUE(tx_hash)` en `agent_calls`, pero el withdraw route NO inserta en `agent_calls`, solo actualiza `agent_keys`. El guard no cubre este flujo.

---

### NG-111 — MEDIUM: Route C (embedded wallet invoke) es flujo custodial off-chain

**Categoria:** NexusGuard | **Severidad:** MEDIUM
**Archivo:** `src/features/payments/hooks/useWalletPayment.ts:124-167`, `src/lib/contracts/verifyUsdcTransfer.ts:10-14`

**Descripcion:**
Para usuarios con wallet embebida (Google/email via Thirdweb), Route C ejecuta `USDC.transfer(WASIAI_OPERATOR_ADDRESS, amount)`. El USDC va al operador — NO al contrato marketplace. Consecuencias:

1. **Riesgo custodial:** El operador retiene el USDC. Si el operador no llama `recordInvocation()` (o si el sistema falla), el creador nunca ve esos fondos en `earnings[]`.
2. **Sin prueba on-chain:** Los pagos de Route C no aparecen en el contrato — no hay `AgentInvoked` event ni entrada en `usedPaymentIds`.
3. **Inconsistencia de auditoria:** Los pagos via Route A (x402 EOA) se liquidan en el contrato; Route C no. Esto crea dos niveles de garantia para los creadores.

**Evidencia:**
```typescript
// useWalletPayment.ts:129-135
const transferHash = await unifiedWriteContract({
  functionName: 'transfer',
  args: [WASIAI_OPERATOR_ADDRESS, amountWei],  // operador, no contrato
})
// verifyUsdcTransfer.ts:10-14
const OPERATOR_ADDRESS = (process.env.NEXT_PUBLIC_WASIAI_OPERATOR
  ?? '0x2dd1Bd5D69Fe05205C0eecB9e22Bc8Ec99eE7aaB').toLowerCase()
// invoke/route.ts:413-427: Route C solo actualiza DB, no llama contrato
```

**Nota:** Este puede ser un diseno intencional para simplificar el flujo de embedded wallets. Si es intencional, debe documentarse en el contrato y en el user-facing dashboard.

---

### NA-R01 — LOW: selfRegisterAgent usa bare transferFrom en lugar de safeTransferFrom

**Categoria:** NexusAudit | **Severidad:** LOW
**Archivo:** `contracts/src/WasiAIMarketplace.sol:262-265`

**Descripcion:**
El contrato declara `using SafeERC20 for IERC20` y usa `usdc.safeTransfer()` en todas las transferencias de salida. Pero `selfRegisterAgent()` usa el metodo bare `usdc.transferFrom()` con `require()` para cobrar la registration fee. Inconsistencia que podria fallar silenciosamente con tokens no-standard.

**Evidencia:**
```solidity
// WasiAIMarketplace.sol:261-265 — bare transferFrom
if (registrationFee > 0 && userCount >= freeRegistrationsPerUser) {
    require(
        usdc.transferFrom(msg.sender, address(this), registrationFee),
        "Fee transfer failed"
    );
}
// Contraste — resto del contrato usa SafeERC20:
// usdc.safeTransfer(treasury, platformShare);      (linea 395)
// usdc.safeTransfer(msg.sender, amount);           (linea 415)
```

---

### NA-R02 — LOW: selfRegisterAgent cobra fee ANTES de validar slug uniqueness

**Categoria:** NexusAudit | **Severidad:** LOW
**Archivo:** `contracts/src/WasiAIMarketplace.sol:261-275`

**Descripcion:**
El orden de operaciones en `selfRegisterAgent()` cobra la fee y actualiza el contador de registros ANTES de verificar si el slug ya esta tomado. Si el slug existe, el tx revierte (devolviendo los fondos gracias a la atomicidad de Solidity), pero el usuario gasta gas innecesario. Con costos de gas en Avalanche bajos, el impacto es minimo pero el patron es incorrecto.

**Evidencia:**
```solidity
// WasiAIMarketplace.sol:260-278 — orden actual
uint256 userCount = userRegistrationCount[msg.sender];
if (registrationFee > 0 && userCount >= freeRegistrationsPerUser) {
    require(usdc.transferFrom(...), "Fee transfer failed");  // 1. cobra fee
}
userRegistrationCount[msg.sender] = userCount + 1;          // 2. incrementa contador
require(bytes(slug).length <= 80, "Invalid slug length");   // 3. valida slug
require(pricePerCall >= 1000..., "Price out of range");     // 4. valida precio
require(agents[slug].creator == address(0), "slug taken");  // 5. verifica unicidad
// Orden correcto: verificar unicidad (5) primero, luego cobrar (1-2)
```

---

### NG-109 — LOW: verifyUsdcTransfer.ts con direccion de operador hardcoded como fallback

**Categoria:** NexusGuard | **Severidad:** LOW
**Archivo:** `src/lib/contracts/verifyUsdcTransfer.ts:10-14`

**Descripcion:**
Si las variables de entorno `NEXT_PUBLIC_WASIAI_OPERATOR` y `NEXT_PUBLIC_OPERATOR_ADDRESS` no estan configuradas, el verificador acepta pagos USDC a una direccion hardcodeada. En un deploy mal configurado (staging sin env vars), esto podria verificar pagos a una direccion erronea.

**Evidencia:**
```typescript
// verifyUsdcTransfer.ts:10-14
const OPERATOR_ADDRESS = (
  process.env.NEXT_PUBLIC_WASIAI_OPERATOR
  ?? process.env.NEXT_PUBLIC_OPERATOR_ADDRESS
  ?? '0x2dd1Bd5D69Fe05205C0eecB9e22Bc8Ec99eE7aaB'  // fallback hardcoded — RIESGO
).toLowerCase()
```

---

### NA-R03 — INFO: submitReputationBatch sin whenNotPaused

**Categoria:** NexusAudit | **Severidad:** INFO
**Archivo:** `contracts/src/WasiAIMarketplace.sol:811-838`

**Descripcion:**
`submitReputationBatch()` es `onlyOperator` pero no tiene `whenNotPaused`. Cuando el contrato esta pausado (emergencia), el operador puede seguir actualizando scores de reputacion. Inconsistente con el patron del contrato donde las funciones de escritura tienen `whenNotPaused`.

**Evidencia:**
```solidity
// WasiAIMarketplace.sol:811
function submitReputationBatch(
    string[] calldata slugs,
    uint16[] calldata avgRatings,
    uint32[] calldata voteCounts
) external onlyOperator {  // whenNotPaused ausente
```

---

### NG-112 — INFO: useWallet.ts dual-connection guard con potencial race condition

**Categoria:** NexusGuard | **Severidad:** INFO
**Archivo:** `src/features/wallet/hooks/useWallet.ts:29-34`

**Descripcion:**
El guard que desconecta wagmi cuando thirdweb esta activo usa un `useEffect`. Durante una transicion de conexion (usuario conecta MetaMask mientras thirdweb esta en proceso), ambas condiciones pueden ser `true` momentaneamente, disparando un `wagmiDisconnect()` no deseado.

**Evidencia:**
```typescript
// useWallet.ts:29-34
useEffect(() => {
  if (thirdwebAccount && wagmiConnected) {
    wagmiDisconnect()  // puede dispararse en ventana de transicion
  }
}, [thirdwebAccount, wagmiConnected, wagmiDisconnect])
```

---

### NG-113 — INFO: migration 042 sin indice en owner_wallet_address

**Categoria:** NexusGuard | **Severidad:** INFO
**Archivo:** `supabase/migrations/042_owner_wallet_address.sql`

**Descripcion:**
La columna `owner_wallet_address` se agrega a `agent_keys` sin indice. El flujo de retiro (withdraw/route.ts:60) usa esta columna como lookup primario antes de hacer una llamada RPC on-chain. Sin indice, la query puede ser lenta en tablas grandes.

**Evidencia:**
```sql
-- 042_owner_wallet_address.sql
ALTER TABLE agent_keys
  ADD COLUMN IF NOT EXISTS owner_wallet_address TEXT;
-- Falta: CREATE INDEX idx_agent_keys_owner_wallet ON agent_keys(owner_wallet_address);
```

---

## Resumen Consolidado v3

### Nuevos Hallazgos

| ID | Componente | Severidad | Estado |
|---|---|---|---|
| NG-108 | withdraw/route.ts | **MEDIUM** | NEW |
| NG-111 | useWalletPayment.ts + invoke/route.ts | **MEDIUM** | NEW |
| NA-R01 | WasiAIMarketplace.sol | LOW | NEW |
| NA-R02 | WasiAIMarketplace.sol | LOW | NEW |
| NG-109 | verifyUsdcTransfer.ts | LOW | NEW |
| NA-R03 | WasiAIMarketplace.sol | INFO | NEW |
| NG-112 | useWallet.ts | INFO | NEW |
| NG-113 | migrations/042 | INFO | NEW |

### Hallazgos Abiertos de Versiones Anteriores

| ID | Componente | Severidad | Estado |
|---|---|---|---|
| NG-103 | register/route.ts | MEDIUM | OPEN desde v2 |
| NG-104 | 039_dual_registration.sql | MEDIUM | OPEN desde v2 |
| NA-302 | cron/reconcile | MEDIUM | OPEN desde v2 |

### Fixes Confirmados en v3

| ID | Severidad | Estado |
|---|---|---|
| NG-101 | CRITICAL | FIXED |
| NG-102 | MEDIUM | FIXED |
| NG-105 | MEDIUM | FIXED |
| NA-301 | MEDIUM | FIXED |
| NA-303 | LOW | FIXED |
| NA-304 | LOW | FIXED |

---

## Checks de No-Regresion v3

Los siguientes 22 fixes de la auditoria v2.0 se verificaron sin regresiones:

| Check | Archivo | Status |
|---|---|---|
| CEI pattern en withdraw() | sol:409-417 | PASS |
| CEI pattern en settleKeyBatch() | sol:525-554 | PASS |
| CEI pattern en withdrawKey() | sol:595-599 | PASS |
| ReentrancyGuard en funciones de fondos | sol:55 | PASS |
| Ownable2Step para ownership | sol:55 | PASS |
| Fee timelock 48h | sol:84 | PASS |
| Treasury timelock 48h | sol:89 | PASS |
| SafeERC20 en withdraw/withdrawFor/safeTransfer | sol:415,432 | PASS |
| Pausability en depositForKey/settleKeyBatch | sol:458,502 | PASS |
| Solvency invariant (checkSolvency) | sol:738-748 | PASS |
| Daily settlement cap | sol:497-523 | PASS |
| Emergency timeout 30d | sol:602-617 | PASS |
| CSRF en rutas mutables | upgrade-onchain:25, withdraw:30 | PASS |
| SSRF validation en endpoint URLs | invoke:550-554 | PASS |
| Auth check antes de operaciones | todas las routes | PASS |
| Zod validation en body schemas | deposit:7-26, withdraw:21-24 | PASS |
| Redis mutex fail-closed (NG-105) | invoke:248-260 | PASS |
| UNIQUE index anti-replay agent_calls | 041_unique_tx_hash.sql | PASS |
| decodeEventLog + contract target check (NG-101) | upgrade-onchain:89-141 | PASS |
| Rate limiting upgrade-onchain (NG-102) | upgrade-onchain:29 | PASS |
| Registration fee (NA-301) | sol:261-268 | PASS |
| Slug + price validation (NA-303/304) | sol:270,273 | PASS |

---

## Score de Seguridad v3

| Dimension | v2 (2026-03-05) | v3 (2026-03-08) | Delta |
|---|---|---|---|
| Smart Contract | 8.0 | 8.5 | +0.5 |
| Auth & Access Control | 8.5 | 8.5 | = |
| Payment Flow Integrity | 7.5 | 8.0 | +0.5 |
| Input Validation (Zod) | 9.0 | 9.0 | = |
| Error Handling | 8.5 | 8.5 | = |
| On-chain Verification | 7.0 | 9.0 | +2.0 |
| **Global** | **8.3** | **8.6** | **+0.3** |

---

## Recomendaciones de Prioridad

1. **NG-108 (MEDIUM)** — Insertar en tabla `key_withdrawals` con `UNIQUE(tx_hash)` para hacer el endpoint idempotente.
2. **NG-111 (MEDIUM)** — Clarificar si Route C es custodial por diseno. Si es intencional, documentarlo en dashboard y contratar auditoria formal del flujo custodial.
3. **NA-R01 (LOW)** — Cambiar a `usdc.safeTransferFrom()` en `selfRegisterAgent()`.
4. **NA-R02 (LOW)** — Reordenar `selfRegisterAgent()`: validar slug primero, luego cobrar fee.
5. **NG-109 (LOW)** — Eliminar fallback hardcodeado; usar `throw new Error` si env var no configurada.

---

*Generado por NexusAudit v2.0 + NexusGuard v1.0 | WasiAI Security Framework | 2026-03-08*
