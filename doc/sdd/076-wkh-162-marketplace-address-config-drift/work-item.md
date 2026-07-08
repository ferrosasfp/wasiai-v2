# Work Item — [WKH-162] Config-drift de la address del marketplace (voucher vs server path)

## Resumen
El path de retiro de earnings (`claimEarnings` via voucher EIP-712) y el path server on-chain (`recordInvocation`, `withdrawFor`, `settleKeyBatch`, etc.) resuelven la address del contrato marketplace desde **dos pares de env vars distintos** que hoy coinciden pero no tienen ninguna garantía de coherencia. Si driftan, el `_hashTypedDataV4` del voucher deja de matchear la address real del tx y `claimEarnings` revierte en cadena — los creators no pueden retirar. Además hay un export hardcodeado muerto en `fuji.ts` que es una trampa latente para quien lo reactive por error. Subset urgente y money-safe de WKH-130 (que decide UUPS vs sunset del contrato — fuera de scope acá).

## Sizing
- SDD_MODE: bugfix / mini
- Estimación: S
- Sizing: FAST + AR (Adversarial Review obligatorio por ser money-adjacent / security)
- Branch sugerido: `fix/076-wkh-162-marketplace-address-config-drift`

## F0 — Grounding confirmado (archivo:línea)

### C-1 — Dos fuentes de verdad para la misma address lógica

**Path server on-chain (todo pasa por `getContractAddress()`):**
- `src/lib/contracts/marketplaceClient.ts:57-63` — `getContractAddress()` lee `process.env.MARKETPLACE_CONTRACT_ADDRESS` (single var, sin split por red — se asume que cada deployment de Vercel tiene la env var seteada al valor correcto de SU red activa). Usado por `recordInvocationOnChain`, `registerAgentOnChain`, `updateAgentOnChain`, `withdrawForCreator`, `settleKeyBatchOnChain`, `refundKeyToEarningsOnChain`, `depositForKeyOnChain`, `getKeyBalanceOnChain`, `getPlatformFeeBps`, `getPendingEarnings`, `getKeyOwnerOnChain`, `isAgentRegisteredOnChain`.
- Además, **3 archivos leen `process.env.MARKETPLACE_CONTRACT_ADDRESS` directo, sin pasar por el helper**:
  - `src/app/api/admin/treasury/route.ts:9`
  - `src/app/api/v1/models/[slug]/invoke/route.ts:8`
  - `src/app/api/creator/agents/[slug]/upgrade-onchain/route.ts:91` (verifica que el `receipt.to` del tx coincida con esta address — NG-101 guard)
  - `src/app/api/creator/withdraw/route.ts:223` (solo display, GET informativo)

**Path del voucher EIP-712 (completamente separado):**
- `src/app/api/creator/earnings/voucher/route.ts:111-133` — resuelve `marketplaceAddr` desde `NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET` / `NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI` según `chainId`, y lo usa como `verifyingContract` del dominio EIP-712 que firma el operador (`walletClient.signTypedData`, líneas 127-149).

**Confirmado:** hoy ambos resuelven a `0xC01DEF…` (sin drift live), pero no hay ningún check que lo garantice — son dos lecturas de env independientes, sin helper compartido.

### C-2 — Dead export hardcodeado

- `src/shared/lib/web3/fuji.ts:14` — `export const WASIAI_MARKETPLACE_ADDRESS = '0x3583fb96bAB5DbBDd85CCeA1C4fCE3EfF3249F08'` (Fuji v1.3, valor correcto hoy, pero hardcodeado y sin usar).
- **Evidencia de dead export:** `coverage/shared/lib/web3/fuji.ts.html` reporta **0% statements (0/21), 0% functions, 0% lines** — el archivo entero no se ejecuta en ningún test. No aparece como import en `config.ts`, `client.ts`, `validation.ts`, `useContractRead.ts`, `useContractWrite.ts`, `WasiAIMarketplace.ts` (los módulos web3/contracts más cercanos revisados). No existe `fuji.test.ts` en `src/shared/lib/web3/__tests__/`.
- **Limitación de esta pasada F0:** no tuve tool de grep disponible; la ausencia de importers está corroborada por evidencia indirecta (cobertura 0% + inspección de los módulos candidatos), no por un grep exhaustivo del repo completo. **Bloqueante para Architect/Dev en F2/F3:** correr `grep -rn "WASIAI_MARKETPLACE_ADDRESS" src/` antes de borrar la línea, para confirmar 0 importers vivos.

