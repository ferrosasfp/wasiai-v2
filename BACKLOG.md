# WasiAI — Backlog

> Items ordenados por prioridad. Estado: `[ ]` pendiente · `[x]` hecho · `[-]` descartado · `[~]` en progreso.

---

## 📋 ÉPICAS — Product Roadmap

Las épicas representan capacidades completas de negocio. Cada una se trabaja por separado, de arriba hacia abajo.

---

### 🔴 ÉPICA 1 — Creators Reales en el Marketplace

> **"Como developer independiente, quiero publicar mi agente en WasiAI en menos de 10 minutos, sin necesitar entender blockchain, para empezar a monetizarlo inmediatamente."**

**Por qué es prioridad 1:** Sin creators reales, WasiAI es una vitrina vacía. Todo lo técnico que construimos es infraestructura sin negocio encima.

**Criterios de aceptación de la épica:**
- Al menos 5 creators externos (no del equipo WasiAI) con agentes publicados y activos
- El flujo de publicación no requiere conocimiento de wallets, x402 ni blockchain
- Un agente puede estar publicado y recibiendo llamadas en menos de 10 minutos desde el registro

**Historias de usuario:**

- [ ] **HU-1.1 — Onboarding sin fricción**
  > "Como developer sin experiencia Web3, quiero publicar mi agente solo con mi API key de OpenAI/Groq/Anthropic, sin necesitar una wallet ni USDC, para empezar a ganar dinero sin barreras."
  - Flujo: Developer ingresa nombre, endpoint, precio → WasiAI crea wallet custodial para él → puede hacer withdraw cuando tenga suficiente saldo
  - Alternativa: pago en fiat (Stripe) que WasiAI convierte internamente a USDC
  - Aceptación: creator puede publicar sin instalar Core Wallet

- [ ] **HU-1.2 — Formulario de publicación multi-paso**
  > "Como creator, quiero un formulario guiado paso a paso para publicar mi agente, con validaciones en tiempo real, para no cometer errores técnicos."
  - Paso 1: Básico (nombre, slug, descripción, precio, endpoint)
  - Paso 2: Producto (descripción larga, casos de uso, ejemplos input/output)
  - Paso 3: Técnico (capabilities, auth, health check, parámetros)
  - Aceptación: creator ve preview de su ficha antes de publicar

- [ ] **HU-1.3 — Test de endpoint en tiempo real**
  > "Como creator, quiero probar mi endpoint directamente desde el formulario de publicación, para asegurarme de que WasiAI puede llamarlo correctamente antes de publicar."
  - UI muestra resultado de `POST endpoint { input: "test" }` en tiempo real
  - Muestra latencia, status code, y si el formato de respuesta es correcto

- [ ] **HU-1.4 — Portal de creator analytics**
  > "Como creator, quiero ver métricas detalladas de mi agente (llamadas por día, latencia promedio, tasa de error, ingresos por período), para tomar decisiones sobre mi agente."
  - Dashboard con: gráfica de llamadas/día, top inputs, latencia p50/p95, earnings históricos
  - Alertas por email si el health check falla

- [ ] **HU-1.5 — Página de perfil del creator**
  > "Como usuario del marketplace, quiero ver el perfil del creator de un agente (otros agentes que tiene, reputación, tiempo en la plataforma), para decidir si confío en su trabajo."

---

### 🔴 ÉPICA 2 — SDK para Developers (@wasiai/sdk)

> **"Como developer que quiere usar agentes de WasiAI, quiero una librería npm que abstraiga todo el protocolo de pago, para integrar agentes en mi app en 5 líneas de código."**

**Por qué es prioridad 1:** Hoy usar WasiAI desde código requiere saber x402, EIP-712, headers HTTP, y tener una wallet. Eso elimina al 95% de los developers potenciales.

**Criterios de aceptación de la épica:**
- `npm install @wasiai/sdk` funciona
- Puedo invocar cualquier agente con 3 líneas de código
- La documentación tiene ejemplos para Node.js, Python, y desde Claude/Cursor via MCP

