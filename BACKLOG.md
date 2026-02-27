# WasiAI — Backlog

> Priorizado por criterio de PO: Riesgo → Valor de negocio → Esfuerzo.
> Estado: `[ ]` pendiente · `[x]` hecho · `[~]` en progreso · `[-]` descartado

---

## 🏗️ Stack Oficial (Golden Path) — actualizado 2026-02-25

### Web2
- Framework: Next.js 14 (App Router)
- DB: Supabase (Postgres + Auth + RLS)
- Rate limiting: Upstash Redis
- Storage: Pinata (IPFS)
- Estilos: Tailwind CSS
- i18n: next-intl

### Web3
- Blockchain: Avalanche C-Chain (Fuji 43113 / Mainnet 43114)
- Contratos: Solidity 0.8.24 + Foundry
- Lib blockchain: viem v2 (NO ethers.js)
- Wallet React: wagmi v3
- Pagos: x402 + ERC-3009 (uvd-x402-sdk)
- ERC-4337: NO activo (roadmap futuro — ver Épica 1)

### Reglas
- Nunca NEXT_PUBLIC_ para secrets o API keys de pago
- Nunca hardcodear direcciones de contrato — siempre desde env var
- Nunca ethers.js — usar viem
- Nunca datos simulados en producción

---

## ✅ SPRINT COMPLETADO — Auditoría crítica + ERC-4337 (2026-02-25)

- [x] Eliminar ERC-4337 / permissionless / Pimlico del codebase
- [x] HAL-001: Dirección contrato vieja hardcodeada en emergency withdraw
- [x] HAL-002: Management key rota en registro A2A (columnas inexistentes)
- [x] HAL-003: Auth bypass en registro A2A
- [x] HAL-005: Seed usa tabla `models` (renombrada a `agents`)
- [x] HAL-006: Métricas fabricadas en seed (total_calls, total_revenue)
- [x] HAL-007: CRON_SECRET faltante en .env.example
- [x] HAL-008: Cron retry-recordings sin auth cuando CRON_SECRET ausente
- [x] HAL-009: URL facilitador UVD hardcodeada en invoke route
- [x] HAL-010: ethers.js en signReceipt.ts → migrado a viem
- [x] HAL-011: Race condition en budget_usdc → RPC atómica increment_key_budget
- [x] HAL-012: Bug doble conteo en increment_agent_key_spend → single UPDATE
- [x] HAL-013: Sin guardia cuando MARKETPLACE_ADDRESS_MAINNET vacío
- [x] HAL-014: SSRF parcial — IPv6 privado bloqueado
- [x] HAL-015: Cron con alerta balance_mismatch (on-chain < DB)
- [x] HAL-016: CHAIN_NAME unificado desde @/lib/chain

---

## 🔴 P1 — Sprint 5 (prioridad máxima)

- [ ] **HU-3.3** Free Trial controlado por creator — agregar `free_trial_enabled` (default: false) y `free_trial_limit` (default: 1) en tabla `agents`. Toggle en dashboard del creator. Trial solo se ejecuta si el creator lo activó explícitamente. Hoy los trials están ON para todos sin consentimiento del creator — esto lo corrige. Migration 018 requerida.

---

## 🔴 P1 — Seguridad y correctness ✅ COMPLETADO (2026-02-25)

- [x] **HAL-017** Monitoreo pending_recordings > 1h → alerta operativa en retry-recordings cron
- [x] **HAL-018** Batch size limit 500 con sub-batch loop en settle-key-batches
- [x] **HAL-019** Check `validBefore > Date.now() / 1000` antes de tx on-chain en usdcSettler.ts
- [x] **HAL-020** Validar `ownerAddress === creator_profiles.wallet_address` en deposit route
- [x] **HAL-021** `callId` retornado directamente de `logCall`, no buscado después
- [x] **HAL-022** SSRF blocklist extendida: Alibaba Cloud `100.100.100.200`, AWS IMDSv2 IPv6 `fd00:ec2:`

---

## 🟠 P2 — Deuda técnica ✅ COMPLETADO (2026-02-25)

