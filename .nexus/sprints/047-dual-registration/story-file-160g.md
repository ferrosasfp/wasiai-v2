# Story File — WAS-160g: selfRegisterAgent() en contrato

> SDD: doc/sdd/047-dual-registration/sdd.md
> Fecha: 2026-03-05
> Branch: feat/047-dual-registration

---

## Goal

Agregar la función `selfRegisterAgent()` al contrato WasiAIMarketplace.sol para que un creator pueda registrar su agente on-chain directamente desde su wallet, pagando gas. `registerAgent()` (onlyOperator) se mantiene intacta para el flujo AgentKit/server-side.

## Acceptance Criteria (EARS)

1. WHEN un creator llama `selfRegisterAgent(slug, pricePerCall, erc8004Id)`, THE contrato SHALL registrar el agente con `creator = msg.sender` y emitir `AgentRegistered`.
2. IF el slug ya está tomado, THEN THE contrato SHALL revertir con "WasiAI: slug taken".
3. IF el slug está vacío, THEN THE contrato SHALL revertir con "WasiAI: empty slug".
4. WHILE el contrato está pausado, THE función `selfRegisterAgent` SHALL revertir (whenNotPaused).
5. WHEN `selfRegisterAgent` se ejecuta exitosamente, THE agente registrado SHALL tener `active = true` y los campos correctos en el struct Agent.

## Files to Modify/Create

| # | Archivo | Acción | Qué hacer | Exemplar |
|---|---------|--------|-----------|----------|
| 1 | `contracts/src/WasiAIMarketplace.sol` | Modificar | Agregar función `selfRegisterAgent()` después de `registerAgent()` | `registerAgent()` en el mismo archivo |
| 2 | `contracts/test/WasiAIMarketplace.t.sol` | Modificar | Agregar 5 tests para `selfRegisterAgent` | `test_RegisterAgent*` en el mismo archivo |

## Exemplars

### Exemplar 1: registerAgent()
**Archivo**: `contracts/src/WasiAIMarketplace.sol`
**Usar para**: Archivo #1
**Patrón clave**:
- Validación: `require(bytes(slug).length > 0)`, `require(agents[slug].creator == address(0))`
- Struct assignment: `agents[slug] = Agent({ ... })`
- Evento: `emit AgentRegistered(slug, creator, pricePerCall, erc8004Id)`

### Exemplar 2: test_RegisterAgent*
**Archivo**: `contracts/test/WasiAIMarketplace.t.sol`
**Usar para**: Archivo #2
**Patrón clave**:
- `vm.prank(actor)` para simular caller
- `marketplace.getAgent(SLUG)` para verificar struct
- `vm.expectRevert("mensaje")` para revert tests
- `assertEq`, `assertTrue` para assertions

## Constraint Directives

### OBLIGATORIO
- `creator = msg.sender` — NO como parámetro (evita registrar a nombre de otro)
- `whenNotPaused` modifier
- Mismo evento `AgentRegistered` que usa `registerAgent()`
- Mismas validaciones de slug (empty, taken)
- Tests con `vm.prank(creator)` — NO con operator

### PROHIBIDO
- NO modificar `registerAgent()` existente
- NO agregar `nonReentrant` (no hay transfers, no hay reentrancy risk)
- NO agregar `onlyOperator` (el punto es que cualquiera puede llamarla)
- NO agregar nuevos modifiers o access control
- NO agregar `lastOperatorActivity` update (no es operación del operator)
- NO agregar dependencias nuevas al contrato

## Test Expectations

| Test | ACs que cubre | Framework | Tipo |
|------|--------------|-----------|------|
| `test_SelfRegisterAgent` | AC1, AC5 | Foundry | unit |
| `test_SelfRegisterAgent_SlugTaken` | AC2 | Foundry | unit |
| `test_SelfRegisterAgent_EmptySlug` | AC3 | Foundry | unit |
| `test_SelfRegisterAgent_WhenPaused` | AC4 | Foundry | unit |
| `test_SelfRegisterAgent_EmitsEvent` | AC1 | Foundry | unit |

## Waves

### Wave 0 (Serial Gate)
- [ ] W0.1: Leer `registerAgent()` y el struct `Agent` en WasiAIMarketplace.sol

### Wave 1 (Implementación)
- [ ] W1.1: Agregar `selfRegisterAgent()` en WasiAIMarketplace.sol → Archivo #1 → Exemplar 1
- [ ] W1.2: Agregar 5 tests → Archivo #2 → Exemplar 2

### Wave 2 (Verificación)
- [ ] W2.1: `forge build` — compila sin errores
- [ ] W2.2: `forge test` — todos los tests pasan (nuevos + existentes)

### Verificación Incremental

| Wave | Verificación al completar |
|------|--------------------------|
| W0 | Contexto entendido |
| W1 | `forge build` pasa |
| W2 | `forge test` — 0 failures |

## Out of Scope

- `registerAgent()` — NO tocar
- Otros archivos del contrato
- ABI en `src/lib/contracts/WasiAIMarketplace.ts` (se actualiza en sub-HU posterior)
- Frontend, backend, migrations

## Escalation Rule

> Si algo no está en este Story File, Dev PARA y pregunta a Architect.

---

*Story File generado por NexusAgil — F2.5*
