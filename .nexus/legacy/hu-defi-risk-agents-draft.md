# Artefacto S0 — HU-7.6: DeFi Risk Intelligence Pipeline (5 Agentes WasiAI)

**Número de HU:** HU-7.6  
**Épica:** E7 — Integraciones con Ecosistema AI  
**Estado:** DRAFT — Pendiente HU_APPROVED de Fer  
**Fecha:** 2026-02-28  
**Agente:** S0 (Product Manager)  
**Labels Linear:** `epic:E7` `blockchain` `product` `P0-Crítico` `hackathon` `avalanche` `defi`

---

## Historia de Usuario

**Como** equipo I+D de WasiAI,  
**quiero** crear y publicar en el marketplace 5 agentes especializados que, en pipeline, analicen el riesgo de cualquier token en Avalanche usando Chainlink Data Feeds y Kite AI,  
**para** demostrar en el hackathon Avalanche Build Games (Semana 3) que WasiAI puede orquestar agentes reales con datos on-chain, infraestructura AI nativa de Avalanche, y entregar inteligencia de riesgo DeFi accionable.

---

## Contexto y Motivación

WasiAI es un marketplace on-chain de agentes IA en Avalanche. Este pipeline es la primera demostración pública de agentes WasiAI trabajando encadenados con integraciones reales del ecosistema:

- **Chainlink** — precio on-chain, fuente de verdad institucional
- **Kite AI** — GPU inference nativa en Avalanche, sin salir del ecosistema
- **Avalanche C-Chain** — data on-chain pública (holders, contratos, volumen)

El pipeline se diseña para Fuji testnet primero. Los 5 agentes se publican en el marketplace como agentes oficiales de WasiAI (creator = WasiAI, fee = definir). La orquestación vía `/compose` es HU-5.1 separada — esta HU cubre exclusivamente la **creación y publicación de los 5 agentes**.

---

## Flujo del Pipeline

```
Input: dirección de token ERC-20 en Avalanche (Fuji / Mainnet)
        ↓
┌─────────────────────────────────────────────────┐
│ Agent 1 — Chainlink Price Feed Reader           │
│  • Lee AggregatorV3Interface on-chain           │
│  • Precio actual + snapshot histórico 7d        │
│  • Output: { price, history[], volatility }     │
└─────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────┐
│ Agent 2 — On-Chain Analyzer                     │
│  • Holders únicos, concentración top-10         │
│  • Volumen 24h, age del contrato                │
│  • Flags: mint activo, owner renounced, paused  │
│  • Output: { holders, concentration, age, flags }│
└─────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────┐
│ Agent 3 — Kite AI Contract Auditor              │
│  • Envía ABI/bytecode a Kite AI inference       │
│  • Detecta: rug pull patterns, honeypot,        │
│    permisos peligrosos (blacklist, setFee, etc) │
│  • Output: { findings[], severity }             │
└─────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────┐
│ Agent 4 — Sentiment Analyzer                    │
│  • Analiza nombre, descripción, metadata        │
│    disponibles on-chain o en marketplace        │
│  • Score de sentimiento + red flags textuales   │
│  • Output: { sentiment_score, flags[] }         │
└─────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────┐
│ Agent 5 — Risk Report Generator                 │
│  • Agrega outputs de Agents 1-4                 │
│  • Calcula risk score 0-100                     │
│  • Emite: SAFE (0-30) / CAUTION (31-65)         │
│            / AVOID (66-100)                     │
│  • Output: reporte estructurado completo        │
└─────────────────────────────────────────────────┘

Output final: JSON risk report + human-readable summary
```

---

## Acceptance Criteria

### AC-1: Los 5 agentes existen en la DB de WasiAI
- Cada agente tiene registro en tabla `agents` con `name`, `description`, `creator_id` (WasiAI), `fee_usdc`, `status: active`, `category: defi-risk`
- Visibles en el marketplace público en `/marketplace`

