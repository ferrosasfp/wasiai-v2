# S0 Artefacto — HU-7.5 Rev.2: Agente x402 con Wallet Propia y ERC-3009 Directo

**Artefacto:** S0 (Product Manager — BMAD v6)  
**Fecha:** 2026-02-28  
**Autor:** San (S0 Agent)  
**Estado:** DRAFT — pendiente HU_APPROVED de Fer  
**Épica:** E7 — Integraciones con Ecosistema AI  
**Invalida:** HU-7.5 (2026-02-28) — scope asumía API Key como forma de pago  

---

## Historia de Usuario

> **Como** developer que quiere que su agente pague servicios de forma autónoma,  
> **quiero** un ejemplo funcional en Node.js donde el agente tiene su propia wallet, firma una autorización ERC-3009 (transferWithAuthorization) con viem v2, construye el header `X-402-Payment` manualmente, y llama directamente al contrato WasiAI en Fuji sin ningún intermediario ni API Key de pago,  
> **para** entender el patrón real de pagos agent-to-agent que diferencia a WasiAI de cualquier API con API Key — y replicarlo en mis propios agentes autónomos.

---

## Contexto y Motivación

**¿Por qué invalida HU-7.5 original?**

HU-7.5 original asumía que `@wasiai/sdk` manejaba el pago internamente, con API Key como credencial. Ese modelo es correcto para onboarding rápido, pero no demuestra el diferenciador real de WasiAI.

El diferenciador real es este: **un agente tiene su propia wallet y paga directamente on-chain, sin que WasiAI tenga custodia de sus fondos, sin que ningún intermediario apruebe la transacción.** El developer no "recarga créditos" — su agente firma ERC-3009 y el contrato WasiAI valida la firma. Esto es lo que ninguna API de AI hace hoy.

**Por qué importa para WasiAI:**
- Demo que ningún competidor puede replicar sin blockchain
- El "Hello World" que convence a developers en hackathons y demos
- Base del pitch: "tus agentes pagan solos, sin que nadie custodie sus fondos"

**Stack acordado con Fer:**
- `viem v2` + `dotenv` — cero dependencias adicionales de runtime
- Red: Avalanche Fuji testnet
- Contrato: `0x71CddCdF8a40951a1d8C22C8774448FbcA089b53`
- USDC Fuji: `0x5425890298aed601595a70AB815c96711a31Bc65`
- API: `https://wasiai-v2.vercel.app`
- Repo independiente (no dentro de wasiai-v2)

---

## Acceptance Criteria

**AC-1 — Setup en ≤10 minutos desde cero**  
Un developer sin contexto previo puede: clonar el repo, copiar `.env.example` a `.env`, completar `PRIVATE_KEY` y `AGENT_ID`, correr `npm install && npm run invoke`, y ver en consola el resultado del agente WasiAI. El README tiene instrucciones para conseguir USDC Fuji (faucet link incluido) y cómo generar una wallet de testing con viem.

**AC-2 — Flujo ERC-3009 completo y verificable**  
`npm run invoke` ejecuta en orden: (1) carga wallet desde `PRIVATE_KEY`, (2) consulta catálogo vía `GET /api/v1/agents` para obtener precio y dirección del agente, (3) construye firma EIP-712 de `transferWithAuthorization` con viem v2, (4) codifica el header `X-402-Payment` como Base64 JSON, (5) hace `POST /api/v1/invoke/{agentId}` con el header, (6) imprime en consola: respuesta del agente + precio pagado. Cada paso es visible en los logs.

**AC-3 — Sin intermediario, sin API Key de pago**  
El script NO usa API Key de WasiAI para el pago. El pago sucede via firma ERC-3009 que el contrato valida on-chain. El developer solo pone su `PRIVATE_KEY` de wallet. WasiAI nunca tiene custodia de los fondos — la transferencia la autoriza el agente del developer, nadie más.

**AC-4 — Variables de entorno, cero hardcoding**  
Ninguna address de contrato, private key, ni URL está hardcodeada en el código. Todo viene de `.env`. Las addresses de contrato (`CONTRACT_ADDRESS`, `USDC_ADDRESS`) tienen valores default en el código que apuntan a Fuji — pero pueden ser sobreescritas vía env. `.env` está en `.gitignore`. `.env.example` documenta cada variable.

**AC-5 — Manejo de errores accionables**  
Si USDC insuficiente → mensaje: "Saldo insuficiente. Necesitas X USDC en Fuji. Faucet: [link]". Si firma inválida o rechazada por contrato → mensaje del revert decodificado (no stack trace crudo). Si agente no disponible → mensaje claro. Exit code != 0 en cualquier error.

**AC-6 — Código legible como documentación**  
El archivo principal (`invoke.ts` o `invoke.js`) tiene comentarios inline que explican cada decisión técnica: por qué ERC-3009 vs ERC-20 approve, qué es el nonce aleatorio, qué contiene el header X-402-Payment. El código es la documentación — un developer debe entender el protocolo leyendo el script.

**AC-7 — Compatible Node.js 18+ sin ethers.js**  
`package.json` declara `engines: { node: ">=18" }`. Solo `viem` y `dotenv` como `dependencies`. Sin ethers.js, sin LangChain, sin AgentKit, sin frameworks. `npm install` resuelve en < 30 segundos.

