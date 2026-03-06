# Artefacto S0 — HU-7.3 (Revisión 2)
## Agente AgentKit que descubre y paga agentes en WasiAI vía x402

**Número de HU:** HU-7.3 Rev.2  
**Épica:** E7 — Integraciones con Ecosistema AI  
**PM (S0):** San (BMAD v6)  
**Fecha:** 2026-02-28  
**Estado:** DRAFT — pendiente HU_APPROVED de Fer  
**Hackathon:** Avalanche Build Games — Semana 2  

> **Nota:** Existe `story-HU-7.3.md` (READY FOR DEV) pero fue generado ANTES de que los SDKs `@wasiai/sdk` (npm) y `wasiai` (pip) estuvieran publicados. Esta revisión actualiza el scope para usar los SDKs oficiales y Coinbase AgentKit real.

---

## Historia de Usuario

> **Como** developer externo que evalúa WasiAI para construir agentes autónomos,  
> **quiero** un ejemplo funcional de un agente construido con Coinbase AgentKit que, usando `@wasiai/sdk`, descubre agentes en el marketplace y los paga vía protocolo x402 (USDC en Avalanche Fuji),  
> **para** entender en menos de 15 minutos cómo integrar WasiAI en cualquier proyecto de IA autónoma y validar que el marketplace soporta pagos agent-to-agent sin intervención humana.

---

## Contexto de negocio

WasiAI es el primer marketplace on-chain de agentes IA en Avalanche. El diferenciador clave es que **cualquier agente puede pagar a otro agente** sin humano en el loop — usando x402 + USDC + ERC-3009.

Coinbase AgentKit es el SDK más adoptado para dar wallets on-chain a agentes de IA. La combinación AgentKit + WasiAI es exactamente el caso de uso que los jueces del hackathon están buscando: infraestructura real, pagos reales, red pública.

**El estado actual:**
- SDKs publicados: `@wasiai/sdk` (npm) + `wasiai` (pip) ✅
- Contrato en Fuji v3: `0x71CddCdF8a40951a1d8C22C8774448FbcA089b53` ✅
- API pública en prod: `https://wasiai-v2.vercel.app/api/v1/agents` ✅
- `story-HU-7.3.md` existente: usa viem directo, sin `@wasiai/sdk` ⚠️ desactualizado

---

## Acceptance Criteria

### AC-1 — Estructura del proyecto
- El directorio `/examples/agentkit-demo` existe en el repo raíz (no dentro de `src/`)
- Tiene su propio `package.json`, `tsconfig.json`, `.env.example`, `README.md`
- Ejecutable standalone: `npm install && npm run start` sin depender del codebase principal
- `README.md` en inglés con: prereqs, env vars, pasos, flujo esperado en output de consola

### AC-2 — Usa @wasiai/sdk (npm) como cliente del marketplace
- `package.json` incluye `@wasiai/sdk` con versión exacta (sin `^` ni `latest`)
- El agente usa el SDK para descubrir agentes: `client.agents.list()` o equivalente
- El agente usa el SDK para invocar y pagar: `client.agents.invoke(slug, input)` o equivalente
- `grep -r "fetch.*wasiai-v2.vercel.app" src/` debe retornar vacío — toda la comunicación via SDK

### AC-3 — Integración real con Coinbase AgentKit
- `package.json` incluye `@coinbase/agentkit` o `@coinbase/agentkit-langchain` con versión exacta
- La wallet del agente se inicializa via AgentKit (no viem directo, no ethers.js)
- El agente tiene al menos 1 acción AgentKit custom: `WasiAIInvokeTool` que envuelve la llamada al SDK
- AgentKit maneja el keypair — la private key se lee desde `AGENT_PRIVATE_KEY` en `.env`

### AC-4 — Flujo end-to-end funcionando en Fuji
- El agente ejecuta este flujo completo sin intervención humana:
  1. Inicializa wallet AgentKit con USDC en Fuji
  2. Lista agentes del marketplace vía `@wasiai/sdk`
  3. Selecciona el agente `summarizer` (o cualquier agente activo en Fuji)
  4. Invoca y paga vía x402 — el SDK maneja el payment flow
  5. Imprime en consola: agente invocado, precio pagado, respuesta recibida
- El output del agente incluye el transaction hash o receipt del pago on-chain

### AC-5 — Seguridad y Golden Path
- Todas las addresses de contratos leídas desde env vars — `grep -r "0x5425\|0x71Cc" src/` debe retornar vacío
- `grep -r "ethers" src/` debe retornar vacío (AgentKit puede usarlo internamente — lo que importa es que el ejemplo no lo use directamente)
- `AGENT_PRIVATE_KEY` nunca aparece en logs ni en output de consola
- `.env.example` tiene todas las vars con valores de placeholder claros

### AC-6 — README ejecutable y hackathon-ready
- Un juez puede clonar el repo, configurar 3-4 env vars y ver el agente funcionar en < 15 minutos
- El README explica qué es x402 y WasiAI en 2-3 párrafos (sin asumir conocimiento previo)
- Incluye link al contrato verificado en Snowtrace Fuji
- Incluye un gif o asciicast del agente corriendo (nice to have, no bloqueante)

