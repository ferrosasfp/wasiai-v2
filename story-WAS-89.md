# Story WAS-89 — Tests MockUSDC firma ERC-3009

**NNN:** 023  
**Modo:** QUALITY  
**Estado:** ✅ DONE — Tests ya implementados y pasando  
**Suite:** 138 tests, 0 fallos

---

## ⚠️ Aviso para el Dev

**WAS-89 ya está implementado.** Este story file existe para documentación y para que cualquier dev que quiera extender la cobertura sepa exactamente qué existe y cómo funciona.

Si necesitas agregar más casos de test ERC-3009, sigue el patrón documentado abajo.

---

## Archivos

### ✅ NO tocar

```
contracts/src/WasiAIMarketplace.sol    — contrato correcto, no modificar
contracts/foundry.toml                  — configuración correcta
```

### 📂 Archivo con los tests ERC-3009

```
contracts/test/WasiAIMarketplace.t.sol
```

Los tests de WAS-89 están al final del archivo, después del comentario:

```solidity
// ─────────────────────────────────────────────────────────────────────────────
// WAS-89: Real ERC-3009 signature tests
```

---

## Qué existe (clases y contratos)

### MockUSDC (línea ~11)
MockUSDC sin verificación de firma. Usado por los ~135 tests de lógica de negocio.
**No modificar.** Los tests de negocio no deben depender de ECDSA.

```solidity
// MockUSDC ignora firma intencionalmente — correcto para tests de negocio
function transferWithAuthorization(
    address from, address to, uint256 value,
    uint256, uint256, bytes32, uint8, bytes32, bytes32
) external {
    require(balanceOf[from] >= value, "MockUSDC: insufficient balance for auth");
    balanceOf[from] -= value;
    balanceOf[to]   += value;
}
```

### MockUSDCReal (línea ~572)
Implementación ERC-3009 con ECDSA real. Usada exclusivamente por `WAS89_ERC3009SignatureTest`.

```solidity
contract MockUSDCReal {
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)");

    bytes32 public immutable DOMAIN_SEPARATOR;  // EIP-712, name="USD Coin", version="2"
    mapping(address => mapping(bytes32 => bool)) public authorizationState;  // nonce anti-replay

    function transferWithAuthorization(
        address from, address to, uint256 value,
        uint256 validAfter, uint256 validBefore, bytes32 nonce,
        uint8 v, bytes32 r, bytes32 s
    ) external {
        // 1. Valida timestamps
        require(block.timestamp > validAfter,  "ERC3009: auth not yet valid");
        require(block.timestamp < validBefore, "ERC3009: auth expired");
        // 2. Valida nonce único
        require(!authorizationState[from][nonce], "ERC3009: auth already used");
        // 3. Verifica firma ECDSA
        bytes32 structHash = keccak256(abi.encode(TYPEHASH, from, to, value, validAfter, validBefore, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0) && signer == from, "ERC3009: invalid signature");
        // 4. Transfiere
        authorizationState[from][nonce] = true;
        balanceOf[from] -= value;
        balanceOf[to]   += value;
    }
}
```

### WAS89_ERC3009SignatureTest (línea ~638)
Suite de 3 tests. Usa `MockUSDCReal` y la private key de Foundry default #0.

---

## Tests implementados

### Test 1: Happy path — firma válida

```solidity
function test_ERC3009_DepositForKey_RealSignature() public {
    address signer = vm.addr(SIGNER_PRIV);  // addr del pk default #0
    uint256 amount = 1_000_000;             // $1.00 USDC
    usdcReal.mint(signer, amount);

    uint256 validAfter  = 0;
    uint256 validBefore = type(uint256).max;
    bytes32 nonce       = keccak256("was89-nonce-1");

    bytes32 digest = _buildDigest(signer, address(marketplace), amount, validAfter, validBefore, nonce);
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PRIV, digest);  // ← Foundry cheatcode

    vm.prank(operator);
    marketplace.depositForKey(KEY_REAL, signer, amount, validAfter, validBefore, nonce, v, r, s);

    assertEq(marketplace.getKeyBalance(KEY_REAL), amount);   // key on-chain
    assertEq(marketplace.keyOwners(KEY_REAL), signer);       // owner registrado
    assertEq(usdcReal.balanceOf(address(marketplace)), amount); // USDC transferido
    assertEq(usdcReal.balanceOf(signer), 0);                 // saldo del user vaciado
}
```