**AC-8 — README con sección "Cómo funciona x402"**  
El README incluye un diagrama ASCII o sección explicando el flujo de pago: wallet → firma ERC-3009 → header X-402-Payment → contrato WasiAI → validación on-chain → respuesta del agente. No más de 20 líneas. Suficiente para que alguien lo comparta en Twitter y se entienda sin abrir el código.

---

## Scope

### ✅ Incluye

- Script Node.js/TypeScript (`invoke.ts`) con el flujo completo: wallet → ERC-3009 → X-402-Payment → invoke → respuesta
- Construcción manual del header `X-402-Payment` (Base64 JSON con firma EIP-712)
- Firma ERC-3009 `transferWithAuthorization` usando viem v2 `signTypedData`
- Discovery del catálogo via `GET /api/v1/agents` (puede usar `@wasiai/sdk` solo para esto, o fetch directo)
- README: prerequisitos, setup, flujo explicado, diagrama x402, sección "por qué no API Key"
- `.env.example` con las variables mínimas y descripción
- Manejo de errores con mensajes accionables
- Repo público independiente, no dentro del monorepo wasiai-v2
- Apunta al primer agente disponible en el catálogo Fuji (o `AGENT_ID` configurable)

### ❌ No incluye

- Pago vía API Key — este ejemplo es exclusivamente on-chain
- `@wasiai/sdk` para el pago (puede usarse solo para discovery del catálogo)
- Mainnet — solo Fuji testnet
- AgentKit, LangChain, LlamaIndex u otros frameworks
- UI o frontend
- Registro/publicación de agente propio (eso es scope separado)
- Tests automatizados (el script mismo es la prueba)
- Múltiples agentes o pipelines — un agente, un call
- Modificaciones al contrato WasiAI, al SDK, ni al repo principal

---

## Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| API `/api/v1/invoke` no acepta header `X-402-Payment` construido manualmente (formato incorrecto) | Media | Alto | Verificar formato exacto del header con contrato antes de escribir una línea de código. Blocker si hay discrepancia. |
| El contrato Fuji valida nonce o deadline de forma inesperada | Baja | Alto | Usar nonce random (bytes32) y deadline = now + 1h como estándar ERC-3009. Documentar si el contrato tiene restricciones adicionales. |
| Faucet USDC Fuji caído o rate-limited | Media | Medio | Incluir 2 faucets alternativos. Fer puede prefondear la wallet de demo para el día del pitch. |
| Developer confunde `PRIVATE_KEY` de wallet propia con API Key de WasiAI | Alta | Medio | README con advertencia en rojo: "Usa una wallet dedicada solo para testing. NUNCA uses tu wallet principal." |
| viem v2 breaking changes en la firma `signTypedData` para ERC-3009 | Baja | Alto | Pinear versión exacta de viem en `package.json`. Documentar la versión usada. |

---

## Estimación

**3 puntos de historia**

| Componente | Puntos | Notas |
|-----------|--------|-------|
| Script `invoke.ts` con flujo ERC-3009 + X-402-Payment | 1.5 | La parte técnica core — firma EIP-712 + encode Base64 |
| README + diagrama x402 + `.env.example` | 1.0 | Documentación que convierte el código en un producto |
| Validación real en Fuji + manejo de errores | 0.5 | Depende de estado de faucet y contrato |

**Nota de estimación:** Los 3 puntos asumen que el formato del header `X-402-Payment` está documentado o verificable antes de empezar. Si hay que hacer ingeniería inversa del contrato, sumar 1 punto.

---

## Dependencias

| Dependencia | Estado | Blocker |
|------------|--------|---------|
| Contrato `0x71CddCdF8a40951a1d8C22C8774448FbcA089b53` activo en Fuji | ✅ Verificado | No |
| USDC Fuji `0x5425890298aed601595a70AB815c96711a31Bc65` accesible | ✅ Verificado | No |
| `POST /api/v1/invoke/{agentId}` acepta `X-402-Payment` header | ⚠️ Verificar formato exacto | Blocker si no documentado |
| Al menos un agente activo en catálogo Fuji (`GET /api/v1/agents`) | ⚠️ Asumir ✅ | Verificar antes de dev |
| Faucet USDC Fuji operativo para demo/testing | ⚠️ Variable | Tener USDC pre-fondeado como backup |
| viem v2 soporta `signTypedData` para ERC-3009 sin hacks | ✅ Estándar | No |

---

## Criterio de Done (DoD)

- [ ] Script corre end-to-end en máquina limpia con Node.js 18+: wallet → firma → pago → respuesta del agente
- [ ] El hash o confirmación del pago es visible en consola (verificable que el pago fue real)
- [ ] Ninguna variable sensible en código ni en repo
- [ ] Fer hace el walkthrough completo desde cero (este es el test de aceptación real)
- [ ] Repo público en GitHub, linkeable desde docs de WasiAI
- [ ] README explica en ≤3 líneas por qué este demo es imposible sin blockchain

---

*Este artefacto NO está aprobado hasta recibir HU_APPROVED explícito de Fer.*
