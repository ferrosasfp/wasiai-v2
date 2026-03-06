# Story File #004 — WAS-42: AgentKit Example (Coinbase)
> Generado por Architect · SPEC_APPROVED · 2026-03-01
> Dev SOLO lee este archivo. No consultar SDD ni Work Item.

---

## Goal
Crear un agente autónomo en `wasiai-agents/agents/agentkit-example/` que use `@coinbase/agentkit` para obtener una wallet CDP, descubra el agente `wasi-defi-sentiment` en el catálogo WasiAI, pague automáticamente vía x402, e imprima el resultado. "Agente pagando a agente" — diferenciador del hackathon Avalanche Build Games.

---

## Acceptance Criteria (EARS)

| # | AC |
|---|---|
| AC1 | WHEN se ejecuta el agente, THE agente SHALL obtener su wallet CDP automáticamente via AgentKit sin intervención humana |
| AC2 | WHEN el agente invoca `wasi-defi-sentiment`, THE agente SHALL detectar el precio real del agente vía catálogo WasiAI y pagar ese monto en USDC automáticamente vía x402 |
| AC3 | WHEN el pago es exitoso, THE agente SHALL recibir el resultado de análisis DeFi y mostrarlo en consola con formato pro |
| AC4 | WHEN se siguen las instrucciones del README (asumiendo Node.js ≥20 instalado y USDC Fuji disponible), THE developer SHALL poder correr el ejemplo en <10 minutos |
| AC5 | IF el saldo USDC es insuficiente, THEN THE agente SHALL mostrar error claro con URL del faucet |
| AC6 | WHEN se ejecuta por primera vez, THE README SHALL incluir instrucciones completas para fondear la wallet CDP con USDC Fuji |

---

## Files to Create

| Archivo | Acción | Exemplar |
|---|---|---|
| `wasiai-agents/package.json` | CREAR | nuevo (root monorepo mínimo) |
| `wasiai-agents/.gitignore` | CREAR | estándar Node |
| `wasiai-agents/agents/agentkit-example/package.json` | CREAR | `wasiai-v2/examples/agentkit-demo/package.json` |
| `wasiai-agents/agents/agentkit-example/tsconfig.json` | CREAR | `wasiai-v2/examples/agentkit-demo/tsconfig.json` |
| `wasiai-agents/agents/agentkit-example/.env.example` | CREAR | nuevo |
| `wasiai-agents/agents/agentkit-example/src/index.ts` | CREAR | `wasiai-v2/examples/agentkit-demo/src/index.ts` |
| `wasiai-agents/agents/agentkit-example/src/wallet.ts` | CREAR | adaptado — usa CDP en vez de privateKey manual |
| `wasiai-agents/agents/agentkit-example/src/catalog.ts` | COPIAR | `wasiai-v2/examples/agentkit-demo/src/catalog.ts` sin cambios |
| `wasiai-agents/agents/agentkit-example/src/pay.ts` | COPIAR | `wasiai-v2/examples/agentkit-demo/src/pay.ts` sin cambios |
| `wasiai-agents/agents/agentkit-example/src/invoke.ts` | COPIAR | `wasiai-v2/examples/agentkit-demo/src/invoke.ts` sin cambios |
| `wasiai-agents/agents/agentkit-example/src/logger.ts` | COPIAR | `wasiai-v2/examples/agentkit-demo/src/logger.ts` sin cambios |
| `wasiai-agents/agents/agentkit-example/README.md` | CREAR | nuevo — instrucciones completas |

---

## Exemplars (código real a seguir)

### Patrón index.ts (de agentkit-demo/src/index.ts)
```typescript
// Estructura a seguir — exactamente este orden:
// 1. validateEnv([...vars requeridas])
// 2. initWallet(...)  →  aquí cambia: usar CDP en vez de private key
// 3. Pre-check balance USDC
// 4. getCatalogAgent(baseUrl, slug)
// 5. signERC3009Payment(...)
// 6. invokeAgent(...)
// 7. log.summary(...)
```

### wallet.ts — diferencia clave vs exemplar
El exemplar usa `privateKeyToAccount(pk)`. Esta versión usa `@coinbase/agentkit`:
```typescript
import { CdpWalletProvider } from '@coinbase/agentkit'

// CDP wallet — efímera (no persistida), se genera nueva en cada ejecución
// Esto es correcto para un ejemplo de demo
const provider = await CdpWalletProvider.configureWithWallet({
  apiKeyId:     process.env.CDP_API_KEY_ID!,
  apiKeySecret: process.env.CDP_API_KEY_SECRET!,
  networkId:    'base-sepolia', // CDP usa su propia red para el wallet
})
// Luego extraer el private key del provider para usarlo con viem en Fuji
// (CDP wallet para identidad, viem para signing ERC-3009 en Avalanche Fuji)
```

