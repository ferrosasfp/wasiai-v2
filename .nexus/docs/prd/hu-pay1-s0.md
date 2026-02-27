# S0 — HU-PAY-1: Soporte Multi-Wallet EVM

> **Estado:** DRAFT — Pendiente HU_APPROVED de Fer
> **Épica:** E-PAY — Pagos & Wallet Experience
> **Prioridad:** P0
> **Creado:** 2026-02-27
> **Autor:** San (PM — BMAD Method v6)

---

## 1. Título y Descripción

**HU-PAY-1: Soporte Multi-Wallet EVM para el flujo de pago x402**

El flujo de pago actual de WasiAI asume que el usuario siempre tiene Core Wallet conectada en Fuji testnet. En la práctica, developers y early adopters usan MetaMask, Rabby, Coinbase Wallet u otras wallets EVM estándar — ninguna de ellas soporta `transferWithAuthorization` (EIP-3009) de la misma forma en que Core lo hace con sus helpers propietarios.

El resultado: el botón "Pay" queda muerto para cualquier usuario que no use Core. No hay error legible, no hay instrucción de qué hacer, no hay switch de red automático.

Esta HU resuelve la compatibilidad EVM completa del flujo de pago: detección de wallet, detección de red, switch automático a Fuji (chainId 43113), y fallback a `approve + transferFrom` estándar ERC-20 cuando EIP-3009 no esté disponible o falle.

---

## 2. User Stories

### Creator

> **Como creator** que publica agentes en WasiAI,
> quiero que mis consumidores puedan pagar con cualquier wallet EVM compatible (MetaMask, Rabby, Coinbase Wallet, Core),
> para no perder ingresos por fricción técnica innecesaria en el checkout.

### Consumer

> **Como consumer** que usa MetaMask o Rabby para interactuar con dApps EVM,
> quiero poder pagar por invocar agentes en WasiAI sin tener que instalar Core Wallet ni cambiar mi wallet habitual,
> para acceder a los agentes del marketplace sin fricción adicional.

### Consumer (red incorrecta)

> **Como consumer** que tiene mi wallet configurada en Ethereum Mainnet o cualquier red distinta a Fuji,
> quiero que WasiAI detecte automáticamente que estoy en la red incorrecta y me ofrezca cambiar a Fuji con un click,
> para no quedarme con el botón "Pay" bloqueado sin entender por qué.

---

## 3. Criterios de Aceptación (ACs)

### AC-1: Detección de wallet conectada
- [ ] Al abrir el modal de pago, el sistema detecta si hay una wallet EVM conectada via wagmi v3
- [ ] Si no hay wallet conectada, se muestra un mensaje claro: "Conecta tu wallet para continuar" con botón de conexión
- [ ] El estado de wallet conectada/desconectada se refleja en tiempo real (sin recargar página)

### AC-2: Detección y switch de red
- [ ] Si la wallet está conectada en una red distinta a Fuji (chainId ≠ 43113), se muestra un banner de advertencia: "Tu wallet está en [nombre de red]. WasiAI requiere Avalanche Fuji Testnet."
- [ ] El banner incluye un botón "Cambiar a Fuji" que ejecuta `wallet_switchEthereumChain` via wagmi/viem
- [ ] Si Fuji no está en la wallet, se ejecuta `wallet_addEthereumChain` para añadirla automáticamente
- [ ] El botón "Pay" permanece deshabilitado (con tooltip explicativo) mientras la red sea incorrecta
- [ ] Después de cambiar a Fuji exitosamente, el botón "Pay" se habilita sin recargar

### AC-3: Flujo de pago con EIP-3009 (MetaMask, Rabby, wallets estándar)
- [ ] El sistema intenta primero el flujo x402 via `transferWithAuthorization` (EIP-3009 / EIP-712 sign)
- [ ] Si la wallet soporta `eth_signTypedData_v4`, se usa la firma EIP-712 estándar (no helpers propietarios de Core)
- [ ] La firma generada es enviada al operador para ejecutar `transferWithAuthorization` on-chain
- [ ] El flujo completo no requiere que el usuario firme una transacción on-chain (gasless para el consumer)

### AC-4: Fallback a approve + transferFrom
- [ ] Si `transferWithAuthorization` falla (por cualquier razón: wallet no compatible, rechazo de firma, timeout), el sistema ofrece fallback automático al flujo estándar ERC-20
- [ ] Fallback flow: usuario firma tx on-chain de `approve(operatorAddress, amount)` → operador ejecuta `transferFrom`
- [ ] El usuario ve claramente cuál camino está tomando (EIP-3009 o approve/transferFrom) y el costo en gas si aplica
- [ ] El fallback no requiere acción extra del usuario más allá de confirmar la tx de approve