### Referencias a la misma address en docs/config (no son env vars runtime, no afectan el money-path en sí)
- `sprint-status.yaml:52` → `0x3583fb96bAB5DbBDd85CCeA1C4fCE3EfF3249F08` (Fuji) — **coincide** con `fuji.ts:14` y con `.nexus/project-context.md:37`. No está stale.
- `.nexus/project-context.md:37` → mismo valor Fuji, consistente.
- **Hallazgo adicional (fuera del set original de la HU):** `CLAUDE.md:37` dice contrato mainnet = `0x24be31D0F538C5551c536b09C85907C43c24d062`, mientras `.nexus/project-context.md:36` dice `0x9316E902760f2c37CDA57c8Be01358D890a26276`. Es un drift de **documentación**, no de env vars de runtime — ver Missing Inputs.

### Cómo se testea la config hoy
No encontré ningún test que valide coherencia entre `MARKETPLACE_CONTRACT_ADDRESS` y `NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI/_MAINNET`. Lugar natural para el test de coherencia (C-3): junto a `marketplaceClient.ts` (`src/lib/contracts/__tests__/`) o junto al voucher route, como un test unitario que mockee `process.env` con ambos pares (coherentes / drifted) y aserte comportamiento.

## Acceptance Criteria (EARS)

- AC-1: WHEN `MARKETPLACE_CONTRACT_ADDRESS` difiere (case-insensitive) de `NEXT_PUBLIC_MARKETPLACE_ADDRESS_<red activa>` para la red activa (`NEXT_PUBLIC_CHAIN_ID`), the system SHALL fallar loud (throw al boot, o un check que corra antes de firmar el voucher) en lugar de firmar/permitir un voucher con `verifyingContract` desalineado del server path.
- AC-2: WHILE ambas env vars son coherentes para la red activa, the system SHALL preservar exactamente el comportamiento actual de `claimEarnings` / `withdraw` / voucher — mismo `verifyingContract`, misma address efectiva, sin cambios en el happy path.
- AC-3: WHEN corre el test/check de coherencia (CI o test unitario dedicado), the system SHALL detectar y reportar el drift de forma explícita (test failure / error con mensaje que identifique cuál var y qué valores difieren) — NO SHALL revertir silenciosamente `claimEarnings` en runtime como único síntoma.
- AC-4: IF se borra el dead export `WASIAI_MARKETPLACE_ADDRESS` de `fuji.ts:14`, THEN the system SHALL seguir compilando, tipando y pasando la suite de tests sin imports rotos.
- AC-5: the system SHALL mantener, bajo configuración correcta, que la address usada en las llamadas on-chain del server (`getContractAddress()` / `MARKETPLACE_CONTRACT_ADDRESS`) sea idéntica byte-a-byte a la address usada como `verifyingContract` del voucher EIP-712, para la red activa.

## Scope IN
- `src/lib/contracts/marketplaceClient.ts` (posible coherence-check o ajuste puntual de `getContractAddress()`)
- `src/app/api/creator/earnings/voucher/route.ts:111-133` (resolución de `marketplaceAddr`)
- `src/shared/lib/web3/fuji.ts:14` (borrar `WASIAI_MARKETPLACE_ADDRESS` dead export)
- Nuevo test de coherencia (ubicación sugerida: `src/lib/contracts/__tests__/` o junto al voucher route)
- Referencias directas a `MARKETPLACE_CONTRACT_ADDRESS` que el Architect decida tocar según opción (a) o (b): `admin/treasury/route.ts:9`, `v1/models/[slug]/invoke/route.ts:8`, `upgrade-onchain/route.ts:91`, `creator/withdraw/route.ts:223` — SOLO si la opción elegida en F2 lo requiere