> **Nota para Dev:** CDP crea la wallet en su red interna. Para firmar ERC-3009 en Avalanche Fuji necesitamos el private key subyacente del CDP wallet + viem. Investigar cómo CdpWalletProvider expone el account/private key para usarlo con viem. Si no lo expone directamente, usar `AgentKit` con `getDefaultAddress()` para obtener la dirección y firmar vía `agent.wallet.signTypedData(...)`.

---

## .env.example

```env
# Coinbase Developer Platform (CDP)
CDP_API_KEY_ID=your-cdp-api-key-id
CDP_API_KEY_SECRET=your-cdp-api-key-secret

# Avalanche Fuji
CHAIN_ID=43113
RPC_URL=https://api.avax-test.network/ext/bc/C/rpc

# WasiAI
WASIAI_API_BASE_URL=https://wasiai-v2.vercel.app
TARGET_AGENT_SLUG=wasi-defi-sentiment
WASIAI_CONTRACT_ADDRESS=0x9d8Eb04Df6Bd271491Bcdbb96b81Ab3103C0CD8E
USDC_FUJI_ADDRESS=0x5425890298aed601595a70AB815c96711a31Bc65

# Demo input
DEMO_TOKEN_NAME=SafeMoonElonGem
DEMO_TOKEN_SYMBOL=SMEG
DEMO_TOKEN_DESCRIPTION=100x guaranteed returns, fully audited, Elon approved!
```

---

## Constraint Directives

### OBLIGATORIO
- Seguir el orden de pasos de `agentkit-demo/src/index.ts` exactamente
- Usar `@coinbase/agentkit` para obtener la wallet (no private key hardcodeada en env)
- Target: `wasi-defi-sentiment` — no hardcodear otro slug
- Input al agente: `{ token_name, token_symbol, description }` — leer de `.env`
- USDC address Fuji: `0x5425890298aed601595a70AB815c96711a31Bc65`
- Contrato WasiAI Fuji v4: `0x9d8Eb04Df6Bd271491Bcdbb96b81Ab3103C0CD8E`
- Wallet CDP es **efímera** — documentar esto en README

### PROHIBIDO
- NO modificar `wasiai-v2` ni ningún archivo fuera de `wasiai-agents/`
- NO usar ethers.js — solo viem v2
- NO hardcodear precios — leer precio real del catálogo WasiAI
- NO poner secrets reales en `.env.example`
- NO persistir wallet CDP (no crear archivo wallet.json)
- NO agregar dependencias más allá de: `@coinbase/agentkit`, `viem`, `dotenv`, `tsx`, `typescript`

---

## Waves

### W0 — Setup del repo y archivos base (serial)
1. Crear `wasiai-agents/package.json` (root) y `.gitignore`
2. Crear `wasiai-agents/agents/agentkit-example/package.json` con dep `@coinbase/agentkit`
3. Crear `wasiai-agents/agents/agentkit-example/tsconfig.json`
4. Crear `.env.example`
5. Verificar: `npm install` corre sin errores en `agents/agentkit-example/`

### W1 — Archivos copiados sin cambios (paralelo)
- Copiar `catalog.ts` → sin modificaciones
- Copiar `pay.ts` → sin modificaciones
- Copiar `invoke.ts` → sin modificaciones
- Copiar `logger.ts` → sin modificaciones

### W2 — Archivos nuevos con lógica (serial — dependen del resultado de W0)
1. Crear `src/wallet.ts` — integración CDP
   - Investigar API real de `@coinbase/agentkit` (leer node_modules después de npm install)
   - Exponer: `{ walletClient, publicClient, agentAddress }`
   - Misma interfaz de retorno que el exemplar para que `index.ts` no cambie
2. Crear `src/index.ts` — adaptar de exemplar
   - Cambiar `AGENT_PRIVATE_KEY` → `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET`
   - Cambiar input: `DEMO_INPUT_TEXT` → `DEMO_TOKEN_NAME` + `DEMO_TOKEN_SYMBOL` + `DEMO_TOKEN_DESCRIPTION`
   - Mantener toda la lógica de flow igual al exemplar
3. Verificar: `npm run typecheck` pasa

### W3 — README + smoke test
1. Escribir `README.md` completo con:
   - Qué hace el ejemplo
   - Setup: CDP key + fondeo USDC Fuji
   - Instrucciones de fondeo (faucet URL)
   - Variables de entorno con descripción
   - `npm run start` output esperado
2. Verificar: `npm run typecheck` pasa limpio

---

## Out of Scope
- Tests automatizados (no hay mock de CDP disponible)
- Mainnet
- UI
- Modificar agentes existentes
- Publicar a npm

---

## Escalation Rule
Si algo no está claro en este Story File, **PARAR y preguntar a Architect**. No improvisar. Especialmente si la API de `@coinbase/agentkit` no expone el private key o la interfaz de firma es diferente a lo esperado.
