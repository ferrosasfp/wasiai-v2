# S0 — HU-6.2: Deploy Contrato en Mainnet Avalanche C-Chain

**Epic:** E6 — Mainnet Avalanche  
**Sprint:** 5  
**Prioridad:** P0 (Build Games crítico)  
**Estimado:** 3–4 días  
**Estado:** PENDING_HU_APPROVED

---

## Historia de Usuario

Como operator de WasiAI,  
quiero tener el contrato `WasiAIMarketplace` deployado en Avalanche C-Chain mainnet (43114),  
para que los pagos entre creators y consumers sean reales y WasiAI califique como "producto en producción" en el Build Games de Avalanche.

---

## Contexto y Motivación

Actualmente el contrato solo existe en Fuji (testnet). Para el Build Games:
- Los jueces evalúan proyectos **en mainnet** — Fuji no cuenta como producto real
- Sin mainnet, los agentes registrados son "de juguete"
- HU-6.2 desbloquea: onboarding de creators reales con USDC real, volume on-chain visible para jueces

**Contrato actual Fuji:** `0x71CddCdF8a40951a1d8C22C8774448FbcA089b53`  
**Operator wallet:** `0x2dd1Bd5D69Fe05205C0eecB9e22Bc8Ec99eE7aaB`  
**USDC Mainnet:** `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E`

---

## Criterios de Aceptación (ACs)

### AC1 — Deploy del contrato en mainnet
- [ ] `WasiAIMarketplace.sol` deployado en C-Chain mainnet (chainId 43114)
- [ ] Constructor inicializado con: `usdcToken = USDC_MAINNET`, `operatorWallet = OPERATOR_WALLET`, `treasury = TREASURY`, `platformFeePercent = 10`
- [ ] Dirección del contrato guardada en `MARKETPLACE_ADDRESS_MAINNET` en Vercel env vars
- [ ] Contrato verificado en Snowtrace (sourcify o etherscan-compatible)

### AC2 — Operator wallet fondeado con AVAX real
- [ ] `0x2dd1Bd5D69Fe05205C0eecB9e22Bc8Ec99eE7aaB` tiene ≥ 0.5 AVAX en mainnet para gas
- [ ] Balance monitoreado antes del deploy: si < 0.1 AVAX → alerta en logs

### AC3 — Variables de entorno separadas por red
- [ ] `NEXT_PUBLIC_CHAIN_NAME=mainnet` en producción (`fuji` en desarrollo)
- [ ] `MARKETPLACE_ADDRESS_MAINNET` — solo se usa cuando `CHAIN_NAME=mainnet`
- [ ] `MARKETPLACE_ADDRESS_FUJI` — sigue existiendo para dev/test
- [ ] `.env.example` actualizado con ambas vars
- [ ] **NUNCA** la dirección hardcodeada — siempre desde env var vía `@/lib/chain`

### AC4 — Selección de red en runtime
- [ ] `@/lib/chain.ts` retorna la dirección correcta según `CHAIN_NAME`
- [ ] Si `CHAIN_NAME=mainnet` y `MARKETPLACE_ADDRESS_MAINNET` vacío → error explícito al arrancar (no silencioso)
- [ ] Frontend muestra "Avalanche Mainnet" en el badge de red cuando está en mainnet

### AC5 — Registro de agentes existentes en mainnet
- [ ] Al menos 1 agente demo registrado on-chain en mainnet (puede ser el propio agente de Fer)
- [ ] `registerAgent()` en mainnet funciona: transaction hash visible en Snowtrace

### AC6 — Forge tests pasan antes del deploy
- [ ] `forge test` sin failures antes del deploy
- [ ] Script `DeployMarketplace.s.sol` ejecutado con `--broadcast` en mainnet
- [ ] Hash de la tx de deploy guardado en `.nexus/docs/architecture/mainnet-deploy.md`

---

## Scope (qué SÍ incluye)

- Deploy del contrato en mainnet
- Actualización de `@/lib/chain.ts` para soportar mainnet address
- Fondeo del operator wallet
- Verificación en Snowtrace
- Actualización de env vars en Vercel
- Registro mínimo de 1 agente en mainnet para validar flujo completo

## Out of Scope

- **HU-6.3** — Migración masiva de agentes demo a mainnet (Sprint siguiente)
- **HU-6.4** — Monitoring automático del operator wallet (Sprint siguiente)
- Auditoría de seguridad externa (HU-6.1 / HU-8.1 — pre-producción masiva)
- Cambio del flujo de pagos x402 (ya funciona, misma lógica)

---

## Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| AVAX insuficiente para gas del deploy | Media | Alto | Verificar balance antes. Deploy cuesta ~0.05–0.1 AVAX |
| Dirección USDC mainnet incorrecta | Baja | Crítico | Verificar `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` en Snowtrace antes del deploy |
| Variables de entorno mal configuradas en Vercel | Media | Alto | Checklist explícito: CHAIN_NAME + MARKETPLACE_ADDRESS_MAINNET |
| Contrato no verificado → jueces no pueden auditar | Media | Medio | Usar `forge verify-contract` o Sourcify post-deploy |
| Re-deploy accidental sobreescribiendo mainnet | Baja | Alto | Script idempotente — verificar que no existe contrato en la dirección antes |

---

## Dependencias

- `contracts/src/WasiAIMarketplace.sol` — versión Fuji como base (sin cambios de lógica)
- `AVAX real` en operator wallet `0x2dd1...` 
- `USDC mainnet` en treasury/consumer wallets para testing post-deploy
- Foundry instalado en entorno de dev

---

## Artefactos de Salida

- Dirección mainnet del contrato (en `.nexus/docs/architecture/mainnet-deploy.md`)
- Link Snowtrace verificado
- `.env.example` actualizado
- Confirmación de al menos 1 agente registrado on-chain en mainnet

---

**Estado:** PENDING_HU_APPROVED  
**Requiere aprobación explícita de Fer antes de pasar a S1.**
