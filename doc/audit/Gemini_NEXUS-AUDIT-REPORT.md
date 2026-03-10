# Reporte de Auditoría Nexus - Smart Contracts WasiAI

**Fecha**: 2026-03-09
**Metodología Utilizada**: [NexusAudit v2.0](https://github.com/ferrosasfp/nexus-audit)
**Objetivo**: `wasiai-v2/contracts/src/`
**Nota**: Como se solicitó, esta auditoría consiste en una revisión empírica del código base centrada en generar un reporte de hallazgos sin crear ni modificar la lógica del código, y sin escribir Pruebas de Concepto (PoCs).

## Resumen

La auditoría se centró en los contratos inteligentes principales: `WasiAIMarketplace.sol` y `WasiEscrow.sol`. Aplicamos rigurosamente el *Modelo de Amenazas TRACE* (Trust, Reentrancy, Access, Calculation, External) junto con las *Reglas Anti-Alucinación* (sin suposiciones tipo "podría potencialmente", solo rutas de ataque concretas).

### Fases de Ejecución Completadas (según Nexus Audit)
- **Fase 0**: Familiarización con el código base (Lectura de contratos).
- **Fase 1**: Evaluación del Modelo de Amenazas TRACE.
- **Fase 2B y 3**: Validación manual de lógica de negocio, controles de acceso e invariantes.
- **Fase 5**: Validación Anti-Alucinación.

*Métodos complementarios aplicados durante la auditoría (por petición explícita del usuario):*
Realizamos una validación de **Matriz de Flujo Contable**. Esta consiste en mapear matemáticamente cada fuente de ingresos de valor (depósitos, tarifas) contra los valores de estado almacenados para verificar la solvencia estricta. Esta es una mejora técnica sobre TRACE (Calculation) enfocándose específicamente en la desviación del "Balance Libre" en contratos de contabilidad.

---

## Hallazgos

### 1. [ALTO] Riesgo de Solvencia Contable en `claimEarnings` por Falta de Verificación de Invariante
- **Categoría**: Calculation / Solvency (Cálculo / Solvencia)
- **Objetivo**: `WasiAIMarketplace.sol` - `claimEarnings()`
- **Anti-Alucinación / Ruta de Ataque**:
  Cuando un operador firma un vale (voucher), la función valida si el contrato tiene suficiente "balance libre" para pagarle al creador:
  `require(usdc.balanceOf(address(this)) - totalKeyBalances >= grossAmount);`
  Sin embargo, este cálculo **omite descontar `totalEarnings`**. Si el contrato tiene `100 USDC` que pertenecen a `totalEarnings` (dinero ya ganado por otros creadores pero aún no retirado), la matemática evaluará como verdadero, permitiendo que `claimEarnings` envíe esos `100 USDC`. 
  Cuando los creadores legítimos llamen posteriormente a `withdraw()`, la transacción revertirá porque el balance real del contrato será `0`.
- **Veredicto**: CONFIRMADO.
- **Tipo de Fix Recomendado**: `H-Calculation`
  Actualizar la verificación de solvencia para deducir `totalEarnings`:
  ```solidity
  require(usdc.balanceOf(address(this)) - totalKeyBalances - totalEarnings >= grossAmount, "WasiAI: insufficient free balance");
  ```

### 2. [MEDIO] Tarifas de Registro Atrapadas en `WasiAIMarketplace`
- **Categoría**: Calculation / Trust (Cálculo / Confianza)
- **Objetivo**: `WasiAIMarketplace.sol` - `selfRegisterAgent()`
- **Anti-Alucinación / Ruta de Ataque**:
  Si la tarifa de registro (`registrationFee`) se establece en `> 0`, los creadores que pagan la tarifa transfieren USDC directamente a `address(this)`:
  `usdc.safeTransferFrom(msg.sender, address(this), registrationFee);`
  Sin embargo, no hay una variable contable que rastree estas tarifas recopiladas (como `totalPlatformShare`), ni existe ninguna función como `skim()` o `withdrawTreasury()` para extraerlas. De hecho, la única forma en que estos fondos pueden salir del contrato es si se desvían de manera no intencionada a través de `claimEarnings` (ya que aumentan el "balance libre"). El protocolo pierde por completo el acceso a sus propios ingresos por registros.
- **Veredicto**: CONFIRMADO.
- **Tipo de Fix Recomendado**: `M-Architecture`
  En lugar de enviar fondos a `address(this)` y eludir el estado contable, enviar la tarifa directamente a la address del treasury (tesoro):
  ```solidity
  usdc.safeTransferFrom(msg.sender, treasury, registrationFee);
  ```

### 3. [BAJO] Falta de Validación de Límites de Precio en `updateAgent`
- **Categoría**: Business Logic / Validation (Lógica de Negocio / Validación)
- **Objetivo**: `WasiAIMarketplace.sol` - `updateAgent()`
- **Anti-Alucinación / Ruta de Ataque**:
  Cuando un usuario se registra a través de `selfRegisterAgent`, hay una validación estricta de precio:
  `require(pricePerCall >= 1000 && pricePerCall <= 100_000_000, "Price out of range");`
  Sin embargo, si el creador luego llama a `updateAgent`, esta validación está completamente ausente. Un creador de agentes puede actualizar su precio a `0` o a `type(uint256).max`, rompiendo la lógica de integración off-chain que asume precios máximos permitidos.
- **Veredicto**: CONFIRMADO.
- **Tipo de Fix Recomendado**: `L-Validation`
  Copiar la restricción o límite desde el registro hacia la función de actualización `updateAgent`:
  ```solidity
  require(newPrice >= 1000 && newPrice <= 100_000_000, "Price out of range");
  ```

---

## Conclusión
La arquitectura de la aplicación es generalmente resiliente a la reentrancia (uso estricto del patrón CEI) y a los abusos de contratos externos. La implementación de `WasiEscrow` protege exitosamente a los usuarios en caso de inactividad de los operadores. Sin embargo, las invariantes matemáticas respecto a la división entre los balances de cuentas internos (`keyBalances`, `earnings`) y los balances de tokens no asignados necesitan atención inmediata para prevenir problemas de solvencia.
