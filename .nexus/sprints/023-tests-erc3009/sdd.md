# SDD-023 — Tests MockUSDC firma ERC-3009

**HU:** WAS-89  
**NNN:** 023  
**Estado:** ✅ IMPLEMENTADO — 3 tests pasan, 0 fallos  
**Modo:** QUALITY  
**Fecha grounding:** 2026-03-02  
**Architect:** San (NexusAgil)

---

## 1. Contexto técnico — ERC-3009

**ERC-3009** (Token Transfer With Authorization) es un estándar de Circle para USDC que permite transferencias sin gas desde el punto de vista del usuario. El firmante (user) crea una autorización EIP-712 off-chain; cualquier relayer (aquí el operador backend de WasiAI) la ejecuta on-chain pagando el gas.

### Por qué importa en WasiAI

`depositForKey()` es el entry-point del flujo "pre-funded API key":

```
User firma ERC-3009 off-chain
  → Operador llama depositForKey(keyId, owner, amount, validAfter, validBefore, nonce, v, r, s)
  → Contrato llama IERC3009.transferWithAuthorization(...)
  → USDC viaja directo del user al contrato, sin approve previo
```

Si la firma es falsa, el USDC del usuario está comprometido. Tests sin verificación real dejan este vector opaco.

### EIP-712 struct para transferWithAuthorization

```
TransferWithAuthorization(
  address from,
  address to,
  uint256 value,
  uint256 validAfter,
  uint256 validBefore,
  bytes32 nonce
)
```

Domain separator (Circle USDC mainnet):
```
EIP712Domain(string name, string version, uint256 chainId, address verifyingContract)
name    = "USD Coin"
version = "2"
```

---

## 2. Codebase Grounding — Hallazgos

### 2.1 Archivos relevantes

| Archivo | Rol |
|---|---|
| `contracts/src/WasiAIMarketplace.sol` | Contrato principal. Define `IERC3009` y llama `transferWithAuthorization` en `depositForKey()` |
| `contracts/test/WasiAIMarketplace.t.sol` | Suite de tests. Contiene MockUSDC (sin firma) Y MockUSDCReal + WAS89_ERC3009SignatureTest (con firma real) |
| `contracts/foundry.toml` | `solc_version = "0.8.24"`, src=`src/`, out=`out/`, libs=`lib/` |

### 2.2 MockUSDC actual (líneas 9–49 del test file)

```solidity
// MockUSDC — bypassea firma intencionalmente
function transferWithAuthorization(
    address from, address to, uint256 value,
    uint256, uint256, bytes32, uint8, bytes32, bytes32  // firma ignorada
) external {
    require(balanceOf[from] >= value, "MockUSDC: insufficient balance for auth");
    balanceOf[from] -= value;
    balanceOf[to]   += value;
}
```

**Diseño deliberado:** MockUSDC es correcto para los ~135 tests de lógica de negocio. No es un bug — es separación de concerns. Los tests de negocio no deben depender de ECDSA para mantenerse rápidos y legibles.

### 2.3 MockUSDCReal — implementación ERC-3009 real (líneas ~572–636)

Ya existe en el archivo. Implementa:
- `TRANSFER_WITH_AUTHORIZATION_TYPEHASH` correcto
- `DOMAIN_SEPARATOR` con `name="USD Coin"`, `version="2"`, `chainId`, `verifyingContract`
- Validaciones: `validAfter`, `validBefore`, nonce único (`authorizationState`)
- `ecrecover` con digest EIP-712 correcto
- Revert con mensajes descriptivos: `ERC3009: invalid signature`, `ERC3009: auth already used`, `ERC3009: auth not yet valid`, `ERC3009: auth expired`

### 2.4 WAS89_ERC3009SignatureTest (líneas ~638–720)

3 tests ya implementados y **pasando**:

| Test | Verifica |
|---|---|
| `test_ERC3009_DepositForKey_RealSignature` | Happy path: firma válida transfiere USDC y registra key |
| `test_ERC3009_DepositForKey_WrongSignature_Reverts` | Firma de otra clave privada → revert "ERC3009: invalid signature" |
| `test_ERC3009_DepositForKey_ReplayAttack_Reverts` | Misma nonce en segundo intento → revert "ERC3009: auth already used" |

### 2.5 Estado de la suite completa

```
Ran 5 test suites: 138 tests passed, 0 failed, 0 skipped
```

---

## 3. Diseño de la solución

### 3.1 Arquitectura de tests (ya implementada)

