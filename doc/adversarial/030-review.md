# Adversarial Review — NNN-030 / WAS-118 `refundExpired()`

**Fecha:** 2026-03-03  
**Reviewer:** Adversary (NexusAgil QUALITY)  
**Veredicto:** ✅ APROBADO — Sin bloqueantes

---

## Checklist AR

| # | Criterio | Estado | Evidencia |
|---|----------|--------|-----------|
| 1 | **CEI pattern** — `e.status = Refunded` ANTES de `safeTransfer` | ✅ OK | `WasiEscrow.sol:176` — effect en línea 176, interaction en 177 |
| 2 | **nonReentrant** — presente en `refundExpired()` | ✅ OK | `WasiEscrow.sol` — modifier en firma de función |
| 3 | **Trustless** — sin `onlyOperator` ni restricción de address | ✅ OK | Función `external` pura, cualquier address puede llamarla |
| 4 | **Timeout correcto** — usa `RELEASE_TIMEOUT` (no hardcoded 24h) | ✅ OK | `block.timestamp >= escrows[escrowId].createdAt + RELEASE_TIMEOUT` |
| 5 | **No toca existentes** — `releaseExpired()` y `refundEscrow()` intactos | ✅ OK | Ambas funciones en líneas 146 y 184 sin modificaciones |
| 6 | **Tests completos** — 3 tests: happy path stranger, before 24h revert, double-refund revert | ✅ OK | `test_RefundExpired_After24h_ByStranger`, `test_RefundExpired_Before24h_Reverts`, `test_RefundExpired_AlreadyRefunded_Reverts` |
| 7 | **forge test** — 151 tests pasan, 0 fallos | ✅ OK | `151 tests passed, 0 failed, 0 skipped` |

---

## Análisis de seguridad

### Reentrancy
- `nonReentrant` presente ✅
- CEI respetado: estado actualizado antes de transferencia ✅
- Doble defensa correcta

### Trustless design
- Sin `onlyOperator` — cualquier address puede ejecutar el refund tras el timeout
- Consistente con el principio de que el sistema no depende de un operador activo
- El payer siempre recibe los fondos, no el caller → no hay incentivo perverso

### Timeout
- Usa `RELEASE_TIMEOUT` (constante definida en el contrato)
- Test usa `25 hours` para garantizar que supera el timeout
- Test "before 24h" no hace warp → `block.timestamp < createdAt + RELEASE_TIMEOUT` ✅

### Función vs existentes
- `releaseExpired()` (línea 146): trustless release al provider — **intacta**
- `refundEscrow()` (línea 184): operador devuelve al payer — **intacta**
- `refundExpired()`: nueva función trustless complementaria — no hay conflicto

---

## Observaciones menores (no bloqueantes)

- **MENOR:** El evento `EscrowRefunded` ya existía (usado también en `refundEscrow`). Compartir el mismo evento es correcto y consistente. Sin acción requerida.
- **MENOR:** El comentario NatDoc podría mencionar explícitamente que es trustless (`@notice Anyone can call after timeout expires`). Cosmético.

---

## Conclusión

Implementación limpia y segura. Todos los criterios de seguridad críticos se cumplen:
- Doble protección anti-reentrancy (CEI + nonReentrant)
- Diseño trustless sin privilegios innecesarios
- Suite de tests exhaustiva con 3 casos de borde
- 151 tests pasan sin regresiones

**APROBADO para merge.**
