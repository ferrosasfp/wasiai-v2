# WasiAI — Epics & Stories
> Fuente de verdad para el Sprint Planning BMAD.
> Sincronizado con BACKLOG.md — última actualización: 2026-02-26

---

## Epic 1: Creators Reales en el Marketplace

> Sin creators externos, no hay marketplace. Esta es LA prioridad de negocio.

### Story 1.1: Onboarding sin fricción
Publicar agente sin wallet ni USDC (custodial onboarding).

### Story 1.2: Formulario multi-paso
Básico → producto → técnico con preview live.

### Story 1.3: Test de endpoint en tiempo real
Test de endpoint desde el formulario con SSRF protection.

### Story 1.4: Creator analytics
Llamadas/día, latencia, earnings históricos, alertas de health.

### Story 1.5: Perfil público del creator
Página pública con todos los agentes del creator.

---

## Epic 2: SDK @wasiai/sdk

> Sin SDK, developers no pueden integrar. Multiplica el alcance 10x.

### Story 2.1: SDK Node.js TypeScript
`npm install @wasiai/sdk` — invoke, list, get, errores tipados.

### Story 2.2: SDK Python
`pip install wasiai` — paridad con SDK Node.js.

### Story 2.3: Documentación interactiva
Ejemplos ejecutables con el SDK real.

### Story 2.4: CLI wasiai
`wasiai invoke <agent> "<input>"` — developer experience desde terminal.

---

## Epic 3: Free Trial por Agente

> Sin esto, conversión es casi cero. Nadie paga por algo que no probó.

### Story 3.1: Una llamada gratuita por usuario por agente
Playground básico desde la ficha — 1 trial, rate limit, is_trial log.

### Story 3.2: Playground comparativo
Probar y comparar múltiples agentes lado a lado.

---

## Epic 4: Discovery y Calidad del Catálogo

### Story 4.1: Búsqueda semántica
pgvector o tsvector para búsqueda por semántica.

### Story 4.2: Filtros avanzados
Precio, latencia, uptime, categoría.

### Story 4.3: Ejemplos de input/output curados
El creator sube ejemplos reales de uso.

### Story 4.4: Reputación con datos reales
Uptime histórico, latencia p50/p95, tasa de error — reemplaza 👍/👎.

### Story 4.5: Colecciones curadas y featured agents
Curaduría editorial del marketplace.

---

## Epic 5: Agent-to-Agent Routing

> El diferenciador real. Ningún otro marketplace tiene esto.

### Story 5.1: POST /api/v1/compose — pipeline secuencial
Pipeline secuencial con pago x402 por paso.

### Story 5.2: Ejecución paralela de agentes
Múltiples agentes en paralelo dentro de un pipeline.

### Story 5.3: Routing inteligente
Por precio, latencia y reputación.

### Story 5.4: UI visual de pipelines
Constructor visual de pipelines de agentes.

---

## Epic 6: Mainnet Avalanche

> Mientras sea Fuji, es un juguete. Mainnet = producto real.

### Story 6.1: Auditoría de seguridad del contrato
Auditoría por firma externa antes de mainnet.

### Story 6.2: Deploy contrato en mainnet
Deploy + configurar operator wallet con AVAX real.

### Story 6.3: Migrar agentes demo a mainnet
Todos los agentes demo activos en mainnet.

### Story 6.4: Monitoring del operator wallet
Alerta cuando AVAX < umbral operativo.

---

## Epic 7: Integraciones con Ecosistema AI

### Story 7.1: Plugin LangChain
WasiAI como Tool nativo en LangChain.

### Story 7.2: Plugin LlamaIndex
Integración con LlamaIndex.

### Story 7.3: Ejemplo AgentKit Coinbase
Agente que paga agentes usando WasiAI.

### Story 7.4: Documentación MCP
Para Claude Desktop y Cursor.

---

## Epic 8: Transparencia y Confianza

### Story 8.1: Auditoría pública del contrato
Dashboard de auditoría accesible.

### Story 8.2: Dashboard público /transparency
Volumen, settlements, operator health.

### Story 8.3: Notificaciones
Email cuando saldo de key < 20%, uso inusual detectado.

### Story 8.4: Rate limiting configurable por creator
El creator puede proteger su endpoint de abuso.

---

## Epic 9: UX Improvements

> Mejoras de conversión y retención en paralelo con épicas principales.

### Story 9.1: Empty state de búsqueda
Sugerencias de agentes populares cuando no hay resultados.

### Story 9.2: Preview live en publish
Creator ve exactamente cómo quedará su ficha antes de publicar.

### Story 9.3: Editor de capabilities sin JSON crudo
Campos estructurados en lugar de JSON manual.

### Story 9.4: Code examples auto-generados
Curl, Node.js, Python en la ficha del agente — basado en slug y precio.

### Story 9.5: Indicador de saldo de API key en navbar
El usuario ve cuánto USDC tiene disponible sin ir al dashboard.

### Story 9.6: Hero copy específico por usuario
Creator: "Publica tu agente, cobra en USDC" / Consumer: "Encuentra el agente que necesitas".

### Story 9.7: i18n — copias reales de WasiAI
Reemplazar copy del template NexusFactory con copy real en es/en.