### AC-2: Agent 1 — Chainlink Price Feed Reader funciona on-chain
- Dado un token address en Fuji, el agente llama `latestRoundData()` del AggregatorV3Interface correspondiente
- Retorna precio actual con timestamp y al menos 7 puntos históricos (getRoundData) sin fallar
- Si no existe Price Feed para ese token, retorna error descriptivo en lugar de reventar

### AC-3: Agent 2 — On-Chain Analyzer retorna data real
- Consulta Avalanche C-Chain (Fuji) vía RPC público o Snowtrace API
- Retorna: holder count, concentración del top-10 en %, age del contrato en días, y al menos 2 flags de riesgo detectables on-chain
- Tiempo de respuesta < 10 segundos

### AC-4: Agent 3 — Kite AI Contract Auditor conecta a Kite AI
- Existe documentación o evidencia de que el endpoint de Kite AI fue verificado y es funcional en testnet
- El agente envía el ABI/bytecode del contrato y recibe una respuesta de análisis
- Si Kite AI no tiene API pública al momento del hackathon, se documenta el fallback implementado (LLM propio con prompt de auditoría) y se registra como deuda técnica

### AC-5: Agent 5 — Risk Score es determinístico y justificado
- El score 0-100 tiene una fórmula documentada en el story file (ponderación de cada agente)
- SAFE / CAUTION / AVOID mapea exactamente a rangos documentados
- El reporte final incluye el output individual de cada agente (trazabilidad completa)
- Dado el mismo input, el score varía menos de ±3 puntos en 3 ejecuciones consecutivas

### AC-6: Pipeline completo ejecutable end-to-end en Fuji
- Un token address de Fuji testnet produce un reporte completo en < 60 segundos
- El reporte tiene formato JSON válido + sección `summary` en texto plano
- Se prueba con al menos 2 tokens distintos (uno legítimo, uno honeypot conocido en testnet)

### AC-7: Agentes publicados en marketplace con fee funcional
- Cada agente tiene `fee_usdc > 0` definido (sugerido: $0.05–$0.50 por llamada)
- Un Consumer puede llamar cualquiera de los 5 agentes individualmente vía el endpoint estándar de WasiAI y el pago x402 fluye correctamente
- Los agentes aparecen con categoría `DeFi Risk` o equivalente en el marketplace

### AC-8: Tests y documentación mínima
- Cada agente tiene al menos un test de integración que pasa en CI
- Existe un README o descripción en el marketplace explicando inputs/outputs de cada agente
- Los hallazgos de Kite AI (o fallback) están documentados para la presentación del hackathon

---

## Scope

### IN SCOPE ✅
- Creación de los 5 agentes como servicios backend en WasiAI
- Registro de los 5 agentes en la DB del marketplace (tabla `agents`)
- Integración on-chain con Chainlink AggregatorV3Interface en Fuji
- Integración con Avalanche RPC para data on-chain (Agent 2)
- Integración con Kite AI API (o fallback documentado si no disponible)
- Lógica de scoring en Agent 5 con fórmula documentada
- Tests de integración básicos por agente
- Publicación en marketplace con fee funcional (x402 individual)

### OUT OF SCOPE ❌
- Endpoint `/compose` para orquestar los 5 agentes en secuencia → **HU-5.1**
- UI dedicada de DeFi Risk en el frontend → feature separado
- Deploy en Avalanche Mainnet → post-hackathon
- Soporte para otras chains (solo Avalanche)
- Análisis de redes sociales (Twitter/X scraping) para sentimiento → Agent 4 usa solo metadata disponible on-chain/marketplace
- Notificaciones o alertas en tiempo real

---

## Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|-----------|
| Kite AI no tiene API pública documentada | Alta | Alto | Verificar en día 1. Fallback: LLM propio (Claude/GPT) con prompt de auditoría de contratos. Documentar como deuda técnica. |
| Chainlink Price Feed no existe para tokens de testnet | Media | Medio | Usar tokens con feeds conocidos (AVAX/USD, ETH/USD en Fuji). Documentar limitación. |
| RPC de Fuji inestable / rate limit | Media | Medio | Usar múltiples RPC endpoints. Retry con backoff. |
| Agent 2 (holder analysis) requiere API externa de pago | Media | Medio | Snowtrace API gratuita cubre caso base. Caching de resultados. |
| Tiempo insuficiente para hackathon | Alta | Alto | Priorizar Agent 1 + Agent 5 como MVP. Agents 2-4 pueden ser simplificados si hay time crunch. |
| Score no determinístico por LLM en Agent 3/4 | Media | Medio | Acotár inputs al LLM. Promediar 3 llamadas o usar temperature=0. |

---

## Estimación

| Agente | Esfuerzo estimado | Responsable |
|--------|-------------------|-------------|
| Agent 1 — Chainlink Price Feed Reader | 0.5 días | I+D WasiAI |
| Agent 2 — On-Chain Analyzer | 1 día | I+D WasiAI |
| Agent 3 — Kite AI Contract Auditor | 1.5 días (incluye verificación API) | I+D WasiAI |
| Agent 4 — Sentiment Analyzer | 0.5 días | I+D WasiAI |
| Agent 5 — Risk Report Generator | 1 día | I+D WasiAI |
| Publicación en marketplace (DB + fees) | 0.5 días | I+D WasiAI |
| Tests + docs | 0.5 días | I+D WasiAI |
| **Total estimado** | **5.5 días** | |

**Nota hackathon:** Si el deadline es semana 3, el MVP funcional (Agent 1 + 5 con datos reales) puede estar listo en 2 días. Agents 2-4 completan la semana.

---

## Dependencias

| Dependencia | Estado | Bloqueante |
|-------------|--------|-----------|
| Marketplace WasiAI funcional con tabla `agents` | ✅ Activo en Fuji | Sí — sin marketplace no hay publicación |
| Contrato WasiAI en Fuji `0x71CddCdF8a40951a1d8C22C8774448FbcA089b53` | ✅ Activo | Sí — para fees y registro |
| Chainlink AggregatorV3 en Fuji (AVAX/USD disponible) | ✅ Confirmado | Sí — Agent 1 |
| Kite AI API disponible | ❓ Por verificar | Parcial — Agent 3 tiene fallback |
| Snowtrace API / Avalanche RPC público | ✅ Disponible | Sí — Agent 2 |
| HU-5.1 (endpoint /compose) | 🟡 Separada | No — esta HU es independiente |
| Credenciales y acceso a Kite AI | ❓ Por obtener | Para Agent 3 |

**Acción inmediata requerida:** Verificar disponibilidad de Kite AI API antes de SPEC. Si no hay API pública, definir fallback en la SDD.

---

## Notas para S1 (Architect)

- Definir si los 5 agentes son funciones serverless separadas (recomendado) o un solo endpoint con `agentId` param
- Schema DB: qué columnas adicionales necesita tabla `agents` para metadata de integración (chainlink_feed_address, rpc_endpoint, etc.)
- Decidir cómo se almacenan los resultados del pipeline — solo en memoria (stateless) o con cache en Supabase/Redis
- Fórmula de scoring para Agent 5 debe quedar en el SDD, no en el story file del dev

---

## Definition of Done (Draft)

- [ ] 5 agentes registrados y activos en marketplace Fuji
- [ ] Pipeline end-to-end ejecutable con input real
- [ ] Score SAFE/CAUTION/AVOID funcionando con fórmula documentada
- [ ] Tests de integración pasando en CI
- [ ] Kite AI integrado (o fallback documentado)
- [ ] Demo-ready para presentación Semana 3 hackathon

---

*Generado por S0 (San) — 2026-02-28*  
*Próximo paso: HU_APPROVED de Fer → S1 genera SDD*