```
WasiAIMarketplace.t.sol
├── MockUSDC                          — bypass firma (135 tests de negocio)
├── MockUSDCReal                      — ERC-3009 real con ECDSA
└── WAS89_ERC3009SignatureTest        — 3 tests de firma ERC-3009
    ├── test_ERC3009_DepositForKey_RealSignature
    ├── test_ERC3009_DepositForKey_WrongSignature_Reverts
    └── test_ERC3009_DepositForKey_ReplayAttack_Reverts
```

### 3.2 Patrón de firma usado en WAS89

```solidity
// 1. Obtener signer address desde private key
address signer = vm.addr(SIGNER_PRIV);

// 2. Construir digest EIP-712
bytes32 structHash = keccak256(abi.encode(
    TYPEHASH, from, to, value, validAfter, validBefore, nonce
));
bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));

// 3. Firmar con Foundry cheatcode
(uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PRIV, digest);

// 4. Llamar depositForKey con la firma real
marketplace.depositForKey(keyId, signer, amount, validAfter, validBefore, nonce, v, r, s);
```

### 3.3 Casos de cobertura actuales vs deseables

| Caso | Estado |
|---|---|
| Happy path firma válida | ✅ Cubierto |
| Firma de clave incorrecta | ✅ Cubierto |
| Replay attack (nonce reutilizado) | ✅ Cubierto |
| validBefore expirado | ⬜ Pendiente (opcional) |
| validAfter no alcanzado | ⬜ Pendiente (opcional) |
| Fuzz: nonces distintos = depósitos independientes | ⬜ Pendiente (opcional) |

Los 3 casos obligatorios del AC de WAS-89 están cubiertos.

---

## 4. Archivos a modificar/crear

**NINGUNO.** WAS-89 ya está implementado correctamente.

| Archivo | Acción |
|---|---|
| `contracts/test/WasiAIMarketplace.t.sol` | ✅ Ya contiene MockUSDCReal + WAS89_ERC3009SignatureTest |
| `contracts/src/WasiAIMarketplace.sol` | ✅ No tocar — interfaz IERC3009 y depositForKey correctos |
| `contracts/foundry.toml` | ✅ No tocar |

---

## 5. ACs técnicos verificables

| AC | Evidencia | Línea aprox |
|---|---|---|
| MockUSDCReal implementa DOMAIN_SEPARATOR EIP-712 correcto | `constructor()` de MockUSDCReal con `name="USD Coin"`, `version="2"` | test file ~590 |
| `transferWithAuthorization` verifica firma ECDSA real | `ecrecover(digest, v, r, s)` con `signer == from` | test file ~622 |
| Nonce único por dirección | `authorizationState[from][nonce]` con revert en replay | test file ~614 |
| Happy path deposita USDC al contrato | `assertEq(usdcReal.balanceOf(address(marketplace)), amount)` | WAS89 test ~667 |
| Firma inválida revierte | `vm.expectRevert("ERC3009: invalid signature")` | WAS89 test ~685 |
| Replay revierte | `vm.expectRevert("ERC3009: auth already used")` | WAS89 test ~706 |
| Suite completa verde | `forge test` → 138 passed, 0 failed | Verificado en grounding |

---

## 6. Riesgos técnicos

### R1 — DOMAIN_SEPARATOR hardcodea chainId del despliegue (LOW)
MockUSDCReal usa `block.chainid` en el constructor. En Foundry, `block.chainid` default es 31337 (Anvil). Si el test asume Avalanche (43114), el digest no matcheará. **Mitigación:** Tests usan `vm.sign` con el mismo chainId que MockUSDCReal obtuvo en deploy — self-consistent. No es un problema.

### R2 — Private keys en tests (INFO)
`SIGNER_PRIV = 0xac0974...` es el Foundry default account #0, conocido públicamente. **Correcto** para tests. No usar en producción.

### R3 — Casos edge no cubiertos (LOW)
`validAfter` y `validBefore` están en MockUSDCReal pero no hay tests que los ejerciten. Son opcionales para WAS-89 pero recomendables como WAS-89b o en una iteración futura.

### R4 — MockUSDCReal no implementa IERC20 completo (INFO)
No implementa `decimals()`, `name()`, etc. Suficiente para los tests actuales. Si el contrato agrega lógica que use esas funciones, MockUSDCReal necesitará actualizarse.

---

## 7. Conclusión

WAS-89 está **DONE**. Los 3 tests de firma ERC-3009 real fueron implementados previamente y pasan correctamente. Este SDD documenta el estado actual para registro histórico y onboarding de nuevos devs.

```
forge test --match-contract WAS89_ERC3009SignatureTest
# Ran 3 tests: 3 passed, 0 failed ✅
```