**Historias de usuario:**

- [ ] **HU-2.1 — SDK core (Node.js / TypeScript)**
  > "Como developer Node.js, quiero `npm install @wasiai/sdk` y poder invocar agentes sin entender el protocolo de pagos subyacente."
  ```typescript
  const wasiai = new WasiAI({ apiKey: 'wasi_xxx' })
  const result = await wasiai.invoke('summarizer', { input: 'texto...' })
  ```
  - Maneja: autenticación, retry, errores, recibos
  - Publicar en npm como `@wasiai/sdk`

- [ ] **HU-2.2 — SDK Python**
  > "Como data scientist / ML engineer, quiero un wrapper Python para usar agentes de WasiAI desde mis notebooks y scripts."
  ```python
  from wasiai import WasiAI
  client = WasiAI(api_key="wasi_xxx")
  result = client.invoke("summarizer", input="texto...")
  ```
  - Publicar en PyPI como `wasiai`

- [ ] **HU-2.3 — Documentación interactiva**
  > "Como developer nuevo en WasiAI, quiero probar la API directamente desde la documentación, sin instalar nada."
  - Docs en `/docs` con ejemplos ejecutables (tipo Stripe Docs)
  - Cada agente del marketplace tiene su propia página de docs auto-generada

- [ ] **HU-2.4 — CLI de WasiAI**
  > "Como developer, quiero invocar agentes desde la terminal para prototipar rápido."
  ```bash
  wasiai invoke summarizer "mi texto aquí"
  wasiai list agents
  wasiai keys create --budget 10
  ```

---

### 🔴 ÉPICA 3 — Free Trial por Agente

> **"Como usuario del marketplace, quiero probar cualquier agente con una llamada gratuita antes de comprar crédito, para saber si me sirve antes de pagar."**

**Por qué es crítico:** Sin esto, la conversión es casi cero. Nadie paga por algo que no ha probado.

**Criterios de aceptación:**
- Cada usuario autenticado tiene 1 llamada gratuita por agente
- El resultado es real, no un mock
- El creator es compensado por las llamadas free (WasiAI absorbe el costo)

**Historias de usuario:**

- [ ] **HU-3.1 — Trial call desde la ficha del agente**
  > "Como visitante, quiero escribir un input en la página del agente y ver el resultado real antes de crear una cuenta o pagar."
  - Input visible en la página de detalle del agente
  - Límite: 1 trial por usuario (o por IP para no autenticados)
  - Aceptación: resultado aparece en menos de 5 segundos

- [ ] **HU-3.2 — Playground de agentes**
  > "Como developer, quiero un playground donde pueda probar varios agentes seguidos con mis datos, para comparar calidad y velocidad antes de elegir cuál integrar."
  - UI tipo ChatGPT Playground
  - Historial de llamadas de prueba guardado en sesión

---

### 🟡 ÉPICA 4 — Discovery y Calidad del Catálogo

> **"Como developer buscando una solución específica, quiero encontrar el agente correcto en menos de 1 minuto, con suficiente información para saber si cumple mis necesidades."**

**Historias de usuario:**

- [ ] **HU-4.1 — Search semántica**
  > "Como usuario, quiero buscar agentes por lo que hacen (no solo por nombre), para encontrar lo que necesito aunque no sepa el nombre exacto."
  - Búsqueda full-text con Postgres `tsvector` o Supabase pgvector
  - Búsqueda en: nombre, descripción, casos de uso, categoría, capabilities

- [ ] **HU-4.2 — Filtros avanzados**
  > "Como usuario, quiero filtrar agentes por precio, latencia, uptime, y categoría combinados, para encontrar el que mejor se adapta a mi caso de uso."

- [ ] **HU-4.3 — Ejemplos de input/output en cada ficha**
  > "Como usuario, quiero ver ejemplos reales de qué entra y qué sale de cada agente, para evaluar la calidad antes de usarlo."
  - El creator puede agregar hasta 3 ejemplos curados
  - Se muestran en la ficha con syntax highlighting

