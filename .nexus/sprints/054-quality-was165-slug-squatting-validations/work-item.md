# Story File — SDD #054: selfRegisterAgent — slug squatting + validaciones input
**Sprint TBD | WAS-165**
**Classification: QUALITY**
**Source of truth: this file only. Read every file before modifying.**

## Context

`selfRegisterAgent` en el smart contract no tiene:
1. **Registration fee** — cualquiera puede registrar slugs gratis (spam/squatting)
2. **Max slug length** — strings arbitrariamente largos = storage pollution
3. **Min/max pricePerCall** — no hay validación de rango

El endpoint `/api/v1/agents/register` ya tiene validaciones Zod (slug max 80, price 0.001-100), pero el contrato no las enforce. Un usuario que llame directamente al contrato bypassa estas validaciones.

**Riesgo: MEDIUM** — requiere redeploy del contrato.

## Acceptance Criteria

1. El contrato requiere un `registrationFee` pagado en USDC para `selfRegisterAgent`
2. El contrato enforce `slug.length <= 80`
3. El contrato enforce `pricePerCall >= 1000` (0.001 USDC en atomics) y `pricePerCall <= 100_000_000` (100 USDC)
4. El fee es configurable por el owner (`setRegistrationFee`)
5. El frontend envía el fee junto con la transacción
6. El backend `register/route.ts` Zod validations se mantienen como están
7. Tests del contrato cubren: sin fee, fee insuficiente, slug demasiado largo, price fuera de rango
8. Build pasa sin errores
9. Migration plan documentado

## Wave 1 — Actualizar smart contract

**Archivo:** `contracts/src/WasiAIMarketplace.sol`

Agregar:
```solidity
uint256 public registrationFee; // in USDC atomics (6 decimals)

function setRegistrationFee(uint256 _fee) external onlyOwner {
    registrationFee = _fee;
    emit RegistrationFeeUpdated(_fee);
}

function selfRegisterAgent(
    string calldata slug,
    uint256 pricePerCall,
    uint64 erc8004Id
) external {
    // NA-301: Registration fee
    if (registrationFee > 0) {
        require(
            usdc.transferFrom(msg.sender, address(this), registrationFee),
            "Fee transfer failed"
        );
    }

    // NA-303: Slug length validation
    require(bytes(slug).length > 0 && bytes(slug).length <= 80, "Invalid slug length");

    // NA-304: Price range validation
    require(pricePerCall >= 1000 && pricePerCall <= 100_000_000, "Price out of range");

    // ... existing registration logic
}
```

## Wave 2 — Tests del contrato

**Archivo:** `contracts/test/WasiAIMarketplace.t.sol` (agregar tests)

1. `test_selfRegister_noFee_reverts` — cuando fee > 0 y no se aprueba USDC
2. `test_selfRegister_slugTooLong_reverts` — slug > 80 chars
3. `test_selfRegister_priceTooLow_reverts` — price < 1000
4. `test_selfRegister_priceTooHigh_reverts` — price > 100_000_000
5. `test_selfRegister_withFee_succeeds` — happy path con fee
6. `test_setRegistrationFee_onlyOwner` — non-owner reverts

## Wave 3 — Actualizar frontend

**Archivos a verificar:**
- Componente que llama `selfRegisterAgent` en el frontend
- Agregar `approve(marketplace, registrationFee)` antes de `selfRegisterAgent`
- Mostrar el fee al usuario antes de confirmar

## Wave 4 — Deploy + Migración

1. Deploy nuevo contrato (o upgrade si es proxy)
2. Llamar `setRegistrationFee(1_000_000)` (1 USDC inicial — ajustable)
3. Actualizar `MARKETPLACE_CONTRACT_ADDRESS` en env si es nuevo deploy
4. Verificar que agentes existentes no se vean afectados

## Wave 5 — Commit + Push

```bash
git add -A
git commit -m "fix(NA-301/303/304): selfRegisterAgent fee + slug/price validation [WAS-165]"
git push
```

## Critical Constraints

- Los agentes ya registrados NO se ven afectados
- El fee va al contrato (treasury), no se quema
- `registrationFee` initial value = 0 (backward compatible hasta que owner lo configure)
- El frontend DEBE mostrar el fee antes de que el usuario firme
- Este SDD requiere coordinación con deploy — NO ejecutar sin plan de migración aprobado
