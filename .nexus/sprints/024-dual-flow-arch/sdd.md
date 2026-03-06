# SDD-024 — Arquitectura Dual-Flow (WAS-103 / OZ-A1)

**Estado:** DRAFT  
**NNN:** 024  
**HU:** WAS-103  
**Autor:** San (NexusAgil Architect)  
**Fecha:** 2026-03-02  
**Modo:** QUALITY  
**Gate:** HU_APPROVED ✅ — pendiente SPEC_APPROVED

---

## 1. Contexto del Hallazgo OZ-A1

Durante la revisión de auditoría OpenZeppelin (simulada pre-sprint), se identificó la siguiente superficie de ataque:

> **OZ-A1 — Dual-flow sin separación explícita:** El contrato `WasiAIMarketplace.sol` implementa dos flows de pago completamente distintos (x402 directo y pre-funded Key) dentro del mismo contrato, compartiendo un único modificador `onlyOperator`, sin separadores de código formales, sin NatSpec por sección, y con asimetría en la aplicación del modificador `whenNotPaused`.
>
> **Riesgo:** Un operador comprometido tiene permiso implícito para actuar en ambos flows. Un auditor externo no puede identificar de forma inmediata cuáles funciones pertenecen a qué flow. La asimetría de `whenNotPaused` puede provocar estados inesperados (e.g. `refundKeyToEarnings` ejecutable cuando el contrato está pausado).

---

## 2. Estado Actual — Codebase Grounding

**Archivo:** `contracts/src/WasiAIMarketplace.sol`  
**Líneas totales:** 640  
**Tests actuales:** 138 pasando (`contracts/test/WasiAIMarketplace.t.sol`)

### 2.1 Flow x402 (pago directo, sin pre-fondeo)

| Función | Línea aprox. | Modificadores | Descripción |
|---------|-------------|---------------|-------------|
| `recordInvocation()` | ~L245 | `onlyOperator nonReentrant` | Registra pago x402, split earnings/treasury |
| `withdraw()` | ~L285 | `nonReentrant` | Creator retira sus earnings |
| `withdrawFor()` | ~L298 | `onlyOperator nonReentrant` | Operador retira en nombre del creator |

**Nota:** `recordInvocation` y `withdrawFor` NO tienen `whenNotPaused`. `withdraw()` tampoco (correcto — pull pattern siempre disponible, validado en test `test_EdgeCase_WithdrawWhenPaused_Works`).

### 2.2 Flow Key (pre-funded API key)

| Función | Línea aprox. | Modificadores | Descripción |
|---------|-------------|---------------|-------------|
| `depositForKey()` | ~L315 | `onlyOperator nonReentrant whenNotPaused` | Fondea key vía ERC-3009 |
| `settleKeyBatch()` | ~L366 | `onlyOperator nonReentrant whenNotPaused` | Batch settle de llamadas |
| `refundKeyToEarnings()` | ~L420 | `onlyOperator nonReentrant` | ⚠️ Sin `whenNotPaused` — inconsistente |
| `emergencyWithdrawKey()` | ~L437 | `nonReentrant` | Salida trustless (sin operador) — correcto sin pausa |

### 2.3 Funciones compartidas (Registry)

| Función | Línea aprox. | Modificadores |
|---------|-------------|---------------|
| `registerAgent()` | ~L180 | `onlyOperator` |
| `updateAgent()` | ~L210 | check manual (creator o operator) |
| `transferAgent()` | ~L228 | `nonReentrant` (check manual creator) |

### 2.4 Admin (solo owner)

`proposeFee`, `executeFee`, `cancelFee`, `pause`, `unpause`, `setTreasury`, `setOperator`, `setDailySettlementCap` — todos `onlyOwner`.

### 2.5 Chainlink Automation

`checkUpkeep` (view), `performUpkeep` (sin restricción de acceso, protegido por intervalo de tiempo).

### 2.6 Modificadores existentes

```solidity
modifier onlyOperator() {
    require(operators[msg.sender] || msg.sender == owner(), "WasiAI: not operator");
    _;
}
// + herencia: nonReentrant (ReentrancyGuard), whenNotPaused (Pausable), onlyOwner (Ownable2Step)
```

### 2.7 Separadores de código actuales

El código usa comentarios de sección con `// ─── Nombre ───` pero:
- No hay comentario `@dev` explicando a qué flow pertenece cada función.
- No hay bloque NatSpec `@dev flow: x402` / `@dev flow: Key`.
- El lector debe inferir el flow por el nombre de la función.

### 2.8 Asimetría `whenNotPaused` (surface de ataque real)

