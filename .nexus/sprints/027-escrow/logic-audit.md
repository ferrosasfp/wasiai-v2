# Code Review — WAS-72 Escrow (NNN: 027)

**Commit:** `52d5ae8`  
**AR previo:** APPROVED ✅ (0 BLOQUEANTEs, 2 MENOREs)  
**Revisores:** Adversary + QA  
**Fecha:** 2026-03-02  
**Resultado:** ✅ APPROVED

---

## Resumen

El código de WAS-72 está bien estructurado, sigue los patrones establecidos en el codebase y no presenta bloqueantes. Se identifican 3 sugerencias de mejora para iteraciones futuras.

---

## 6 Checks

### ✅ 1. Patrones

**WasiEscrow.sol vs WasiAIMarketplace.sol:**
- Herencia: `Ownable2Step` + `ReentrancyGuard` ✅ (igual que Marketplace)
- `SafeERC20` para transferencias ✅
- Secciones delimitadas con comentarios (`Types`, `State`, `Events`, `Modifiers`, `Core`, `Internal`, `Admin`, `Views`) ✅
- NatSpec en funciones públicas ✅
- Patrón `modifier → function → _internal` ✅

**escrow.ts vs marketplaceClient.ts:**
- Singleton pattern con `_escrowClientInstance` ✅
- `privateKeyToAccount` + `createWalletClient` + `createPublicClient` ✅
- `simulateContract` antes de `writeContract` ✅
- Logger con prefijo `[escrow]` ✅

**Divergencia menor:** `escrow.ts` hardcodea `avalancheFuji` (intencional, Fuji ONLY per spec), mientras `marketplaceClient.ts` usa `getChain()` dinámico. Justificado por la restricción de deploy, pero el patrón difiere.

---

### ✅ 2. Naming

Claro y consistente en todos los archivos:

| Elemento | Nombre | Evaluación |
|----------|--------|-----------|
| Contrato | `WasiEscrow` | ✅ Prefijo `Wasi` consistente |
| Enum | `EscrowStatus` | ✅ PascalCase |
| Struct | `EscrowTx` | ✅ Conciso |
| Eventos | `EscrowCreated/Released/Refunded/Disputed` | ✅ Past tense |
| Funciones | `createEscrow / releaseEscrow / refundEscrow / disputeEscrow` | ✅ CamelCase, verbo+sustantivo |
| TS exports | `createEscrowOnChain / releaseEscrowOnChain / ...` | ✅ Sufijo `OnChain` distingue capa |
| Constante | `RELEASE_TIMEOUT` | ✅ SCREAMING_SNAKE_CASE |

---

### ✅ 3. Complejidad

- **WasiEscrow.sol:** 222 líneas — tamaño razonable para el scope.
- Funciones con responsabilidad única: `createEscrow`, `releaseEscrow`, `refundEscrow`, `disputeEscrow` — cada una hace exactamente una cosa.
- `_release()` extraído como helper interno ✅ (evita duplicación entre `releaseEscrow` y `releaseExpired`).
- `invoke-long/route.ts`: 188 líneas, flujo lineal claro (auth → validate → escrow → DB → dispatch → respond).

---

### ⚠️ 4. Duplicación

**SUGERENCIA:** Las 4 funciones públicas en `escrow.ts` (`createEscrowOnChain`, `releaseEscrowOnChain`, `releaseExpiredOnChain`, `refundEscrowOnChain`) repiten el mismo patrón:

```typescript
const address = getEscrowAddress()
if (!address) { logger.warn(...); return null }
try {
  const { wallet, public: pub, account } = getEscrowClient()
  const { request } = await pub.simulateContract({ ... })
  const txHash = await wallet.writeContract(request)
  logger.info(...)
  return txHash
} catch (err) {
  logger.error(...)
  return null
}
```

Podría extraerse un helper `_callEscrow(functionName, args)` para reducir ~60 líneas duplicadas. No bloqueante, pero reduciría superficie de error en futuras funciones.

---

### ✅ 5. Imports

- `escrow.ts`: `viem`, `viem/accounts`, `viem/chains` — viem v2 ✅. Sin ethers.js ✅.
- `route.ts`: `keccak256`, `encodePacked`, `type Address` de `viem` — viem v2 ✅.
- `EscrowInfoBanner.tsx`: Sin imports externos (componente puramente JSX) ✅.
- No hay imports sin usar en ningún archivo ✅.

---

### ✅ 6. Límites

| Archivo | Líneas | Evaluación |
|---------|--------|-----------|
| `WasiEscrow.sol` | 222 | ✅ Razonable |
| `escrow.ts` | 241 | ✅ Aceptable (4 funciones públicas + ABI) |
| `invoke-long/route.ts` | 188 | ✅ Razonable |
| `EscrowInfoBanner.tsx` | 22 | ✅ Simple y focado |

`EscrowInfoBanner` es un componente presentacional puro, sin estado ni props. Cumple su propósito (informar al usuario sobre el modelo escrow).

**SUGERENCIA:** Si en el futuro se necesita mostrar el timeout real (ej. "hasta 6 horas" para otro agente), añadir prop `timeoutLabel?: string`. Por ahora, para un solo caso de uso, está bien sin props.

**SUGERENCIA:** En `route.ts`, `estimated_completion` se calcula como `now + 24h` hardcodeado. Sería más correcto obtenerlo del contrato (`RELEASE_TIMEOUT`) o de un campo en `agents` (ej. `expected_duration_h`). No bloqueante para testnet, pero a revisar antes de mainnet.

---

## Findings Detallados

| # | Tipo | Archivo | Descripción |
|---|------|---------|-------------|
| 1 | SUGERENCIA | `escrow.ts` | Extraer helper `_callEscrow` para eliminar patrón duplicado ×4 |
| 2 | SUGERENCIA | `EscrowInfoBanner.tsx` | Añadir prop `timeoutLabel` para futura flexibilidad |
| 3 | SUGERENCIA | `invoke-long/route.ts` | `estimated_completion` hardcodeado a 24h — usar dato dinámico antes de mainnet |

---

## Resultado Final

```
✅ APPROVED
0 DEBE CORREGIR
3 SUGERENCIAS
```

El código es sólido, seguro y listo para continuar a F4 (Validación).
