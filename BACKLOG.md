# WasiAI v2 — Backlog

> Items ordenados por prioridad. Estado: `[ ]` pendiente · `[x]` hecho · `[-]` descartado.

---

## 🔴 Urgente

- [ ] **Video pitch 1 min** — Avalanche Build Games Semana 1 (requiere Fer grabe)

---

## 🟠 Medium Priority (post-hackathon sprint)

- [ ] **A2A-04** — Extraer `payer_address` del header x402 en invoke route
- [ ] **PERF-05** — Discovery API muy pesada — trim campos innecesarios en `/api/v1/agents`
- [ ] **PERF-06** — Redundant `await` en `logCall` — hacer fire-and-forget
- [ ] **SEC-06** — Remover key partial de logs en `agent-keys.service.ts`
- [ ] **UX-04** — Empty state sin sugerencias — mostrar featured agents cuando no hay resultados
- [ ] **UX-08** — CategoryFilter active indicator débil — mejorar visual en `CategoryFilter.tsx`

---

## 🟡 Low Priority

- [ ] **UX-03** — "Browse Models" CTA sin smooth scroll al grid
- [ ] **UX-06** — Publish form sin live card preview (`PublishForm.tsx`)
- [ ] **UX-07** — Hero copy ambiguo para audiencia dual (developers vs. usuarios finales)
- [ ] **UX-11** — Capabilities solo editables via JSON crudo — necesita UI de inputs
- [ ] **UX-15** — Hero copy hardcoded en inglés — mover a i18n keys
- [ ] **A2A-11** — `management_key` null safety
- [ ] **i18n** — `/messages/en.json` y `/messages/es.json` tienen boilerplate NexusFactory — actualizar con copy WasiAI real (hero, marketplace, publish flow)
- [ ] **Rate limiting** — `POST /api/models` (publish) sin protección actualmente

---

## 🔵 Producto / Roadmap

- [ ] **Registro multi-paso de agentes** *(2026-02-22)*
  - Contexto: WasiAI v1 tenía registro más detallado pensado para humanos creando y consumiendo. El formulario actual (v2) es minimalista, funcional para A2A pero insuficiente para confianza humana y calidad del catálogo.
  - Propuesta de flujo:
    - **Paso 1** — Básico: nombre, slug, descripción corta, precio, endpoint
    - **Paso 2** — Producto: descripción larga, ejemplos de uso (input/output), para quién es, modelo de negocio
    - **Paso 3** — Técnico: capabilities, auth type, parámetros, health check URL
  - Por qué importa: marketplace con fichas pobres no convierte usuarios humanos + catálogo sin ejemplos = baja adopción
  - Prioridad: post-hackathon, antes de abrir registro público

---

## ✅ Completado (histórico)

- [x] Deploy contrato Fuji + verificado Snowscan
- [x] Migrations Supabase 000–008
- [x] Rate limiting Upstash Redis (invoke/register/keys/upload)
- [x] SSRF protection en endpoints
- [x] CSP + security headers
- [x] Auth gate en /publish
- [x] Paginación homepage
- [x] Health endpoint A2A
- [x] Pinata IPFS image upload
- [x] On-chain payout (withdrawFor + WithdrawButton)
- [x] Favicon SVG custom
- [x] Deploy producción: https://wasiai-v2.vercel.app