- [ ] **HU-4.4 — Reputación con datos reales**
  > "Como usuario, quiero ver el uptime histórico, latencia promedio y tasa de éxito de cada agente, para elegir uno confiable."
  - WasiAI hace health checks cada 5 minutos y guarda el historial
  - Badge "99.9% uptime" visible en la tarjeta del marketplace
  - Reemplaza el sistema 👍/👎 actual con métricas objetivas

- [ ] **HU-4.5 — Colecciones y featured**
  > "Como usuario nuevo, quiero ver colecciones curadas ('Mejores para startups', 'Agentes de código', 'Más rápidos'), para descubrir agentes de calidad sin saber qué buscar."

---

### 🟡 ÉPICA 5 — Agent-to-Agent Routing (Compose API)

> **"Como agente de IA o developer, quiero encadenar múltiples agentes de WasiAI en un pipeline donde cada paso se paga on-chain automáticamente, para resolver tareas complejas sin lógica de orquestación propia."**

**Por qué diferencia:** Esto es lo que nadie más tiene. Un agente que llama a otros agentes, cada paso se liquida on-chain. La "economía agentica" real.

**Historias de usuario:**

- [ ] **HU-5.1 — Compose API (secuencial)**
  > "Como developer, quiero un endpoint que tome una lista de agentes y los ejecute en secuencia, pasando el output de uno como input del siguiente, y cobre automáticamente por cada paso."
  ```json
  POST /api/v1/compose
  {
    "pipeline": [
      { "agent": "translator", "params": { "target": "english" } },
      { "agent": "summarizer" },
      { "agent": "sentiment-analyzer" }
    ],
    "input": "texto en español largo..."
  }
  ```

- [ ] **HU-5.2 — Compose paralelo**
  > "Como developer, quiero ejecutar múltiples agentes en paralelo sobre el mismo input y combinar sus resultados, para velocidad y redundancia."

- [ ] **HU-5.3 — Routing inteligente**
  > "Como developer, quiero que WasiAI elija automáticamente el mejor agente para mi tarea basándose en precio, latencia y reputación, sin que yo tenga que especificarlo."
  ```json
  { "task": "summarize", "optimize_for": "quality" }
  → WasiAI elige el mejor agente de summarization disponible
  ```

- [ ] **HU-5.4 — UI de pipelines**
  > "Como usuario no técnico, quiero construir pipelines de agentes visualmente, arrastrando y conectando bloques, para automatizar tareas sin escribir código."

---

### 🟡 ÉPICA 6 — Mainnet Avalanche

> **"Como creator y como usuario, quiero usar WasiAI con USDC real en Avalanche mainnet, para que mis earnings y pagos tengan valor real."**

**Historias de usuario:**

- [ ] **HU-6.1 — Deploy contrato en mainnet**
  > "Como equipo WasiAI, queremos desplegar el contrato en Avalanche C-Chain mainnet, verificarlo en Snowtrace, y configurar el operator wallet con AVAX real para gas."
  - Prerequisito: auditoría de seguridad del contrato
  - USDC mainnet: `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E`

- [ ] **HU-6.2 — Migración de agentes demo a mainnet**
  > "Como WasiAI, queremos registrar on-chain los agentes demo en mainnet y tener al menos 3 agentes reales de terceros registrados en el contrato."

- [ ] **HU-6.3 — Monitoring de operator wallet**
  > "Como operador, quiero alertas automáticas cuando el balance de AVAX del operator wallet esté por debajo de un umbral, para no quedarme sin gas en producción."

---

### 🟢 ÉPICA 7 — Integraciones con Ecosistema AI

> **"Como developer que usa frameworks populares de IA, quiero usar agentes de WasiAI directamente desde mi stack actual, sin cambiar mi flujo de trabajo."**

**Historias de usuario:**

- [ ] **HU-7.1 — Plugin para LangChain**
  > "Como developer de LangChain, quiero usar cualquier agente de WasiAI como un Tool de LangChain, para integrarlo en mis chains sin código adicional."