### AC-5: UX de error legible
- [ ] Si el usuario rechaza la firma/transacción, se muestra: "Cancelaste la operación. Puedes intentar de nuevo."
- [ ] Si hay error de red o timeout, se muestra mensaje descriptivo con opción de reintentar
- [ ] Nunca se muestra un botón "Pay" que no haga nada al hacer click
- [ ] En estado de carga (firma pendiente / tx en vuelo), el botón muestra spinner y queda deshabilitado

### AC-6: Balance de USDC visible
- [ ] Antes de pagar, el modal muestra el balance de USDC Fuji (`0x5425890298aed601595a70AB815c96711a31Bc65`) de la wallet conectada
- [ ] Si el balance es insuficiente para el pago, el botón "Pay" está deshabilitado con mensaje: "USDC insuficiente. Necesitas X USDC en Fuji."
- [ ] El balance se refresca al cambiar de red o reconectar wallet

### AC-7: Core Wallet sigue funcionando sin regresión
- [ ] El flujo EIP-3009 original para Core Wallet sigue funcionando exactamente igual
- [ ] No hay regresión en el happy path existente
- [ ] Tests existentes del flujo de pago siguen en verde

---

## 4. Scope

### ✅ Qué ENTRA en esta HU

- Detección de chainId y switch automático a Fuji (43113) via wagmi `useSwitchChain` / `wallet_addEthereumChain`
- Soporte de `eth_signTypedData_v4` para EIP-712 en wallets estándar EVM
- Fallback `approve + transferFrom` cuando EIP-3009 no esté disponible
- Mostrar balance USDC Fuji en el modal de pago
- Mensajes de error legibles y accionables para todos los estados de fallo
- Compatibilidad verificada con: MetaMask, Rabby, Coinbase Wallet, Core Wallet

### ❌ Qué NO ENTRA en esta HU

- Soporte de wallets no-EVM (Phantom, Solana, etc.)
- Pagos desde API Key (flujo developer) — eso es independiente
- Deploy en Mainnet — diferido hasta E6
- Account Abstraction / ERC-4337 — prohibido por ADR-005
- Cambio al contrato de WasiAIMarketplace — solo capa de UI/wallet
- Faucet de USDC Fuji dentro de la app — fuera de scope, se linka a faucet externo
- Multi-sig wallets (Gnosis Safe, etc.) — roadmap futuro

---

## 5. Riesgos

| # | Riesgo | Probabilidad | Impacto | Mitigación |
|---|--------|-------------|---------|-----------|
| R1 | `wallet_switchEthereumChain` bloqueado por el browser (popup blocker) | Media | Alto | Documentar que el switch requiere interacción directa del usuario; asegurar que el trigger venga de click humano |
| R2 | MetaMask no soporta `eth_signTypedData_v4` en versiones antiguas | Baja | Alto | Detectar versión/capability antes de intentar; fallback inmediato a approve/transferFrom |
| R3 | EIP-712 domain mismatch entre frontend y contrato | Media | Crítico | Testear con fork de Fuji antes de merge; el domainSeparator debe coincidir exactamente con el contrato `0x71CddCdF8a40951a1d8C22C8774448FbcA089b53` |
| R4 | Race condition: usuario cambia de red mientras la tx está en vuelo | Baja | Alto | Lockear el modal durante tx en progreso; invalidar y mostrar error si chainId cambia mid-flow |
| R5 | Balance USDC stale (dato cacheado, usuario ya gastó) | Media | Medio | Leer balance fresco on-chain en cada apertura de modal; no confiar en cache de más de 30s |
| R6 | Fallback approve/transferFrom genera confusión de UX (gas inesperado) | Alta | Medio | Comunicar claramente antes de ejecutar: "Este camino requiere aprobar una transacción on-chain (pequeño fee de gas)" |
| R7 | wagmi v3 rompe compatibilidad con hooks de wallet usados actualmente | Media | Alto | Auditar hooks existentes antes de implementar; hacer spike técnico en rama aislada |

---

## Dependencias

- **Contrato:** `WasiAIMarketplace` en Fuji `0x71CddCdF8a40951a1d8C22C8774448FbcA089b53` — sin cambios requeridos
- **USDC Fuji:** `0x5425890298aed601595a70AB815c96711a31Bc65` — sin cambios
- **wagmi v3 / viem v2** — ya en el Golden Path
- **No requiere migrations de DB** (cambio solo en capa frontend)

---

## Definición de Hecho (DoD)

- [ ] Todos los ACs verificados manualmente con MetaMask, Rabby y Core Wallet en Fuji
- [ ] Tests unitarios para: detección de red, switch de red, construcción de EIP-712 payload, fallback flow
- [ ] Sin regresión en tests existentes (182/182 en verde)
- [ ] Code review formal completado
- [ ] Adversarial review completado (intentar pagar con red incorrecta, sin balance, rechazando firma)
- [ ] HU_APPROVED explícito de Fer sobre este S0 antes de pasar a S1

---

*Próximo paso: esperar HU_APPROVED de Fer → S1 (Spec técnica) + Implementation Readiness Check*