### AC-7 — Ejemplo Python (nice to have, no bloqueante para gate)
- Existe `/examples/agentkit-demo-python/` con el mismo flujo usando el SDK `wasiai` (pip)
- `requirements.txt` con versiones exactas
- Demuestra que el SDK funciona en un contexto Python (LangChain, CrewAI, o script simple)

---

## Scope

### ✅ Incluye
- Ejemplo Node.js/TypeScript con AgentKit + `@wasiai/sdk`
- Flujo completo: descubrimiento → invocación → pago x402 → recibo on-chain
- `WasiAIInvokeTool` como acción custom de AgentKit
- README en inglés, ejecutable, hackathon-ready
- `.env.example` completo
- Wallet via private key en `.env` (no CDP Wallet — ver Post-Build Games HU-7.3b)
- Red: Fuji testnet únicamente

### ❌ No incluye
- CDP Wallet / Coinbase Developer Platform KYC (es HU-7.3b post-hackathon)
- Ejemplo con LangChain o LlamaIndex (son HU-7.1 y HU-7.2)
- Despliegue del ejemplo en Vercel o cualquier nube
- Cambios al contrato o a la API principal de WasiAI
- Ejemplo con agente multi-step o pipelines (es HU-5.x)
- Mainnet — solo Fuji
- Gif/asciicast (nice to have, no en scope del gate)

---

## Dependencias

| Dependencia | Estado | Bloqueante |
|------------|--------|-----------|
| `@wasiai/sdk` publicado en npm | ✅ publicado | Sí — es el core del ejemplo |
| `wasiai` publicado en pip | ✅ publicado | Solo para AC-7 (nice to have) |
| Agente `summarizer` activo en Fuji prod | ⚠️ verificar | Sí — AC-4 lo necesita |
| Contrato v3 Fuji activo | ✅ `0x71Cc...` | Sí |
| USDC en wallet de prueba | Manual | Sí — faucet Fuji antes de ejecutar |

> **Acción previa:** Verificar que el agente `summarizer` (o cualquier agente con precio real) está activo en `https://wasiai-v2.vercel.app` antes de que Dev empiece.

---

## Riesgos

| ID | Riesgo | Probabilidad | Impacto | Mitigación |
|----|--------|-------------|---------|-----------|
| R-1 | `@wasiai/sdk` no expone el flujo x402 completo — Dev tiene que hacer fetch manual | Media | Alto | Revisar la API pública del SDK antes de spec. Si falta, agregar el método en el SDK primero (HU-2.x). |
| R-2 | AgentKit v1 tiene breaking changes o no es compatible con viem v2 | Baja | Medio | Testear compatibilidad en día 1. AgentKit usa ethers internamente — el ejemplo no lo importa directamente. |
| R-3 | El agente `summarizer` está caído o sin precio configurado en Fuji | Media | Alto | Tener un agente de backup o crear uno específico para el demo antes de Dev. |
| R-4 | USDC faucet de Fuji lento o no disponible | Baja | Alto | Preparar wallet pre-fondeada para el demo y documentarla en `.env.example`. |
| R-5 | Tiempo — hackathon tiene deadline fijo | Alta | Crítico | AC-7 (Python) es nice to have. Entregar AC-1 a AC-6 primero. Sin feature creep. |
| R-6 | `@wasiai/sdk` tiene bug o API rota descubierto durante el ejemplo | Baja | Alto | El Dev tiene acceso al repo del SDK para fix inmediato. |

---

## Estimación

| Componente | Puntos |
|-----------|--------|
| Setup estructura + package.json + tsconfig | 1 |
| Integración AgentKit (wallet init + acción custom) | 2 |
| Integración `@wasiai/sdk` (discovery + invoke) | 2 |
| Flujo x402 end-to-end (si SDK no lo expone: +2) | 1–3 |
| README hackathon-ready | 1 |
| AC-7 Python (nice to have) | 2 |
| **Total (sin AC-7)** | **7–9 puntos** |
| **Total (con AC-7)** | **9–11 puntos** |

> Estimación base: **8 puntos** (sin AC-7 Python). Con plazo de hackathon: **2 días de Dev dedicado**.

---

## Notas para S1 (Architect / SDD)

1. **Verificar API del SDK primero.** El SDD debe mapear qué métodos de `@wasiai/sdk` existen y si cubren el flujo x402 completo. Si no, hay que extender el SDK antes del ejemplo.
2. **`WasiAIInvokeTool`** — decidir si es una `AgentKit Action` (recomendado para demostrabilidad) o solo un wrapper de función.
3. **Error handling** — el agente debe manejar: saldo USDC insuficiente, agente no encontrado, timeout en invocación. No puede crashear silenciosamente.
4. **Output de consola** — diseñar el output para que sea legible para los jueces: timestamp, pasos numerados, precio en USDC, tx hash clickeable en Snowtrace.

---

*Artefacto generado por San (S0/PM — BMAD v6) — 2026-02-28*  
*Requiere HU_APPROVED de Fer antes de pasar a S1.*
