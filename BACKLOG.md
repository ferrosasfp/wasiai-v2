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

## 🔴 P1 — Seguridad y correctness (bloquean confianza en producción)

> Resolver antes de onboardear creators externos o hacer demo pública.

- [ ] **HAL-017** `invoke/route.ts` — x402 path: USDC recibido pero creator no cobra si `recordInvocationOnChain` falla permanentemente. El retry queue existe pero sin SLA ni alerta. Agregar: monitoreo de pending_recordings con edad > 1h → alerta operativa + dashboard interno.

- [ ] **HAL-018** `settle-key-batches/route.ts` — Cron no tiene límite de batch size. Si hay 10,000 llamadas pendientes de una sola key, el array de slugs/amounts puede exceder el gas limit del contrato. Agregar: paginación de máximo 500 items por batch, con loop hasta liquidar todo.

- [ ] **HAL-019** `usdcSettler.ts` — La función `settlePaymentDirectly` no verifica que el `validBefore` (deadline) de la autorización ERC-3009 no haya expirado antes de intentar la tx on-chain. Si el RPC está lento y el deadline pasó, la tx on-chain falla pero el usuario ya recibió el resultado del agente. El creator no cobra. Agregar: check `validBefore > Date.now() / 1000` antes de llamar al contrato.

- [ ] **HAL-020** `agent-keys/[id]/deposit/route.ts` — No verifica que el `ownerAddress` del body coincida con la wallet del usuario autenticado. Un usuario podría hacer un depósito firmado por otra wallet y asignarlo a su key. Agregar: validar que `ownerAddress === creator_profiles.wallet_address` del usuario autenticado.

- [ ] **HAL-021** `invoke/route.ts` — El `callRecord` se busca por `caller_type = 'agent'` y `tx_hash IS NULL ORDER BY called_at DESC LIMIT 1`. En carga concurrente alta, dos llamadas simultáneas pueden firmar el mismo `callId`. El receipt quedaría asignado al registro incorrecto. Fix: pasar el `callId` directamente como parámetro a `logCall` y retornarlo, no buscarlo después.

- [ ] **HAL-022** `validateEndpointUrl.ts` — Los dominios cloud metadata no están todos bloqueados. Faltan:
  - `metadata.google.internal` (GCP)
  - `169.254.169.254` sin http:// (acceso directo)
  - `100.100.100.200` (Alibaba Cloud metadata)
  Agregar a la blocklist.

---

## 🟠 P2 — Deuda técnica que afecta calidad del producto

> Resolver antes de lanzar SDK público o abrir el marketplace a creators externos.

- [ ] **HAL-023** `agent-keys/page.tsx` — El `DepositModal` firma la autorización ERC-3009 con `validBefore = Date.now() / 1000 + 3600` (1 hora). Si el usuario demora más de 1 hora entre firmar y que el operador procese (ej: cola llena, RPC lento), el depósito falla silenciosamente. Ampliar a 24h o mostrar countdown al usuario.

- [ ] **HAL-024** `marketplaceClient.ts` — `getOperatorClient()` crea un nuevo `JsonRpcProvider` y `Wallet` en cada llamada. En el cron que procesa N keys, esto significa N instancias de provider. Extraer a singleton con lazy initialization.

- [ ] **HAL-025** `agent-keys/[id]/refund/route.ts` — Si `refundKeyToEarningsOnChain` falla (RPC caído), la key ya fue revocada en DB (`is_active = false`) pero los fondos siguen en el contrato. El usuario pierde acceso a la key Y no puede recuperar su USDC. Fix: hacer el refund on-chain ANTES de revocar la key en DB. Si el on-chain falla, no revocar.

- [ ] **HAL-026** `settle-key-batches/route.ts` — El cron consulta TODOS los `agent_calls` no liquidados sin límite de tiempo. En producción con meses de historial, esta query puede tardar minutos. Agregar: `AND called_at > NOW() - INTERVAL '7 days'` como ventana máxima, y proceso separado para reconciliar llamadas más antiguas.

- [ ] **HAL-027** `signReceipt.ts` — El timestamp del receipt es `Math.floor(Date.now() / 1000)` en el momento de la firma, pero el receipt se guarda en DB con `called_at` diferente. Si hay drift entre el tiempo de firma y el tiempo de llamada, la auditoría del usuario no cuadra. Usar el mismo timestamp para ambos.

- [ ] **HAL-028** `api/v1/agents/route.ts` — La query de discovery devuelve todos los campos de la tabla `agents` incluyendo `endpoint_url` (URL privada del creator). Cualquier agente externo que llame al discovery endpoint puede ver los endpoints internos de todos los creators. Filtrar: excluir `endpoint_url` de la respuesta pública.

- [ ] **HAL-029** Falta `.env.example` completo y actualizado. Varias vars nuevas agregadas en los últimos sprints no están documentadas: `CRON_SECRET`, `X402_FACILITATOR_URL`, `OPERATOR_PRIVATE_KEY` (¿debería estar?). Un developer nuevo no puede levantar el proyecto desde el README.

- [ ] **SEC-CSP** `middleware.ts` — CSP usa `unsafe-inline` para scripts. Reemplazar con nonces por request via `experimental.strictNextHead` en Next.js. Sin esto, cualquier XSS inyecta scripts arbitrarios.

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

### 🔴 ÉPICA 1 — Creators Reales en el Marketplace *(siguiente sprint)*
> Sin creators externos, no hay marketplace. Esta es LA prioridad de negocio.

- [ ] **HU-1.1** Onboarding sin fricción — publicar agente sin wallet ni USDC (custodial onboarding)
- [ ] **HU-1.2** Formulario multi-paso — básico → producto → técnico con preview live
- [ ] **HU-1.3** Test de endpoint en tiempo real desde el formulario
- [ ] **HU-1.4** Creator analytics — llamadas/día, latencia, earnings históricos, alertas de health
- [ ] **HU-1.5** Perfil público del creator con todos sus agentes

### 🔴 ÉPICA 2 — SDK (@wasiai/sdk) *(en paralelo con Épica 1)*
> Sin SDK, developers no pueden integrar. Multiplica el alcance por 10x.

- [ ] **HU-2.1** SDK Node.js/TypeScript — `npm install @wasiai/sdk`
- [ ] **HU-2.2** SDK Python — `pip install wasiai`
- [ ] **HU-2.3** Documentación interactiva con ejemplos ejecutables
- [ ] **HU-2.4** CLI — `wasiai invoke <agent> "<input>"`

### 🔴 ÉPICA 3 — Free Trial por Agente *(antes de abrir registro público)*
> Sin esto, conversión es casi cero. Nadie paga por algo que no probó.

- [ ] **HU-3.1** 1 llamada gratuita por usuario por agente desde la ficha
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
