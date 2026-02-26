# HU-7.3 — AgentKit Example (Coinbase)

**Estado:** DRAFT S0  
**Fecha:** 2026-02-26  
**Autor:** PM Agent (BMAD v6)  
**Proyecto:** WasiAI — Avalanche Build Games Hackathon  

---

## Historia de Usuario

> **Como** desarrollador externo que evalúa WasiAI para construir agentes autónomos,  
> **quiero** un ejemplo funcional end-to-end de un agente construido con AgentKit (Coinbase) que descubre, invoca y paga agentes del marketplace vía protocolo x402 en Avalanche C-Chain,  
> **para** poder entender el patrón de integración completo, replicarlo en mi propio proyecto y validar que WasiAI soporta casos de uso de agent-to-agent sin intervención humana.

---

## Contexto y Justificación

WasiAI hace una promesa pública a los jueces del hackathon Avalanche Build Games: el marketplace soporta pagos autónomos agent-to-agent vía x402. Este ejemplo es la prueba tangible de esa promesa. Sin él, la claim queda en el whitepaper.

AgentKit (Coinbase) es el SDK de referencia de la industria para dotar a agentes IA de wallet propia y capacidades on-chain. Que WasiAI tenga un demo funcional con AgentKit posiciona al proyecto como integration-ready para el ecosistema Coinbase/Base/Avalanche.

---

## Acceptance Criteria

### AC-1: Estructura del proyecto
- [ ] El directorio `/examples/agentkit-demo` existe en el repo con su propio `package.json`, `README.md` y `tsconfig.json`
- [ ] El ejemplo es ejecutable de forma standalone (`npm install && npm run start`) sin depender del codebase principal de WasiAI
- [ ] El `README.md` documenta en inglés: prerequisitos, variables de entorno requeridas, pasos de ejecución y flujo esperado

### AC-2: Stack y dependencias
- [ ] Usa **AgentKit** de Coinbase como SDK principal del agente (`@coinbase/agentkit` o equivalente estable)
- [ ] Usa **viem v2** para todas las interacciones on-chain — **cero uso de ethers.js**
- [ ] Todas las addresses de contratos (WasiAI registry, USDC Fuji) se leen desde variables de entorno — **cero hardcodes**
- [ ] La red target (Fuji/Mainnet) se configura vía env var, no está hardcodeada

### AC-3: Flujo core del agente
- [ ] El agente inicializa con una wallet propia generada/gestionada por AgentKit (puede ser wallet CDP o local según config)
- [ ] El agente consulta el catálogo de WasiAI (vía API REST o contrato) y selecciona un agente target disponible
- [ ] El agente construye y firma un pago ERC-3009 (`transferWithAuthorization`) para cubrir el costo de invocación
- [ ] El agente envía la request HTTP con el header `X-402-Payment` válido según el protocolo x402
- [ ] El agente recibe y procesa la respuesta del agente WasiAI invocado
- [ ] Todo el flujo se ejecuta sin intervención humana una vez iniciado

### AC-4: Protocolo x402
- [ ] El cliente x402 del demo maneja correctamente el challenge `402 Payment Required` y reenvía con pago
- [ ] El pago usa USDC en Fuji (`0x5425890298aed601595a70AB815c96711a31BC65`) — leído desde env var
- [ ] El monto del pago es dinámico según el precio declarado por el agente en el marketplace, no hardcodeado

### AC-5: Observabilidad del demo
- [ ] El agente imprime en consola (con timestamps) cada paso del flujo: wallet address, agente seleccionado, monto a pagar, hash de tx, respuesta recibida
- [ ] Si hay un error en cualquier paso, el agente lo loguea con contexto suficiente para diagnosticar (no crashea silenciosamente)

### AC-6: Testing mínimo
- [ ] Existe al menos un test de integración o script de smoke-test que valida el flujo en Fuji testnet
- [ ] El test puede ejecutarse con `npm test` y produce output claro (pass/fail)

### AC-7: Validación de jueces (demo-ready)
- [ ] El flujo completo puede ser ejecutado en vivo durante una demo de ~5 minutos
- [ ] El README incluye un GIF o video link del flujo funcionando (opcional pero deseable antes del pitch)

---

## Scope

### ✅ Incluye