| Flow | Función | `whenNotPaused` |
|------|---------|-----------------|
| Key | `depositForKey` | ✅ sí |
| Key | `settleKeyBatch` | ✅ sí |
| Key | `refundKeyToEarnings` | ❌ **falta** |
| Key | `emergencyWithdrawKey` | ✅ correcto (sin pausa — trustless) |
| x402 | `recordInvocation` | ❌ (discutible — ver sección 4) |
| x402 | `withdrawFor` | ❌ (discutible) |
| x402 | `withdraw` | ❌ correcto (pull pattern siempre disponible) |

---

## 3. Diseño del Refactor

### 3.1 Objetivo

Reducir superficie de ataque **sin cambiar lógica de negocio, cálculos ni storage layout**. El refactor es puramente arquitectónico: claridad, trazabilidad y corrección de asimetría.

### 3.2 Cambios a implementar

#### CAMBIO 1 — Agregar `whenNotPaused` a `refundKeyToEarnings`

**Archivo:** `contracts/src/WasiAIMarketplace.sol`  
**Función:** `refundKeyToEarnings` (~L420)  
**Cambio:**

```solidity
// ANTES:
function refundKeyToEarnings(bytes32 keyId) external onlyOperator nonReentrant {

// DESPUÉS:
function refundKeyToEarnings(bytes32 keyId) external onlyOperator nonReentrant whenNotPaused {
```

**Justificación:** `depositForKey` y `settleKeyBatch` están pausadas. `refundKeyToEarnings` es la operación inversa de `depositForKey` — también debería respetarse el pausa del sistema Key. Cuando el contrato está pausado, el operador no debería poder mover balances entre `keyBalances` y `earnings` sin supervisión explícita del owner.

**Impacto en tests:** Revisar `test_RefundKeyToEarnings_*`. Ningún test actual ejecuta `refundKeyToEarnings` mientras el contrato está pausado — el cambio no rompe ningún test existente.

**EXCEPCIÓN — `emergencyWithdrawKey`:** No recibe `whenNotPaused` porque es la salida trustless del usuario. Si el contrato está pausado Y el operador está inactivo, el usuario debe poder recuperar sus fondos. Esto está validado en `test_EdgeCase_EmergencyWithdraw_WhenContractPaused`.

---

#### CAMBIO 2 — Bloque NatSpec explicativo por flow (cabecera de sección)

Agregar bloques `@dev` en los comentarios de sección del contrato para identificar explícitamente a qué flow pertenece cada función.

**Antes del primer comentario de sección `// ─── Payment Accounting ───`**, agregar:

```solidity
// ─── FLOW GUIDE ───────────────────────────────────────────────────────────────
// This contract implements two payment flows that share state but serve
// distinct use cases:
//
//  ┌─ Flow x402 (direct payment, post-funded) ──────────────────────────────┐
//  │  Used by: Ultravioleta DAO facilitator after on-chain USDC settlement  │
//  │  Functions: recordInvocation(), withdraw(), withdrawFor()              │
//  │  State:     earnings[creator], totalEarnings, usedPaymentIds           │
//  └────────────────────────────────────────────────────────────────────────┘
//
//  ┌─ Flow Key (pre-funded API key) ────────────────────────────────────────┐
//  │  Used by: Backend operator after user signs ERC-3009 authorization     │
//  │  Functions: depositForKey(), settleKeyBatch(), refundKeyToEarnings(),  │
//  │             emergencyWithdrawKey()                                      │
//  │  State:     keyBalances[keyId], keyOwners[keyId], totalKeyBalances     │
//  └────────────────────────────────────────────────────────────────────────┘
//
//  Both flows share: agents[], operators[], platformFeeBps, totalVolume,
//  totalInvocations, treasury.
//
//  OZ-A1 note: A single `onlyOperator` modifier controls both flows.
//  Future hardening (WAS-110+) may introduce role separation.
// ─────────────────────────────────────────────────────────────────────────────
```

---

#### CAMBIO 3 — NatSpec `@dev flow:` en funciones clave

Agregar `@dev flow: x402` o `@dev flow: Key` en el bloque NatSpec de cada función de flow:

- `recordInvocation()` → agregar `@dev flow: x402`
- `withdraw()` → agregar `@dev flow: x402 (also used by Key via refundKeyToEarnings)`
- `withdrawFor()` → agregar `@dev flow: x402`
- `depositForKey()` → agregar `@dev flow: Key`
- `settleKeyBatch()` → agregar `@dev flow: Key`
- `refundKeyToEarnings()` → agregar `@dev flow: Key`
- `emergencyWithdrawKey()` → agregar `@dev flow: Key (trustless exit)`

