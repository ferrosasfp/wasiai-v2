# Deploy Notes — WAS-53 Chainlink Automation

## Contrato desplegado
- Red: Avalanche Fuji (chainId 43113)
- Dirección: 0xa68E0Cb651E589aD38b09539F40D810488dd4565
- Verificado: Sourcify (pendiente — deploy sin --verify por disponibilidad)
- Deploy tx: broadcast/DeployMarketplace.s.sol/43113/run-latest.json

## IMPORTANTE — Alcance de performUpkeep
En esta versión, performUpkeep emite el evento UpkeepPerformed
y actualiza lastUpkeepTimestamp — el settlement REAL sigue
ejecutándose desde el Vercel cron (o manualmente desde el admin panel).
Chainlink Automation demuestra la integración con el sponsor sin
rediseñar el sistema de settlement. Un listener de eventos on-chain
queda fuera de scope para Sprint 7.

## Registro del Upkeep en Chainlink (acción manual de Fer)
1. Ir a https://automation.chain.link
2. Conectar wallet del operador
3. "Register new Upkeep" → Custom logic
4. Contract address: 0xa68E0Cb651E589aD38b09539F40D810488dd4565
5. Gas limit: 200000
6. Funding: mínimo 5 LINK (testnet LINK desde faucet)
7. El Upkeep llamará checkUpkeep cada bloque — ejecutará performUpkeep cuando upkeepNeeded = true

## LINK Faucet Fuji
https://faucets.chain.link/fuji
