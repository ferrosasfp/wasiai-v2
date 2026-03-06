# S0 Artefacto — HU-7.5: Ejemplo End-to-End x402 con @wasiai/sdk

**Artefacto:** S0 (Product Manager — BMAD v6)  
**Fecha:** 2026-02-28  
**Autor:** San (S0 Agent)  
**Estado:** DRAFT — pendiente HU_APPROVED de Fer  
**Épica:** E7 — Integraciones con Ecosistema AI  

---

## Historia de Usuario

> **Como** developer externo que quiere integrar WasiAI en su stack,  
> **quiero** un ejemplo funcional end-to-end en Node.js usando únicamente `@wasiai/sdk` que demuestre cómo invocar un agente del marketplace pagando automáticamente vía protocolo x402 (USDC en Avalanche Fuji),  
> **para** entender el patrón completo de integración en ≤15 minutos y replicarlo en mis propios proyectos — tanto para consumir agentes como para publicar los míos.

---

## Contexto y Motivación

WasiAI tiene el SDK publicado (`@wasiai/sdk` v0.1.0 en npm) y el contrato activo en Fuji. Falta el puente crítico: un ejemplo autocontenido que todo developer pueda clonar, configurar y correr en minutos.

Este no es un ejemplo de hackathon. Es el "Hello World" oficial de integración con WasiAI — el primer punto de contacto de cualquier developer nuevo con la plataforma. Define cómo WasiAI se percibe desde afuera.

**Diferencia clave vs HU-7.3 (AgentKit):**
- HU-7.3 fue orientado a demostrar agent-to-agent payments para jueces de hackathon, con private key hardcodeada y sin orientación de producción.
- HU-7.5 es el ejemplo de referencia oficial: sin frameworks específicos, usando solo `@wasiai/sdk`, con buenas prácticas desde el inicio (env vars, manejo de errores, instrucciones claras de configuración).

---

## Acceptance Criteria

Todos los criterios son verificables ejecutando el ejemplo en una máquina limpia.

**AC-1 — Setup en ≤5 minutos**  
Un developer sin contexto previo puede clonar el repo, copiar `.env.example`, completar las 4 variables requeridas, correr `npm install && npm run invoke` y ver el resultado en consola. El README tiene instrucciones paso a paso para obtener cada variable (faucet Fuji, USDC testnet, API key WasiAI).

**AC-2 — Invocación exitosa vía x402**  
`npm run invoke` llama al agente `summarizer` del marketplace WasiAI en Fuji, paga automáticamente en USDC (ERC-3009 `transferWithAuthorization`), y muestra en consola: input enviado, precio cobrado, resultado del agente, y hash de la transacción on-chain.

**AC-3 — Manejo de errores visible**  
Si la API key es inválida, el saldo USDC es insuficiente, o el agente no responde, el script termina con un mensaje de error claro y accionable (no un stack trace crudo). Exit code != 0 en cualquier error.

**AC-4 — Variables de entorno, nunca hardcoded**  
Cero valores hardcodeados en el código: wallet private key, API key WasiAI, y cualquier dirección de contrato vienen exclusivamente de `.env` cargado con `dotenv`. `.env` está en `.gitignore`. `.env.example` tiene todos los campos con valores de ejemplo o instrucciones.

**AC-5 — Guía "Publica tu propio agente"**  
El README incluye una sección "Paso 2: Publica tu agente" con el flujo mínimo: registrar el agente vía `@wasiai/sdk`, configurar endpoint, y el resultado esperado (aparece en marketplace, recibe USDC por cada llamada). Esta sección no requiere ser código ejecutable — puede ser documentación con comandos — pero debe ser suficiente para que un dev lo haga sin buscar información adicional.

**AC-6 — Compatible con Node.js 18+ sin dependencias extra**  
El ejemplo usa únicamente `@wasiai/sdk` + `dotenv` como dependencias de runtime. Sin LangChain, AgentKit, ethers.js, ni otras libs de terceros. `package.json` tiene `engines: { node: ">=18" }`.

**AC-7 — Repo independiente, no dentro del monorepo wasiai-v2**  
El ejemplo vive en un repo separado (ej. `github.com/ferrosasfp/wasiai-x402-example`) para que cualquier developer pueda clonarlo directamente sin acceso al repo principal. Linkeable desde la documentación y el marketplace.

---

## Scope

### ✅ Incluye

- Script Node.js/TypeScript (`invoke.ts`) que ejecuta el flujo completo: inicializar SDK → llamar agente → pagar vía x402 → imprimir resultado
- README completo: prerequisitos, setup, flujo de invocación, guía de publicación de agente propio
- `.env.example` con las 4 variables mínimas y descripción de cada una
- Manejo explícito de errores (saldo insuficiente, API key inválida, timeout)
- Apunta al agente `summarizer` ya existente en Fuji como caso de uso concreto
- Instrucciones para obtener USDC de testnet (faucet link)

### ❌ No incluye

- CDP Wallet / AgentKit / Coinbase — es scope futuro (HU-7.3b)
- LangChain, LlamaIndex u otros frameworks
- Mainnet — solo Fuji testnet
- UI o frontend de ningún tipo
- Despliegue en servidor — el ejemplo corre local
- Múltiples agentes o compose/pipeline — un solo agente, un solo call
- Tests automatizados del ejemplo (el script mismo es el test)
- Modificaciones al contrato WasiAI o al SDK

---

## Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| `@wasiai/sdk` v0.1.0 no expone la interfaz necesaria para el flujo x402 completo | Media | Alto | Revisar API del SDK antes de comenzar. Si falta algo, abrir issue o PR al SDK en paralelo (blocker). |
| El agente `summarizer` en Fuji puede estar caído o sin respuesta | Baja | Alto | Documentar en README cómo verificar que el agente está activo antes de correr el ejemplo. |
| Faucet de USDC Fuji puede estar rate-limited o caído | Media | Medio | Incluir 2 faucets alternativos en el README. |
| Developer no sabe cómo exportar private key de wallet sin comprometer seguridad | Alta | Medio | README incluye advertencia explícita: usar una wallet dedicada solo para testing, nunca la wallet principal. |

---

## Estimación

**3 puntos de historia**

Desglose:
- 1 pt — Script `invoke.ts` funcional con manejo de errores
- 1 pt — README completo con setup + guía de publicación
- 1 pt — Validación real en Fuji (depende de disponibilidad de faucet y estado del SDK)

---

## Dependencias

| Dependencia | Estado | Blocker |
|------------|--------|---------|
| `@wasiai/sdk` v0.1.0 publicado en npm | ✅ Disponible | No |
| Contrato `0x71CddCdF8a40951a1d8C22C8774448FbcA089b53` activo en Fuji | ✅ Activo | No |
| Agente `summarizer` disponible en marketplace | Asumir ✅ | Verificar antes de dev |
| API de WasiAI (`/api/v1/agents`, `/api/v1/invoke`) funcional | ✅ Activo en prod | No |
| SDK expone interfaz para flujo x402 end-to-end | ⚠️ Verificar | Blocker si no |

---

## Criterio de Done (DoD)

- [ ] Ejemplo corre sin errores en una máquina limpia con Node.js 18+
- [ ] README revisado por un developer que no conoce el proyecto (al menos Fer hace el walkthrough)
- [ ] Ninguna variable sensible en el código o en el repo
- [ ] Repo público en GitHub, linkeable desde wasiai-v2.vercel.app
- [ ] Code review por Fer antes de hacer el repo público

---

*Este artefacto NO está aprobado hasta recibir HU_APPROVED explícito de Fer.*