### Test 2: Firma inválida — private key incorrecta

```solidity
function test_ERC3009_DepositForKey_WrongSignature_Reverts() public {
    address signer  = vm.addr(SIGNER_PRIV);
    uint256 wrongPriv = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d; // pk #1

    // Se construye el digest para `signer` pero se firma con `wrongPriv`
    bytes32 digest = _buildDigest(signer, address(marketplace), amount, ...);
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongPriv, digest);  // firma incorrecta

    vm.prank(operator);
    vm.expectRevert("ERC3009: invalid signature");
    marketplace.depositForKey(KEY_REAL, signer, amount, ...);
}
```

### Test 3: Replay attack — nonce reutilizado

```solidity
function test_ERC3009_DepositForKey_ReplayAttack_Reverts() public {
    bytes32 nonce = keccak256("was89-replay-nonce");
    // ... firma con la misma nonce ...

    // Primer depósito: ok
    vm.prank(operator);
    marketplace.depositForKey(KEY_REAL, signer, amount, validAfter, validBefore, nonce, v, r, s);

    // Segundo depósito con la misma nonce: debe revertir
    vm.prank(operator);
    vm.expectRevert("ERC3009: auth already used");
    marketplace.depositForKey(
        bytes32(uint256(KEY_REAL) + 1),  // keyId diferente, misma nonce
        signer, amount, validAfter, validBefore, nonce, v, r, s
    );
}
```

---

## Cómo agregar más tests ERC-3009 (si se necesita)

Patrón base — copiar y adaptar:

```solidity
function test_ERC3009_TuCasoNuevo() public {
    address signer = vm.addr(SIGNER_PRIV);
    uint256 amount = /* tu monto */;
    usdcReal.mint(signer, amount);

    uint256 validAfter  = /* 0 o block.timestamp - 1 */;
    uint256 validBefore = /* type(uint256).max o block.timestamp + 1 hours */;
    bytes32 nonce       = keccak256("nombre-unico-para-este-test");

    bytes32 digest = _buildDigest(signer, address(marketplace), amount, validAfter, validBefore, nonce);
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PRIV, digest);

    vm.prank(operator);
    marketplace.depositForKey(KEY_REAL, signer, amount, validAfter, validBefore, nonce, v, r, s);

    // Tus asserts aquí
}
```

### Casos pendientes (opcionales para WAS-89b):

```solidity
// validBefore en el pasado → "ERC3009: auth expired"
function test_ERC3009_ExpiredAuthorization_Reverts() public {
    vm.warp(1000);
    uint256 validBefore = 999; // ya expiró
    // ... build digest, sign, expectRevert("ERC3009: auth expired")
}

// validAfter en el futuro → "ERC3009: auth not yet valid"
function test_ERC3009_NotYetValid_Reverts() public {
    uint256 validAfter = block.timestamp + 1 hours; // aún no válido
    // ... build digest, sign, expectRevert("ERC3009: auth not yet valid")
}
```

---

## Cómo verificar

```bash
cd contracts/

# Solo WAS-89
/home/ferdev/.foundry/bin/forge test --match-contract WAS89_ERC3009SignatureTest -v

# Suite completa (debe ser 138 passed, 0 failed)
/home/ferdev/.foundry/bin/forge test
```

Resultado esperado:
```
Ran 3 tests for test/WasiAIMarketplace.t.sol:WAS89_ERC3009SignatureTest
[PASS] test_ERC3009_DepositForKey_RealSignature() (gas: 167696)
[PASS] test_ERC3009_DepositForKey_ReplayAttack_Reverts() (gas: 193083)
[PASS] test_ERC3009_DepositForKey_WrongSignature_Reverts() (gas: 71188)
Suite result: ok. 3 passed; 0 failed
```

---

## Qué NO tocar

- `contracts/src/WasiAIMarketplace.sol` — el contrato está correcto
- `MockUSDC` — no agregar verificación de firma, es deliberadamente un mock
- `foundry.toml` — no modificar
- Cualquier test existente fuera de `WAS89_ERC3009SignatureTest`

---

**Resultado final:** WAS-89 DONE. No hay código que escribir.