- Directorio autocontenido `/examples/agentkit-demo`
- Agente IA con wallet propia via AgentKit (Coinbase CDP Wallet o equivalente)
- Integración con WasiAI API para descubrir agentes disponibles
- Implementación del cliente x402 para pagos autónomos
- Firma ERC-3009 (`transferWithAuthorization`) con viem v2
- Ejecución en Fuji testnet (chain ID 43113)
- README completo en inglés (audiencia: developers externos y jueces)
- Logging de trazabilidad del flujo

### ❌ No incluye (Out of Scope)

- UI/frontend — es un ejemplo de línea de comandos / script Node.js
- Deploy en producción / mainnet — solo Fuji testnet para el hackathon
- Integración con LangChain, AutoGPT u otros frameworks de agentes — solo AgentKit
- Multi-agent orchestration (un agente llamando a otro que llama a otro) — v1 es single-hop
- Soporte para tokens distintos de USDC
- Account Abstraction (ERC-4337) — prohibido según Golden Path
- Modificaciones al codebase principal de WasiAI — el ejemplo es standalone
- CI/CD propio para el directorio de ejemplos
- Cobertura de tests > 80% — smoke test es suficiente para S0

---

## Riesgos Identificados

| ID | Riesgo | Probabilidad | Impacto | Mitigación |
|----|--------|-------------|---------|------------|
| R1 | AgentKit CDP Wallet requiere API key de Coinbase Platform con KYC/approval — puede no estar disponible a tiempo | Media | Alto | Tener un fallback con wallet local (private key desde env var) como modo alternativo |
| R2 | El protocolo x402 de WasiAI no está documentado públicamente — el dev del demo necesita acceso a la spec interna | Alta | Alto | Proveer spec x402 y ejemplo de header válido antes de iniciar S1 |
| R3 | Fuji testnet puede tener latencia o downtime durante la demo en vivo | Baja | Alto | Tener un run previo grabado como backup; considerar mock mode |
| R4 | Versión de AgentKit SDK puede cambiar breaking changes entre S1 y demo | Media | Medio | Lockear versión exacta en package.json; no usar "latest" |
| R5 | USDC de Fuji en la wallet del agente puede agotarse si el tester hace múltiples runs | Media | Medio | Documentar faucet de Fuji USDC en README; considerar script de recarga |
| R6 | La API de WasiAI para descubrimiento de agentes puede no existir aún en la forma que el ejemplo necesita | Media | Alto | Validar qué endpoints existen antes de S1; puede requerir HU de soporte en el backend |

---

## Dependencias

| Dependencia | Tipo | Estado | Responsable |
|-------------|------|--------|-------------|
| Spec del protocolo x402 de WasiAI | Interna | ⚠️ Necesita validación | Backend WasiAI |
| API de catálogo/descubrimiento de agentes | Interna | ⚠️ Necesita validación | Backend WasiAI |
| Acceso a Coinbase Developer Platform (CDP) para AgentKit | Externa | ⚠️ Pendiente | Fer |
| Faucet USDC Fuji con saldo suficiente | Externa | ✅ Disponible | Dev |
| Contrato WasiAI en Fuji activo | Interna | ✅ `0x71CddCdF8a40951a1d8C22C8774448FbcA089b53` | Fer |

---

## Notas para S1 (Spec Técnica)

Antes de pasar a S1, Fer debe confirmar:

1. **¿Qué endpoint del API de WasiAI expone el catálogo de agentes con precio?** (URL + schema de response)
2. **¿El servidor x402 de WasiAI ya está productivo en Fuji o es parte de esta misma HU construirlo?**
3. **¿Usamos CDP Wallet de Coinbase o wallet local (private key)?** CDP requiere setup adicional
4. **¿El agente invocado en el demo debe hacer algo real (ej: clasificar texto, generar imagen) o basta con que devuelva un mock?**

---

## Definition of Done (para gate HU_APPROVED)

- [ ] Fer leyó este artefacto S0 completo
- [ ] Fer da **HU_APPROVED explícito** (no se infiere de "dale" o "ok")
- [ ] Las 4 preguntas de Notas para S1 están respondidas antes de iniciar S1

---

*Generado por PM Agent — BMAD Method v6 — WasiAI / Avalanche Build Games*