- [ ] **HU-7.2 — Plugin para LlamaIndex**
  > Similar a LangChain pero para LlamaIndex.

- [ ] **HU-7.3 — Ejemplo con AgentKit (Coinbase)**
  > "Como developer usando AgentKit, quiero ver un ejemplo funcionando de un agente que usa y paga agentes de WasiAI automáticamente, para entender cómo integrarlo."

- [ ] **HU-7.4 — Ejemplo con Claude / Cursor via MCP**
  > "Como usuario de Claude Desktop o Cursor, quiero configurar WasiAI como servidor MCP y tener acceso a todos los agentes del marketplace como herramientas."
  - Documentar `claude_desktop_config.json` con WasiAI MCP

---

### 🟢 ÉPICA 8 — Infraestructura de Confianza y Seguridad

> **"Como creator y como usuario, quiero saber que mis fondos están seguros, que WasiAI no puede actuar maliciosamente, y que el sistema funciona aunque WasiAI tenga problemas."**

**Historias de usuario:**

- [ ] **HU-8.1 — Auditoría de seguridad del contrato**
  > "Como WasiAI, queremos que el contrato sea auditado por una firma especializada antes del deploy en mainnet."

- [ ] **HU-8.2 — Dashboard de transparencia on-chain**
  > "Como usuario, quiero ver en tiempo real: volumen total del marketplace, earnings pendientes de liquidar, último batch settlement, y saldo del operator wallet."
  - Página pública `/transparency` con datos on-chain en tiempo real

- [ ] **HU-8.3 — Notificaciones de actividad de keys**
  > "Como usuario con API keys activas, quiero recibir notificaciones por email cuando mi saldo esté por agotarse o cuando se detecte uso inusual."

- [ ] **HU-8.4 — Rate limiting por agente configurable**
  > "Como creator, quiero configurar rate limits para mi agente (llamadas por minuto, por hora, por usuario), para proteger mi endpoint de abuso."

---

## 🔧 DEUDA TÉCNICA (heredada del sprint anterior)

- [ ] **SEC-CSP** — CSP nonce-based en vez de `unsafe-inline`
- [ ] **ARCH-P07** — Web3Provider solo en rutas que lo necesitan
- [ ] **PERF-05** — Discovery API — trim campos innecesarios
- [ ] **UX-04** — Empty state con sugerencias en búsqueda sin resultados
- [ ] **UX-06** — Preview live en formulario de publicación
- [ ] **UX-11** — Capabilities con UI de inputs en vez de JSON crudo
- [ ] **i18n** — Copy real de WasiAI en archivos de traducción
- [ ] **SEC-T07** — Cron de retry para on-chain recordings fallidos

---

## ✅ Completado

- [x] Deploy contrato Fuji v1 + verificado Snowscan
- [x] Migrations Supabase 000–012
- [x] Rate limiting Upstash Redis
- [x] SSRF protection en todos los endpoints
- [x] CSP + security headers
- [x] Auth gate en /publish
- [x] Paginación homepage
- [x] Health endpoint A2A
- [x] Pinata IPFS image upload
- [x] On-chain payout (withdrawFor + WithdrawButton)
- [x] Deploy producción: https://wasiai-v2.vercel.app
- [x] x402 real con Ultravioleta DAO (Fuji)
- [x] Self-registration API para agentes
- [x] MCP server con pagos reales via agent keys
- [x] ERC-8004 Reputation (agent_ratings)
- [x] Auditoría 117 hallazgos aplicada
- [x] UI rebrand Avalanche red + logo "casa de agentes"
- [x] USDC pre-fondeado real para API keys (escrow on-chain)
- [x] Recibos criptográficos firmados por llamada
- [x] Batch settlement diario (cron)
- [x] Emergency withdraw 30 días (trustless exit)
- [x] refundKeyToEarnings — withdraw unificado
- [x] Contrato v3 Fuji: 0x71CddCdF8a40951a1d8C22C8774448FbcA089b53 verificado Sourcify + Snowtrace