## Scope OUT
- Cualquier cambio a `contracts/` (Solidity) o deploy de contrato nuevo
- Cambiar el valor efectivo de la address del marketplace en cualquier ambiente (Fuji o Mainnet)
- La decisión UUPS-vs-sunset de WKH-130 (EPIC padre)
- Mainnet: cualquier cambio de config o deploy en producción
- Reconciliar el drift de documentación CLAUDE.md vs project-context.md sobre la address mainnet (ver Missing Inputs — es un follow-up, no bloquea esta HU)

## Decisiones técnicas (DT-N)
- DT-1: **Recomendación F1 (a decidir en F2 por Architect): opción (b) — boot/coherence-assert + test**, no opción (a) single-source-of-truth helper. Razón: (b) tiene blast radius mínimo — no toca ningún call-site money-path existente (`getContractAddress()`, el voucher route, ni los 4 archivos que leen `MARKETPLACE_CONTRACT_ADDRESS` directo siguen exactamente igual), solo agrega una validación nueva que falla si algo diverge. (a) requeriría tocar como mínimo 5 archivos (los 4 que leen la env var directa + el voucher route) para que todos deriven de un único resolver, lo cual es más limpio a largo plazo pero es más superficie de cambio en un fix etiquetado money-safe/urgente. Es tradeoff, no verdad absoluta — Architect puede overridear en F2 si concluye que (a) es igual de seguro con un helper suficientemente delgado.
- DT-2: El coherence-check DEBE ejecutar en un punto que corra siempre (import-time del módulo que resuelve la address, o al inicio del handler del voucher) — no puede depender de un cron o de un script manual que alguien se olvide de correr.

## Constraint Directives (CD-N)
- CD-1: PROHIBIDO cambiar el valor efectivo de `MARKETPLACE_CONTRACT_ADDRESS`, `NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI` o `NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET` en ningún ambiente. Este fix es sobre **detección de drift**, no sobre qué address es la "correcta".
- CD-2: PROHIBIDO tocar `contracts/` (Solidity) o hacer cualquier deploy on-chain.
- CD-3: OBLIGATORIO que el coherence-check falle LOUD (excepción / test failure con mensaje explícito) — PROHIBIDO cualquier fallback silencioso que deje pasar un voucher firmado con `verifyingContract` distinto del address real del server path.
- CD-4: PROHIBIDO borrar `WASIAI_MARKETPLACE_ADDRESS` de `fuji.ts:14` sin antes correr `grep -rn "WASIAI_MARKETPLACE_ADDRESS" src/` (o equivalente) y confirmar cero importers vivos — la confirmación de F0 fue por evidencia indirecta (0% coverage), no por grep exhaustivo.
- CD-5: OBLIGATORIO cubrir con test unitario tanto el caso drift (mock env mismatched → falla) como el caso coherente (match → pasa / comportamiento intacto).
- CD-6: PROHIBIDO romper el flujo existente de `withdraw`/`voucher` (AR debe verificar que `claimEarnings` sigue funcionando end-to-end con la config actual, ya coherente).

## Missing Inputs
- [NEEDS CLARIFICATION] [no bloqueante] (a) vs (b) para C-1 — recomiendo (b) por menor blast radius (ver DT-1). Architect decide en F2 y puede overridear con justificación.
- [NEEDS CLARIFICATION] [no bloqueante] Confirmar ausencia total de importers de `WASIAI_MARKETPLACE_ADDRESS` vía grep exhaustivo antes de borrar (CD-4) — F0 solo tuvo evidencia indirecta.
- [NEEDS CLARIFICATION] [no bloqueante, follow-up separado] `CLAUDE.md:37` (mainnet `0x24be31D0…`) vs `.nexus/project-context.md:36` (mainnet `0x9316E902…`) — drift de documentación detectado en F0, fuera de scope de WKH-162 pero digno de un ticket propio (riesgo de que alguien copie el valor incorrecto a mano en el futuro).

## Análisis de paralelismo
- Es un subset urgente de WKH-130 (EPIC UUPS-vs-sunset) pero NO bloquea ni es bloqueado por esa decisión — el coherence-check es independiente del valor final de la address.
- Puede correr en paralelo con cualquier HU que no toque `marketplaceClient.ts`, `creator/earnings/voucher/route.ts` o `shared/lib/web3/fuji.ts`.
- No bloquea ninguna otra HU activa conocida en `doc/sdd/_INDEX.md`.
