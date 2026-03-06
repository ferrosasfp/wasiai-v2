# Work Item #004 — HU-7.3: AgentKit Example (Coinbase)

| Campo | Valor |
|-------|-------|
| **#** | 004 |
| **Linear** | WAS-42 |
| **Tipo** | feature |
| **SDD_MODE** | full |
| **Objetivo** | Crear un agente de ejemplo usando Coinbase AgentKit que invoque un agente de WasiAI y pague con x402 automáticamente. Diferenciador clave del hackathon: "agente que paga a agente". Vive en wasiai-agents repo o en x402-quickstart. |
| **Reglas de negocio** | El agente AgentKit debe tener su propia wallet (CDP). Al invocar un agente WasiAI debe pagar automáticamente en USDC Fuji sin intervención humana. Debe funcionar con los 5 agentes DeFi Risk ya existentes. El ejemplo debe ser reproducible por un developer en <10 minutos. |
| **Scope IN** | Script/agente AgentKit en repo wasiai-agents (nuevo archivo). Documentación de setup en README. Funciona en Fuji testnet. |
| **Scope OUT** | Mainnet. UI en wasiai-v2. Modificar agentes existentes. |

## Acceptance Criteria

| # | AC | Formato EARS |
|---|---|---|
| 1 | WHEN se ejecuta el agente AgentKit, THE agente SHALL obtener su wallet CDP automáticamente | |
| 2 | WHEN el agente invoca wasi-defi-sentiment con un token address, THE agente SHALL pagar $0.05 USDC automáticamente vía x402 | |
| 3 | WHEN el pago es exitoso, THE agente SHALL recibir el resultado del análisis y mostrarlo en consola | |
| 4 | WHEN se siguen las instrucciones del README, THE developer SHALL poder correr el ejemplo en <10 minutos | |
| 5 | IF el saldo USDC es insuficiente, THEN THE agente SHALL mostrar error claro con instrucciones de fondeo | |