---

### 3.3 Lo que NO se toca

| Categoría | Razón |
|-----------|-------|
| Lógica de split de fees | Cálculos correctos, 138 tests validan |
| Storage layout (orden de variables) | Cambio rompería upgrades futuros |
| `onlyOperator` modifier (no se separa en roles) | Scope OUT — WAS-110+ lo haría |
| `withdraw()` sin `whenNotPaused` | Correcto by design (pull pattern) |
| `emergencyWithdrawKey()` sin `whenNotPaused` | Correcto by design (trustless exit) |
| `recordInvocation()` sin `whenNotPaused` | x402 es post-funded; el pago ya ocurrió en otra tx. Bloquear el registro sería potencialmente peligroso para el usuario. Decisión consciente. |
| Cualquier función de admin | Fuera de scope |
| Tests `.t.sol` | El refactor NO debe romper ningún test |

---

## 4. ACs Técnicos Verificables

| # | AC | Verificación |
|---|----|-------------|
| AC-1 | `refundKeyToEarnings` tiene modificador `whenNotPaused` | `grep -n "whenNotPaused" WasiAIMarketplace.sol` debe mostrar la función |
| AC-2 | `forge test` pasa exactamente 138 tests sin errores | `cd contracts && forge test` output `Ran X tests... [PASS]` |
| AC-3 | Bloque `// ─── FLOW GUIDE ───` existe en el contrato antes de `// ─── Payment Accounting` | grep en el archivo |
| AC-4 | Cada función de flow tiene `@dev flow:` en su NatSpec | Inspección manual del diff |
| AC-5 | No hay cambios en funciones de lógica (splits, cálculos, storage) | `git diff` muestra solo adiciones de comentarios y un modificador |
| AC-6 | Adversarial Review completado y aprobado | Documento en `doc/adversarial/024-review.md` |

---

## 5. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| `whenNotPaused` en `refundKeyToEarnings` rompe test existente | Baja | Medio | Revisar todos los tests `test_RefundKeyToEarnings_*` antes — ninguno ejecuta en estado pausado |
| Dev toca lógica de negocio al editar NatSpec (copy-paste error) | Baja | Alto | Constraint Directive explícita en story file; diff review obligatorio |
| Compilación falla por syntax en comentarios | Baja | Bajo | `forge build` como primer paso antes de `forge test` |
| Asimetría en `recordInvocation` queda sin resolución | Intencional | Aceptado | Documentado en OZ-A1 note del FLOW GUIDE — decisión consciente por Sprint 17 |

---

## 6. Context Map de Contratos (Post-Refactor)

```
WasiAIMarketplace.sol
│
├── [FLOW x402] ─────────────────────────────────────────────────────
│   ├── recordInvocation()   — onlyOperator, nonReentrant
│   ├── withdraw()           — nonReentrant
│   └── withdrawFor()        — onlyOperator, nonReentrant
│
├── [FLOW KEY] ──────────────────────────────────────────────────────
│   ├── depositForKey()      — onlyOperator, nonReentrant, whenNotPaused
│   ├── settleKeyBatch()     — onlyOperator, nonReentrant, whenNotPaused
│   ├── refundKeyToEarnings()— onlyOperator, nonReentrant, whenNotPaused  ← NEW
│   └── emergencyWithdrawKey()— nonReentrant (trustless, no pause)
│
├── [REGISTRY COMPARTIDO] ───────────────────────────────────────────
│   ├── registerAgent()      — onlyOperator
│   ├── updateAgent()        — creator or operator
│   └── transferAgent()      — nonReentrant (creator only)
│
├── [ADMIN] ─────────────────────────────────────────────────────────
│   ├── proposeFee/executeFee/cancelFee — onlyOwner
│   ├── pause/unpause        — onlyOwner
│   ├── setTreasury          — onlyOwner
│   ├── setOperator          — onlyOwner
│   └── setDailySettlementCap— onlyOwner
│
└── [CHAINLINK] ─────────────────────────────────────────────────────
    ├── checkUpkeep()        — view (anyone)
    └── performUpkeep()      — anyone (interval guarded)
```

---

## 7. Definition of Done (WAS-103)

- [ ] `forge test` pasa 138/138 tests
- [ ] `forge build` sin warnings nuevos
- [ ] `git diff` muestra exactamente: 1 modificador agregado + comentarios NatSpec
- [ ] Adversarial Review aprobado
- [ ] Este SDD actualizado con estado `APPROVED`

---

*Generado por San (NexusAgil Architect) — 2026-03-02 — WAS-103/NNN-024*