- [x] **HAL-023** `validBefore` en DepositModal extendido a 24h
- [x] **HAL-024** `getOperatorClient()` refactorizado a singleton lazy — una RPC connection por proceso
- [x] **HAL-025** Refund on-chain ANTES de revocar key en DB; si on-chain falla → 503, key sigue activa
- [x] **HAL-026** settle-key-batches: query limitada a últimos 7 días
- [x] **HAL-027** `receiptTimestamp` capturado inmediatamente después de `logCall`, mismo valor para firma y DB
- [x] **HAL-028** `endpoint_url` excluido de discovery API pública
- [x] **HAL-029** `.env.example` actualizado con todas las vars actuales ordenadas por sección
- [x] **SEC-CSP** Nonce por request en middleware; `unsafe-inline` eliminado de producción

---

## 🟡 P3 — Mejoras de producto que aumentan conversión y retención

> Trabajar en paralelo con las Épicas. Cada una es una HU pequeña, entregable en 1-2 días.

- [ ] **UX-01** Empty state de búsqueda sin resultados — mostrar sugerencias de agentes populares en lugar de pantalla vacía.

- [ ] **UX-02** `publish/page.tsx` — Preview live del agent card mientras el creator llena el formulario. El creator ve exactamente cómo quedará su ficha antes de publicar.

- [ ] **UX-03** Capabilities — editor de campos estructurado en lugar de JSON crudo. La mayoría de creators no saben qué es JSON.

- [ ] **UX-04** Página de detalle del agente — agregar sección "Cómo usar" con código de ejemplo auto-generado (curl, Node.js, Python) basado en el slug y precio del agente.

- [ ] **UX-05** Navbar — indicador visual del saldo de API key activo (cuánto USDC disponible). Sin esto el usuario no sabe si puede usar agentes.

- [ ] **UX-06** Dashboard creator — gráfica de llamadas por día (últimos 30 días). Hoy solo hay tabla de últimas llamadas.

- [ ] **UX-07** Hero copy — actualmente genérico. Necesita copy específico para los dos usuarios: "Publish your AI agent → get paid automatically" (creator) y "Find the right AI agent → integrate in minutes" (consumer).

- [ ] **i18n-01** Archivos de traducción `en.json` y `es.json` tienen copy del template NexusFactory. Actualizar con copy real de WasiAI en todas las secciones.

---

## 📋 ÉPICAS — Roadmap de producto

### ✅ ÉPICA 1 — Creators Reales en el Marketplace *(COMPLETA)*
> Sin creators externos, no hay marketplace. Esta es LA prioridad de negocio.

- [x] **HU-1.1** Onboarding sin fricción — publicar agente sin wallet ni USDC (custodial onboarding)
- [x] **HU-1.2** Formulario multi-paso — básico → producto → técnico con preview live
- [x] **HU-1.3** Test de endpoint en tiempo real desde el formulario
- [x] **HU-1.4** Creator analytics — llamadas/día, latencia, earnings históricos, alertas de health
- [x] **HU-1.5** Perfil público del creator con todos sus agentes

### 🔴 ÉPICA 2 — SDK (@wasiai/sdk) *(en paralelo con Épica 1)*
> Sin SDK, developers no pueden integrar. Multiplica el alcance por 10x.

- [x] **HU-2.1** SDK Node.js/TypeScript — `npm install @wasiai/sdk`
- [x] **HU-2.2** SDK Python — `pip install wasiai`
- [ ] **HU-2.3** Documentación interactiva con ejemplos ejecutables
- [ ] **HU-2.4** CLI — `wasiai invoke <agent> "<input>"`

### 🔴 ÉPICA 3 — Free Trial por Agente *(antes de abrir registro público)*
> Sin esto, conversión es casi cero. Nadie paga por algo que no probó.

- [x] **HU-3.1** 1 llamada gratuita por usuario por agente desde la ficha
- [ ] **HU-3.2** Playground — probar y comparar múltiples agentes

### 🟡 ÉPICA 4 — Discovery y Calidad del Catálogo *(mes 2)*

- [ ] **HU-4.1** Búsqueda semántica (pgvector o tsvector)
- [ ] **HU-4.2** Filtros avanzados (precio, latencia, uptime, categoría)
- [ ] **HU-4.3** Ejemplos de input/output curados por el creator
- [ ] **HU-4.4** Reputación con datos reales (uptime histórico, latencia p50/p95, tasa de error) — reemplaza 👍/👎
- [ ] **HU-4.5** Colecciones curadas y featured agents

