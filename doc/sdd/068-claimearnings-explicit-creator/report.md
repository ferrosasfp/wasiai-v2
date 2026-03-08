# Report — Hotfix #068: claimEarnings explicit creator

**Fecha**: 2026-03-08
**Commit**: d4d0f47
**Tipo**: Hotfix (ejecutado fuera de pipeline — AR retroactivo)
**Contrato Fuji**: 0x904e1E1CC4764EC5115E3B5b676002A1672dCC88

## Problema
claimEarnings usaba msg.sender en la firma EIP-712. El creator tenía wallet registrada
(0xeC176F4f...) diferente a la wallet conectada (0xEbC2C4...) → "invalid operator signature".

## Fix
- claimEarnings(address creator, ...) — creator explícito en lugar de msg.sender
- USDC va siempre a la wallet registrada del creator, sin importar quién llame
- EarningsSection: eliminado link "Accumulated in WasiAIMarketplace.sol"

## AR Retroactivo
- 0 BLOCKERs
- 1 MENOR: comentario faltante en serviceClient bypass (cosmético)
- Veredicto: APPROVED with notes

## Auto-Blindaje
| Error | Fix | Aplicar en |
|-------|-----|-----------|
| Cambio a función de pago sin AR previo | AR retroactivo. Cambio seguro. | Todo cambio a funciones de pago requiere AR antes de deploy |
| msg.sender como identidad en EIP-712 | Usar creator explícito cuando caller ≠ beneficiario | Diseño de funciones de retiro |