### 🟡 ÉPICA 5 — Agent-to-Agent Routing *(mes 2-3)*
> El diferenciador real. Ningún otro marketplace tiene esto.

- [ ] **HU-5.1** `POST /api/v1/compose` — pipeline secuencial con pago por paso
- [ ] **HU-5.2** Ejecución paralela de agentes
- [ ] **HU-5.3** Routing inteligente por precio/latencia/reputación
- [ ] **HU-5.4** UI visual de pipelines

### 🟡 ÉPICA 6 — Mainnet Avalanche *(mes 3)*
> Mientras sea Fuji, es un juguete. Mainnet = producto real.

- [ ] **HU-6.1** Auditoría de seguridad del contrato por firma externa
- [ ] **HU-6.2** Deploy contrato en mainnet + configurar operator wallet con AVAX real
- [ ] **HU-6.3** Migrar agentes demo a mainnet
- [ ] **HU-6.4** Monitoring del operator wallet (alerta cuando AVAX < umbral)

### 🟢 ÉPICA 7 — Integraciones con Ecosistema AI *(mes 3-4)*

- [ ] **HU-7.1** Plugin LangChain — WasiAI como Tool nativo
- [ ] **HU-7.2** Plugin LlamaIndex
- [ ] **HU-7.3** Ejemplo AgentKit (Coinbase) — agente que paga agentes
- [ ] **HU-7.4** Documentación MCP para Claude Desktop y Cursor

### 🟢 ÉPICA 8 — Transparencia y Confianza *(mes 4)*

- [ ] **HU-8.1** Auditoría de contrato por firma externa (prerequisito mainnet)
- [ ] **HU-8.2** Dashboard público `/transparency` — volumen, settlements, operator health
- [ ] **HU-8.3** Notificaciones — email cuando saldo de key < 20%, uso inusual detectado
- [ ] **HU-8.4** Rate limiting configurable por creator (proteger su endpoint de abuso)

---

## ✅ Completado

- [x] Deploy Next.js + Supabase + Tailwind (golden path base)
- [x] Migrations 000–013
- [x] Rate limiting Upstash Redis en todos los endpoints críticos
- [x] SSRF protection (IPv4 — IPv6 pendiente HAL-014/HAL-022)
- [x] CSP + security headers (nonces pendiente SEC-CSP)
- [x] Auth gate en /publish
- [x] Paginación homepage
- [x] Health endpoint A2A
- [x] Pinata IPFS image upload
- [x] On-chain payout (withdrawFor + WithdrawButton)
- [x] Favicon SVG custom
- [x] Deploy producción: https://wasiai-v2.vercel.app
- [x] x402 settlement con Ultravioleta DAO (Fuji)
- [x] Self-registration API para agentes
- [x] MCP server con pagos reales via agent keys
- [x] ERC-8004 Reputation (agent_ratings)
- [x] UI rebrand Avalanche red + logo "casa de agentes"
- [x] USDC pre-fondeado real para API keys (escrow on-chain)
- [x] Recibos criptográficos firmados por llamada (signReceipt)
- [x] Batch settlement diario (cron)
- [x] Emergency withdraw 30 días (trustless exit)
- [x] refundKeyToEarnings — withdraw unificado
- [x] Contrato v3 Fuji: `0x71CddCdF8a40951a1d8C22C8774448FbcA089b53` verificado Sourcify + Snowtrace
- [x] Auditoría 30 hallazgos — sprint de corrección [~] en progreso

---

## 📋 Mejoras post-Build Games (documentadas como HUs)

### HU-7.3b — AgentKit con CDP Wallet
Migrar el ejemplo AgentKit de private key en .env a CDP Wallet de Coinbase con KYC completo.
Requiere: cuenta Coinbase Developer Platform aprobada.
Dependencia: HU-7.3 completada.

### HU-5.1b — Agent-to-Agent Routing Async
Migrar POST /api/v1/compose de síncrono (25s) a async con polling:
- POST /api/v1/compose → retorna {pipeline_id, status: "pending"}
- GET /api/v1/compose/:id → retorna estado + resultado parcial
- Webhooks opcionales para notificar completion
Requiere: tabla pipeline_executions en Supabase, worker o Vercel Edge Functions.
Dependencia: HU-5.1 síncrona completada.
